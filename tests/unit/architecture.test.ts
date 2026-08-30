/**
 * Architectural guard.
 *
 * CLAUDE.md's Golden Rule — "core domain logic must never import the Obsidian
 * API" — is what keeps every other test in this suite possible. It's also the
 * single easiest rule to break by accident, since importing a type from
 * `obsidian` looks harmless right up until the unit tests can't run at all.
 *
 * So it's checked mechanically rather than left to discipline.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(__dirname, "../../src/core");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry) ? [path] : [];
	});
}

const IMPORT_RE = /\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;

describe("src/core purity", () => {
	const files = sourceFiles(CORE);

	it("finds the core modules", () => {
		expect(files.length).toBeGreaterThan(10);
	});

	it("never imports the Obsidian API", () => {
		const offenders: string[] = [];

		for (const file of files) {
			const source = readFileSync(file, "utf8");
			IMPORT_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = IMPORT_RE.exec(source)) !== null) {
				const specifier = match[1] ?? match[2];
				if (specifier === "obsidian" || specifier.startsWith("obsidian/")) {
					offenders.push(file.slice(file.indexOf("src/")));
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	it("never reaches sideways into the Obsidian or UI layers", () => {
		const offenders: { file: string; specifier: string }[] = [];

		for (const file of files) {
			const source = readFileSync(file, "utf8");
			IMPORT_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = IMPORT_RE.exec(source)) !== null) {
				const specifier = match[1] ?? match[2];
				if (/(^|\/)(\.\.\/)*(obsidian|ui|settings)\//.test(specifier)) {
					offenders.push({ file: file.slice(file.indexOf("src/")), specifier });
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	it("pulls in no runtime dependencies beyond the sanctioned allowlist", () => {
		// Core is pure TypeScript over plain objects. A bare (non-relative)
		// import here would mean a dependency has crept into the domain layer.
		//
		// One exception, deliberately narrow: the markdown template format's
		// frontmatter is real YAML (nested maps, flow arrays, inline scalars),
		// and hand-rolling a YAML subset for it would be a correctness liability
		// in a code path that runs against user-authored files. `yaml` is a pure
		// data library with no platform coupling, so it doesn't compromise what
		// this rule actually protects: that core stays unit-testable without
		// mocking Obsidian.
		const ALLOWED = new Set(["yaml"]);
		const offenders: { file: string; specifier: string }[] = [];

		for (const file of files) {
			const source = readFileSync(file, "utf8");
			IMPORT_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = IMPORT_RE.exec(source)) !== null) {
				const specifier = match[1] ?? match[2];
				if (!specifier.startsWith(".") && !ALLOWED.has(specifier)) {
					offenders.push({ file: file.slice(file.indexOf("src/")), specifier });
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
