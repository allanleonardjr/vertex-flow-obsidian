import { describe, expect, it } from "vitest";
import {
	MAX_RANK,
	MIDDLE_RANK,
	MIN_RANK,
	compareRanks,
	initialRanks,
	isValidRank,
	needsRebalance,
	parseRank,
	rankAfter,
	rankBefore,
	rankBetween,
	rankForPosition,
	sortByRank,
} from "../../src/core/ranking/lexorank";

describe("format", () => {
	it("accepts the documented schema example", () => {
		expect(isValidRank("0|i00004:")).toBe(true);
		expect(parseRank("0|i00004:")).toEqual({
			bucket: "0",
			int: "i00004",
			dec: "",
		});
	});

	it("rejects malformed ranks", () => {
		for (const bad of ["", "i00004", "0|i0004:", "0|i00004", "0|I00004:", "abc"]) {
			expect(isValidRank(bad)).toBe(false);
		}
	});

	it("parses a decimal part", () => {
		expect(parseRank("0|i00004:i8").dec).toBe("i8");
	});
});

describe("compareRanks", () => {
	it("orders the boundaries", () => {
		expect(compareRanks(MIN_RANK, MIDDLE_RANK)).toBe(-1);
		expect(compareRanks(MIDDLE_RANK, MAX_RANK)).toBe(-1);
		expect(compareRanks(MIDDLE_RANK, MIDDLE_RANK)).toBe(0);
	});

	it("treats a shorter decimal as sorting before a longer extension", () => {
		// 0.5 < 0.51 — the ':' separator must not break this.
		expect(compareRanks("0|i00004:5", "0|i00004:51")).toBe(-1);
		expect(compareRanks("0|i00004:", "0|i00004:1")).toBe(-1);
	});

	it("compares integer parts before decimals", () => {
		expect(compareRanks("0|i00004:zzz", "0|i00005:")).toBe(-1);
	});
});

describe("rankBetween", () => {
	it("returns the middle for an empty list", () => {
		expect(rankBetween(null, null)).toBe(MIDDLE_RANK);
	});

	it("produces a value strictly between its neighbours", () => {
		const a = "0|i00000:";
		const b = "0|i00004:";
		const mid = rankBetween(a, b);
		expect(compareRanks(a, mid)).toBe(-1);
		expect(compareRanks(mid, b)).toBe(-1);
	});

	it("extends precision for adjacent neighbours", () => {
		const a = "0|i00004:";
		const b = "0|i00005:";
		const mid = rankBetween(a, b);
		expect(compareRanks(a, mid)).toBe(-1);
		expect(compareRanks(mid, b)).toBe(-1);
		expect(parseRank(mid).dec.length).toBeGreaterThan(0);
	});

	it("survives repeated insertion at the same spot", () => {
		// The classic fractional-indexing stress case: always insert immediately
		// after the same task, 200 times. Every rank must stay distinct + ordered.
		let lo = "0|i00004:";
		const hi = "0|i00005:";
		const seen = new Set<string>([lo, hi]);

		for (let i = 0; i < 200; i++) {
			const mid = rankBetween(lo, hi);
			expect(isValidRank(mid)).toBe(true);
			expect(seen.has(mid)).toBe(false);
			expect(compareRanks(lo, mid)).toBe(-1);
			expect(compareRanks(mid, hi)).toBe(-1);
			seen.add(mid);
			lo = mid;
		}
	});

	it("survives repeated bisection (halving the gap each time)", () => {
		let lo = MIN_RANK;
		let hi = MAX_RANK;
		for (let i = 0; i < 200; i++) {
			const mid = rankBetween(lo, hi);
			expect(compareRanks(lo, mid)).toBe(-1);
			expect(compareRanks(mid, hi)).toBe(-1);
			// Alternate which side we shrink so both directions get exercised.
			if (i % 2 === 0) lo = mid;
			else hi = mid;
		}
	});

	it("appends after a rank", () => {
		const last = "0|i00004:";
		const next = rankAfter(last);
		expect(compareRanks(last, next)).toBe(-1);
		expect(compareRanks(next, MAX_RANK)).toBe(-1);
	});

	it("prepends before a rank", () => {
		const first = "0|i00004:";
		const prev = rankBefore(first);
		expect(compareRanks(prev, first)).toBe(-1);
		expect(compareRanks(MIN_RANK, prev)).toBe(-1);
	});

	it("throws when neighbours are passed out of order", () => {
		expect(() => rankBetween("0|i00005:", "0|i00004:")).toThrow(/prev < next/);
		expect(() => rankBetween("0|i00004:", "0|i00004:")).toThrow(/prev < next/);
	});

	it("throws on invalid input", () => {
		expect(() => rankBetween("nonsense", null)).toThrow(/Invalid LexoRank/);
	});
});

describe("initialRanks", () => {
	it("returns nothing for a non-positive count", () => {
		expect(initialRanks(0)).toEqual([]);
		expect(initialRanks(-3)).toEqual([]);
	});

	it("returns the middle for a single item", () => {
		expect(initialRanks(1)).toEqual([MIDDLE_RANK]);
	});

	it("returns distinct, ascending, valid ranks", () => {
		const ranks = initialRanks(50);
		expect(ranks).toHaveLength(50);
		expect(new Set(ranks).size).toBe(50);
		for (const rank of ranks) expect(isValidRank(rank)).toBe(true);
		for (let i = 1; i < ranks.length; i++) {
			expect(compareRanks(ranks[i - 1], ranks[i])).toBe(-1);
		}
		expect(compareRanks(MIN_RANK, ranks[0])).toBe(-1);
		expect(compareRanks(ranks[ranks.length - 1], MAX_RANK)).toBe(-1);
	});

	it("leaves room to insert between any two seeded ranks", () => {
		const ranks = initialRanks(10);
		const mid = rankBetween(ranks[3], ranks[4]);
		expect(compareRanks(ranks[3], mid)).toBe(-1);
		expect(compareRanks(mid, ranks[4])).toBe(-1);
	});
});

describe("rankForPosition", () => {
	const ordered = initialRanks(5);

	it("places at the head", () => {
		const rank = rankForPosition(ordered, 0);
		expect(compareRanks(rank, ordered[0])).toBe(-1);
	});

	it("places in the middle", () => {
		const rank = rankForPosition(ordered, 2);
		expect(compareRanks(ordered[1], rank)).toBe(-1);
		expect(compareRanks(rank, ordered[2])).toBe(-1);
	});

	it("places at the tail", () => {
		const rank = rankForPosition(ordered, ordered.length);
		expect(compareRanks(ordered[ordered.length - 1], rank)).toBe(-1);
	});

	it("clamps out-of-bounds indices", () => {
		expect(rankForPosition(ordered, 99)).toBe(
			rankForPosition(ordered, ordered.length),
		);
		expect(rankForPosition(ordered, -5)).toBe(rankForPosition(ordered, 0));
	});

	it("handles an empty destination (dragging into an empty Kanban column)", () => {
		expect(rankForPosition([], 0)).toBe(MIDDLE_RANK);
	});
});

describe("sortByRank", () => {
	it("sorts ascending and is stable for equal ranks", () => {
		const items = [
			{ id: "c", rank: "0|i00003:" },
			{ id: "a", rank: "0|i00001:" },
			{ id: "b1", rank: "0|i00002:" },
			{ id: "b2", rank: "0|i00002:" },
		];
		expect(sortByRank(items, (i) => i.rank).map((i) => i.id)).toEqual([
			"a",
			"b1",
			"b2",
			"c",
		]);
	});

	it("does not mutate its input", () => {
		const items = [{ rank: "0|i00003:" }, { rank: "0|i00001:" }];
		const copy = [...items];
		sortByRank(items, (i) => i.rank);
		expect(items).toEqual(copy);
	});
});

describe("needsRebalance", () => {
	it("is false for fresh ranks", () => {
		expect(needsRebalance(MIDDLE_RANK)).toBe(false);
	});

	it("is true once the decimal grows long", () => {
		expect(needsRebalance(`0|i00004:${"i".repeat(30)}`)).toBe(true);
	});
});
