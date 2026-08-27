/**
 * The vault index: turns Markdown notes into `WorkspaceSnapshot`s that core
 * logic can reason about, and keeps them fresh as files change.
 *
 * A vault may hold several independent Workspaces (§2), each identified by a
 * `_workspace.md`. Everything below that note's folder belongs to it.
 *
 * Indexing reads structure from Obsidian's **metadata cache**, not from disk —
 * Obsidian has already parsed every note's frontmatter, so a full rebuild costs
 * no file reads at all. The one exception is `@mentions`, which live in note
 * bodies; those are resolved in a second, lazy pass so views render immediately
 * and the "Mentions Me" filter fills in a moment later.
 */

import { App, TFile, debounce } from "obsidian";
import { mentionsInNote } from "../core/serialization/comments";
import {
	parseCycle,
	parseInitiative,
	parseProject,
} from "../core/serialization/entities";
import { parseTask } from "../core/serialization/task";
import { parseViews } from "../core/serialization/views";
import { parseWorkspace } from "../core/serialization/workspace";
import { defaultViews } from "../core/views/defaults";
import { isWithin } from "../core/links";
import type {
	Cycle,
	Initiative,
	Project,
	Task,
	WorkspaceSnapshot,
} from "../core/types";
import { NoteIO, withoutExtension } from "./note-io";

export const WORKSPACE_NOTE = "_workspace";
export const VIEWS_NOTE = "_views";

/** Folder names used when creating notes. Reading tolerates any layout. */
export const FOLDERS = {
	initiatives: "Initiatives",
	projects: "Projects",
	cycles: "Cycles",
	tasks: "Tasks",
} as const;

export type IndexListener = () => void;

export class VaultIndex {
	private snapshots = new Map<string, WorkspaceSnapshot>();
	private issues = new Map<string, string[]>();
	private listeners = new Set<IndexListener>();
	private version = 0;

	/** path → { mtime, mentions }, so unchanged notes are never re-read. */
	private mentionCache = new Map<string, { mtime: number; mentions: string[] }>();

	private readonly scheduleRebuild = debounce(
		() => void this.rebuild(),
		250,
		true,
	);

	constructor(
		private readonly app: App,
		private readonly io: NoteIO,
	) {}

	// -- Lifecycle ------------------------------------------------------------

	/** Wire up vault watching. Returns the events to register with the plugin. */
	watch(register: (unsubscribe: () => void) => void): void {
		const cache = this.app.metadataCache;
		const vault = this.app.vault;

		const onChange = () => this.scheduleRebuild();

		const refs = [
			cache.on("changed", onChange),
			cache.on("deleted", onChange),
			vault.on("create", onChange),
			vault.on("delete", onChange),
			vault.on("rename", onChange),
		];

		for (const ref of refs) {
			register(() => cache.offref(ref));
		}
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Monotonic version counter. React subscribes to this rather than to the
	 * snapshot array, which is rebuilt (and so has a new identity) every pass.
	 */
	get revision(): number {
		return this.version;
	}

	/** Force a repaint without re-indexing — used when a UI setting changes. */
	touch(): void {
		this.notify();
	}

	private notify(): void {
		this.version++;
		for (const listener of this.listeners) listener();
	}

	// -- Reading --------------------------------------------------------------

	/** Every workspace in the vault, ordered by name. */
	list(): WorkspaceSnapshot[] {
		return [...this.snapshots.values()].sort((a, b) =>
			a.workspace.name.localeCompare(b.workspace.name),
		);
	}

	get(root: string): WorkspaceSnapshot | null {
		return this.snapshots.get(root) ?? null;
	}

	/** The workspace a given note belongs to, if any. */
	workspaceFor(path: string): WorkspaceSnapshot | null {
		let best: WorkspaceSnapshot | null = null;
		for (const snapshot of this.snapshots.values()) {
			// Deepest matching root wins, so nested workspaces resolve correctly.
			if (
				isWithin(path, snapshot.workspace.root) &&
				(!best || snapshot.workspace.root.length > best.workspace.root.length)
			) {
				best = snapshot;
			}
		}
		return best;
	}

	taskAt(path: string): Task | null {
		const snapshot = this.workspaceFor(path);
		return snapshot?.tasks.find((task) => task.path === path) ?? null;
	}

	/** Parse problems found in a note, for the "this note has issues" badge. */
	issuesFor(path: string): string[] {
		return this.issues.get(path) ?? [];
	}

	allIssues(): Map<string, string[]> {
		return new Map(this.issues);
	}

	/** Every ID prefix in the vault — the input to §3's collision handling. */
	takenPrefixes(): string[] {
		return [...this.snapshots.values()].map((s) => s.workspace.idPrefix);
	}

	isEmpty(): boolean {
		return this.snapshots.size === 0;
	}

	// -- Building -------------------------------------------------------------

	async rebuild(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const issues = new Map<string, string[]>();

		// Pass 1: find the workspaces. Everything else needs to know which
		// workspace it belongs to (and that workspace's default status).
		const configs = new Map<string, WorkspaceSnapshot>();
		for (const file of files) {
			const path = withoutExtension(file.path);
			if (basenameOf(path) !== WORKSPACE_NOTE) continue;

			const parsed = parseWorkspace(this.io.readFrontmatter(file), { path });
			if (parsed.issues.length > 0) issues.set(path, parsed.issues);

			configs.set(parsed.value.root, {
				workspace: parsed.value,
				tasks: [],
				projects: [],
				initiatives: [],
				cycles: [],
				views: [],
			});
		}

		// Pass 2: sort every other note into its workspace.
		for (const file of files) {
			const path = withoutExtension(file.path);
			const base = basenameOf(path);
			if (base === WORKSPACE_NOTE) continue;

			const snapshot = deepestMatch(configs, path);
			if (!snapshot) continue;

			if (base === VIEWS_NOTE) {
				const parsed = parseViews(this.io.readFrontmatter(file));
				if (parsed.issues.length > 0) issues.set(path, parsed.issues);
				snapshot.views = parsed.value;
				continue;
			}

			const frontmatter = this.io.readFrontmatter(file);
			const kind = entityKindOf(frontmatter, path, snapshot.workspace.root);
			if (!kind) continue;

			const options = {
				path,
				defaultStatus: snapshot.workspace.defaultNewTaskStatus,
			};

			switch (kind) {
				case "task": {
					const parsed = parseTask(frontmatter, {
						...options,
						mentions: this.mentionCache.get(path)?.mentions ?? [],
					});
					if (parsed.issues.length > 0) issues.set(path, parsed.issues);
					snapshot.tasks.push(parsed.value as Task);
					break;
				}
				case "project":
					snapshot.projects.push(parseProject(frontmatter, options).value as Project);
					break;
				case "initiative":
					snapshot.initiatives.push(
						parseInitiative(frontmatter, options).value as Initiative,
					);
					break;
				case "cycle":
					snapshot.cycles.push(parseCycle(frontmatter, options).value as Cycle);
					break;
			}
		}

		// A workspace with no `_views.md` still gets the built-in views, so the
		// sidebar is never empty on a fresh install.
		for (const snapshot of configs.values()) {
			if (snapshot.views.length === 0) snapshot.views = defaultViews();
		}

		this.snapshots = configs;
		this.issues = issues;
		this.notify();

		// Pass 3 (lazy): resolve @mentions from note bodies.
		void this.refreshMentions();
	}

	/**
	 * Read task bodies to resolve `@mentions`, skipping files whose mtime hasn't
	 * moved. Runs after the structural index is already published, so it never
	 * delays a render.
	 */
	private async refreshMentions(): Promise<void> {
		let changed = false;
		const live = new Set<string>();

		for (const snapshot of this.snapshots.values()) {
			const people = snapshot.workspace.people;
			if (people.length === 0) continue;

			for (const task of snapshot.tasks) {
				live.add(task.path);
				const file = this.io.getFile(task.path);
				if (!file) continue;

				const cached = this.mentionCache.get(task.path);
				if (cached && cached.mtime === file.stat.mtime) {
					task.mentions = cached.mentions;
					continue;
				}

				const mentions = mentionsInNote(await this.io.readBody(file), people);
				this.mentionCache.set(task.path, { mtime: file.stat.mtime, mentions });
				task.mentions = mentions;
				changed = true;
			}
		}

		// Drop cache entries for notes that no longer exist.
		for (const path of [...this.mentionCache.keys()]) {
			if (!live.has(path)) this.mentionCache.delete(path);
		}

		if (changed) this.notify();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basenameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function deepestMatch(
	configs: Map<string, WorkspaceSnapshot>,
	path: string,
): WorkspaceSnapshot | null {
	let best: WorkspaceSnapshot | null = null;
	for (const [root, snapshot] of configs) {
		if (isWithin(path, root) && (!best || root.length > best.workspace.root.length)) {
			best = snapshot;
		}
	}
	return best;
}

type EntityKind = "task" | "project" | "initiative" | "cycle";

const FOLDER_KINDS: Record<string, EntityKind> = {
	[FOLDERS.tasks]: "task",
	[FOLDERS.projects]: "project",
	[FOLDERS.initiatives]: "initiative",
	[FOLDERS.cycles]: "cycle",
};

/**
 * Identify a note. Frontmatter `type` is authoritative; the folder is a
 * fallback so a note whose frontmatter got mangled still shows up somewhere
 * instead of silently vanishing from every view.
 */
function entityKindOf(
	frontmatter: Record<string, unknown> | null,
	path: string,
	root: string,
): EntityKind | null {
	const declared = frontmatter?.type;
	if (typeof declared === "string" && declared in FOLDER_KINDS_BY_TYPE) {
		return FOLDER_KINDS_BY_TYPE[declared];
	}

	const relative = root ? path.slice(root.length + 1) : path;
	const folder = relative.split("/")[0];
	return FOLDER_KINDS[folder] ?? null;
}

const FOLDER_KINDS_BY_TYPE: Record<string, EntityKind> = {
	task: "task",
	project: "project",
	initiative: "initiative",
	cycle: "cycle",
};
