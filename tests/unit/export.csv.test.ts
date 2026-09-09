import { describe, expect, it } from "vitest";
import { buildCsv, UTF8_BOM } from "../../src/core/export/csv";
import type { DisplayRecord } from "../../src/core/export/resolve";
import type { CsvColumn } from "../../src/core/export/csv";

const columns: CsvColumn[] = [
	{ id: "id", label: "ID" },
	{ id: "title", label: "Title" },
	{ id: "labels", label: "Labels" },
];

describe("buildCsv", () => {
	it("starts with a UTF-8 BOM and a header row", () => {
		const out = buildCsv([], columns);
		expect(out.startsWith(UTF8_BOM)).toBe(true);
		expect(out.slice(UTF8_BOM.length)).toBe("ID,Title,Labels\r\n");
	});

	it("quotes cells with commas, quotes and newlines (RFC 4180)", () => {
		const rows: DisplayRecord[] = [
			{ id: "TSK-1", title: 'a "quoted", value', labels: "one, two" },
			{ id: "TSK-2", title: "line one\nline two", labels: "" },
		];
		const lines = buildCsv(rows, columns).slice(UTF8_BOM.length).split("\r\n");
		expect(lines[1]).toBe('TSK-1,"a ""quoted"", value","one, two"');
		expect(lines[2]).toBe('TSK-2,"line one\nline two",');
	});

	it("joins labels and leaves plain values unquoted", () => {
		const out = buildCsv(
			[{ id: "TSK-3", title: "plain", labels: "backend" }],
			columns,
		);
		expect(out.slice(UTF8_BOM.length).split("\r\n")[1]).toBe(
			"TSK-3,plain,backend",
		);
	});

	it("handles an empty workspace (header only, trailing CRLF)", () => {
		expect(buildCsv([], columns)).toBe(`${UTF8_BOM}ID,Title,Labels\r\n`);
	});

	it("fills missing fields with an empty cell", () => {
		const out = buildCsv([{ id: "TSK-4" }], columns).slice(UTF8_BOM.length);
		expect(out.split("\r\n")[1]).toBe("TSK-4,,");
	});
});
