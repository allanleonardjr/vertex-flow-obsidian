/**
 * RFC 4180 CSV, hand-rolled (no npm dependency — see the architecture test's
 * allowlist).
 *
 * - Fields containing `,`, `"`, `\r` or `\n` are wrapped in double quotes.
 * - Embedded `"` is doubled.
 * - Rows end with CRLF.
 * - A UTF-8 BOM leads the file so Excel opens non-ASCII content correctly.
 */

import type { DisplayRecord } from "./resolve";
import type { FieldId } from "./fields";

export const UTF8_BOM = "﻿";

export interface CsvColumn {
	id: FieldId;
	label: string;
}

function quoteCell(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

export function buildCsv(
	rows: DisplayRecord[],
	columns: CsvColumn[],
): string {
	const lines: string[] = [];
	lines.push(columns.map((column) => quoteCell(column.label)).join(","));
	for (const row of rows) {
		lines.push(
			columns
				.map((column) => quoteCell(row[column.id] ?? ""))
				.join(","),
		);
	}
	return UTF8_BOM + lines.join("\r\n") + "\r\n";
}
