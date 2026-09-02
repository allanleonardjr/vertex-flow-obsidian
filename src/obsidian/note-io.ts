/**
 * Reading and writing notes.
 *
 * Every vault mutation in the plugin goes through here. Two rules it enforces:
 *
 * 1. **Frontmatter edits use `processFrontMatter`.** Obsidian's own API does a
 *    read-modify-write under a file lock and preserves the body byte-for-byte.
 *    Hand-rolling YAML surgery here would be the fastest way to corrupt
 *    someone's notes.
 * 2. **Deletes go to the system trash**, honouring the user's Obsidian setting,
 * because the dialogs are the only confirmation the user gets.
 */

import {
	App,
	TFile,
	TFolder,
	normalizePath,
	parseYaml,
	stringifyYaml,
} from "obsidian";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class NoteIO {
	constructor(private readonly app: App) {}

	// -- Reading --------------------------------------------------------------

	/**
	 * Frontmatter straight from the metadata cache — no file read. This is what
	 * makes indexing a large vault cheap: Obsidian has already parsed it.
	 */
	readFrontmatter(file: TFile): Record<string, unknown> | null {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter ?? null;
	}

	/** Full file contents. */
	async read(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	/** File contents with the frontmatter block stripped off the front. */
	async readBody(file: TFile): Promise<string> {
		const content = await this.app.vault.read(file);
		return stripFrontmatter(content);
	}

	getFile(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(withExtension(path));
		return file instanceof TFile ? file : null;
	}

	/** The folder at a bare (extension-less) path, e.g. a workspace root. */
	getFolder(path: string): TFolder | null {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return folder instanceof TFolder ? folder : null;
	}

	// -- Writing --------------------------------------------------------------

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (!normalized || normalized === "/" || normalized === ".") return;

		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`"${normalized}" exists and is not a folder`);

		// Create parents first — `createFolder` does not do it for us.
		const parent = normalized.split("/").slice(0, -1).join("/");
		if (parent) await this.ensureFolder(parent);
		await this.app.vault.createFolder(normalized);
	}

	/**
	 * Create a note, creating its folder if needed. Refuses to overwrite: every
	 * caller here is creating something new, and a silent overwrite would
	 * destroy a note the user may have written by hand.
	 */
	async create(
		path: string,
		frontmatter: Record<string, unknown>,
		body = "",
	): Promise<TFile> {
		const target = withExtension(normalizePath(path));
		if (this.app.vault.getAbstractFileByPath(target)) {
			throw new Error(`"${target}" already exists`);
		}

		const folder = target.split("/").slice(0, -1).join("/");
		if (folder) await this.ensureFolder(folder);

		return this.app.vault.create(target, renderNote(frontmatter, body));
	}

	/**
	 * Write a frontmatter-only config note (`_workspace`, or one per-file
	 * `Views/<id>` / `Dashboards/<id>`), creating it if absent.
	 */
	async writeConfigNote(
		path: string,
		frontmatter: Record<string, unknown>,
	): Promise<void> {
		const existing = this.getFile(path);
		if (existing) {
			await this.replaceFrontmatter(existing, frontmatter);
		} else {
			await this.create(path, frontmatter);
		}
	}

	/**
	 * Frontmatter of a per-file config note (`Views/<id>` / `Dashboards/<id>`,
	 * and the retired `_views` / `_dashboards` during migration), read straight
	 * from disk rather than the metadata cache.
	 *
	 * These notes are the source of truth the index is built from, and a
	 * mutation writes one and then rebuilds immediately — before Obsidian's
	 * metadata cache has processed the change. The cache would hand back the
	 * *pre-write* contents for a beat, long enough for the UI to close a tab
	 * that was just opened for a freshly created view/dashboard. These notes are
	 * tiny and few next to Tasks, so a direct read of each one per rebuild stays
	 * cheap while always being current.
	 */
	async readConfigFrontmatter(
		file: TFile,
	): Promise<Record<string, unknown> | null> {
		const { frontmatter } = splitNote(await this.read(file));
		return Object.keys(frontmatter).length > 0 ? frontmatter : null;
	}

	/** Edit frontmatter in place through Obsidian's own locked read-modify-write. */
	async updateFrontmatter(
		file: TFile,
		mutate: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, mutate);
	}

	/**
	 * Replace frontmatter wholesale, deleting keys the new object omits.
	 * `processFrontMatter` merges rather than replaces, so removed fields have
	 * to be cleared explicitly.
	 */
	async replaceFrontmatter(
		file: TFile,
		frontmatter: Record<string, unknown>,
	): Promise<void> {
		// `processFrontMatter` types the callback arg as `any`; annotate it so
		// the reads/writes below stay typed.
		await this.app.fileManager.processFrontMatter(
			file,
			(existing: Record<string, unknown>) => {
				for (const key of Object.keys(existing)) {
					if (!(key in frontmatter)) delete existing[key];
				}
				Object.assign(existing, frontmatter);
			},
		);
	}

	/** Replace the body, leaving frontmatter untouched. */
	async setBody(file: TFile, body: string): Promise<void> {
		await this.app.vault.process(file, (content) => {
			const match = FRONTMATTER_RE.exec(content);
			return match ? `${match[0]}${body}` : body;
		});
	}

	/** Read-modify-write the body under the vault lock. */
	async processBody(
		file: TFile,
		mutate: (body: string) => string,
	): Promise<void> {
		await this.app.vault.process(file, (content) => {
			const match = FRONTMATTER_RE.exec(content);
			const prefix = match ? match[0] : "";
			return `${prefix}${mutate(content.slice(prefix.length))}`;
		});
	}

	/**
	 * Move to trash, honouring the user's "deleted files" preference. Accepts a
	 * folder too — deleting a whole workspace trashes its root folder in one go.
	 */
	async trash(file: TFile | TFolder): Promise<void> {
		await this.app.fileManager.trashFile(file);
	}

	/**
	 * Rename/move a note to an exact path, letting Obsidian rewrite every
	 * wikilink that points at it. The path is used verbatim (no `.md` coercion)
	 * — one caller retires a shared config note to `<name>.legacy`, which must
	 * not carry a `.md` extension.
	 *
	 * Note this is a *relocation*, not an identity change. A **title-driven**
	 * rename still never happens for a Task — its filename is its id, which is
	 * the whole point of that decision. But a **Trash move** (a reversible
	 * delete relocating the file into `Workspace/Trash/`, and the restore back
	 * out) does change a Task's path, and goes through here so the wikilinks
	 * pointing at it keep resolving.
	 */
	async rename(file: TFile, newPath: string): Promise<void> {
		await this.app.fileManager.renameFile(file, normalizePath(newPath));
	}

	/** An unused variant of `path`, appending ` 2`, ` 3`… on collision. */
	availablePath(path: string): string {
		const base = normalizePath(path);
		if (!this.app.vault.getAbstractFileByPath(withExtension(base))) return base;
		for (let n = 2; n < 1000; n++) {
			const candidate = `${base} ${n}`;
			if (!this.app.vault.getAbstractFileByPath(withExtension(candidate))) {
				return candidate;
			}
		}
		throw new Error(`No available path near "${path}"`);
	}

	/**
	 * Like `availablePath` but for folders — checks the bare path (no `.md`) and
	 * appends ` 2`, ` 3`… when a file or folder already sits there. Used when
	 * creating a workspace folder so an existing folder is never merged into.
	 */
	availableFolderPath(path: string): string {
		const base = normalizePath(path);
		if (!base || base === "/" || base === ".") return base;
		if (!this.app.vault.getAbstractFileByPath(base)) return base;
		for (let n = 2; n < 1000; n++) {
			const candidate = `${base} ${n}`;
			if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		throw new Error(`No available folder near "${path}"`);
	}
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Internally paths are extension-less; the vault wants `.md`. */
export function withExtension(path: string): string {
	return path.endsWith(".md") ? path : `${path}.md`;
}

/** And back again — the index keys everything by extension-less path. */
export function withoutExtension(path: string): string {
	return path.replace(/\.md$/i, "");
}

export function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_RE, "");
}

export function renderNote(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	return `---\n${yaml}\n---\n${body}`;
}

/** Parse a raw note into frontmatter + body — used by tests and importers. */
export function splitNote(content: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) return { frontmatter: {}, body: content };
	try {
		// `parseYaml` (Obsidian's yaml re-export) returns `any`; hold it as
		// `unknown` so the shape check below is what grants the type.
		const parsed: unknown = parseYaml(match[1]);
		return {
			frontmatter:
				parsed && typeof parsed === "object" && !Array.isArray(parsed)
					? (parsed as Record<string, unknown>)
					: {},
			body: content.slice(match[0].length),
		};
	} catch {
		// Malformed YAML shouldn't take a view down; treat it as no frontmatter.
		return { frontmatter: {}, body: content.slice(match[0].length) };
	}
}
