/**
 * The spawn planner — the pure half of "when does a chain advance".
 *
 * `spawnPlans` turns one node into zero or more `OccurrencePlan`s; the Obsidian
 * glue layer writes them. All of the rules below live here so the flooding and
 * gap-policy behavior is unit-testable without a vault:
 *
 * - A node only fires when its trigger condition and its schedule both say so.
 * - A node never spawns while a successor already exists (idempotency — a
 *   deleted successor can legitimately re-extend the chain).
 * - `on-close` skips missed cadence points and lands the occurrence on the next
 *   future point; `on-date` backfills them under the gap policy.
 * - `endsAfter` and `endsOn` cap the series; the terminal occurrence carries no
 *   recurrence block, so a finished chain stops cleanly.
 */

import type {
	IsoDate,
	LinkTarget,
	RecurrenceConfig,
	Task,
	WorkspaceSnapshot,
} from "../types";
import { dayNumber } from "../views/timeline";
import { chainLength, nextInChain } from "./chain";
import {
	MAX_RECURRENCE_BACKFILL,
	cadencePoints,
	firstOccurrenceOnOrAfter,
	nextOccurrence,
	shiftOccurrenceDates,
} from "./engine";

export { MAX_RECURRENCE_BACKFILL } from "./engine";

/**
 * Whether `node`'s status has satisfied its trigger. `triggerStatus` is
 * deliberately permissive: any configured status can fire, so "when it reaches
 * Review" is a real, supported workflow — not just completed.
 */
export function nodeMatchesTrigger(
	node: Task,
	rule: RecurrenceConfig,
	snapshot: WorkspaceSnapshot,
): boolean {
	if (rule.trigger === "on-date") return true;
	if (rule.triggerStatus == null) {
		const status = snapshot.workspace.statuses.find(
			(status) => status.id === node.status,
		);
		return status?.category === "completed";
	}
	return node.status === rule.triggerStatus;
}

/** One occurrence the glue layer should write. */
export interface OccurrencePlan {
	/** The predecessor note this occurrence inherits its identity from. */
	sourcePath: LinkTarget;
	/** The day this occurrence lands on (its `anchor` field). */
	date: IsoDate;
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
	/**
	 * The recurrence block the successor note carries — an advanced copy of the
	 * source's, or `null` when this occurrence is the series' terminal note.
	 */
	recurrence: RecurrenceConfig | null;
}

/** Occurrences still budgeted for this series, by `endsAfter`. */
function remainingOccurrences(
	node: Task,
	rule: RecurrenceConfig,
	snapshot: WorkspaceSnapshot,
): number {
	if (rule.endsAfter == null) return Number.POSITIVE_INFINITY;
	return Math.max(0, rule.endsAfter - chainLength(snapshot, node));
}

function successorRule(
	rule: RecurrenceConfig,
	day: IsoDate,
	terminal: boolean,
): RecurrenceConfig | null {
	return terminal ? null : { ...rule, nextDate: nextOccurrence(rule, day) };
}

function buildPlan(
	node: Task,
	rule: RecurrenceConfig,
	day: IsoDate,
	terminal: boolean,
): OccurrencePlan {
	return {
		sourcePath: node.path,
		date: day,
		...shiftOccurrenceDates(node, rule.anchor, day),
		recurrence: successorRule(rule, day, terminal),
	};
}

/**
 * The occurrence plans a single node wants spawned today. Returns `[]` for a
 * node that is quiescent (not yet due, out of budget, already fired, or with a
 * trigger the status hasn't met).
 */
export function spawnPlans(
	snapshot: WorkspaceSnapshot,
	node: Task,
	today: IsoDate,
): OccurrencePlan[] {
	const rule = node.recurrence;
	if (!rule) return [];

	// Idempotency: a successor sitting after this node means the chain already
	// advanced past it. Flood-proof by construction — a completed reconcile is
	// a no-op on relaunch.
	if (nextInChain(snapshot, node)) return [];

	// Daily-graph edge: an intermediate node of a previous multi-backfill holds
	// nextDate <= today but its own successor exists, handled above.

	if (rule.trigger === "on-close" && !nodeMatchesTrigger(node, rule, snapshot)) {
		return [];
	}
	if (
		rule.trigger === "on-date" &&
		dayNumber(rule.nextDate) > dayNumber(today)
	) {
		return [];
	}

	const occurrenceDay =
		rule.trigger === "on-close"
			? firstOccurrenceOnOrAfter(rule, rule.nextDate, today)
			: rule.nextDate;

	// Ends-on: no occurrence lands strictly after this date.
	if (rule.endsOn && dayNumber(occurrenceDay) > dayNumber(rule.endsOn)) {
		return [];
	}

	const remaining = remainingOccurrences(node, rule, snapshot);
	if (remaining <= 0) return [];

	if (rule.trigger === "on-close") {
		return [buildPlan(node, rule, occurrenceDay, remaining === 1)];
	}

	// On date — gap policy. Every missed cadence point through today would
	// otherwise cascade one-file-per-point on reopen.
	let points = cadencePoints(rule, rule.nextDate, today);
	if (points.length === 0) return [];

	if (rule.endsOn) {
		points = points.filter((point) => dayNumber(point) <= dayNumber(rule.endsOn!));
	}
	if (points.length === 0) return [];

	if (points.length > MAX_RECURRENCE_BACKFILL) {
		// Jump past the backlog: materialize the most recent missed point, and
		// the schedule it carries advances the chain into the future again.
		points = [points[points.length - 1]];
	}

	// The series budget can end mid-gap; keep only the newest points that fit.
	if (points.length > remaining) {
		points = points.slice(points.length - remaining);
	}

	const plans = points.map((point, index) =>
		buildPlan(node, rule, point, index === points.length - 1 && remaining === points.length),
	);
	return plans;
}

/**
 * Every plan across the whole workspace for one reconcile pass, keyed by the
 * node that asked for them. Multiple nodes may legitimately plan in the same
 * pass (independent chains); each node's plans become one batch of writes.
 */
export function reconcilePlans(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
): Map<LinkTarget, OccurrencePlan[]> {
	const plans = new Map<LinkTarget, OccurrencePlan[]>();
	for (const node of snapshot.tasks) {
		if (!node.recurrence) continue;
		const nodePlans = spawnPlans(snapshot, node, today);
		if (nodePlans.length > 0) plans.set(node.path, nodePlans);
	}
	return plans;
}