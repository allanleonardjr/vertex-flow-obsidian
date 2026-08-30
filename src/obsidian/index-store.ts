/**
 * The vault index: turns Markdown notes into `WorkspaceSnapshot`s that core
 * logic can reason about, and keeps them fresh as files change.
 *
 * A vault may hold several independent Workspaces, each identified by a
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
	detectProjectTitleCollisions,
	parseProject,
} from "../core/serialization/entities";
import { parseTask } from "../core/serialization/task";
import {
	detectViewIdCollisions,
	parseView,
	parseViews,
	serializeView,
} from "../core/serialization/views";
import {
	detectDashboardIdCollisions,
	parseDashboard,
	parseDashboards,
	serializeDashboard,
} from "../core/serialization/dashboards";
import { parseWorkspace } from "../core/serialization/workspace";
import { detectPrefixCollisions } from "../core/ids";
import {
	LEGACY_SYSTEM_VIEW_ALL_TASKS_NAME,
	LEGACY_SYSTEM_VIEW_UNTRIAGED_ID,
	LEGACY_SYSTEM_VIEW_UNTRIAGED_NAME,
	SYSTEM_VIEW_ALL_TASKS_ID,
	SYSTEM_VIEW_ALL_TASKS_NAME,
	SYSTEM_VIEW_UNTRIAGED_ID,
	SYSTEM_VIEW_UNTRIAGED_NAME,
	defaultViews,
	isSystemViewId,
} from "../core/views/defaults";
import { isWithin, joinPath } from "../core/links";
import type {
	EntityKind,
	Project,
	SavedView,
	Task,
	WorkspaceSnapshot,
} from "../core/types";
import { NoteIO, withoutExtension } from "./note-io";

export const WORKSPACE_NOTE = "_workspace";
/** Retired shared config notes — only referenced by the one-time migration. */
export const VIEWS_NOTE = "_views";
export const DASHBOARDS_NOTE = "_dashboards";

/** Folder names used when creating notes. Reading tolerates any layout. */
export const FOLDERS = {
	projects: "Projects",
	tasks: "Tasks",
	views: "Views",
	dashboards: "Dashboards",
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

	/**
	 * Vault-wide existence checks, used by App.tsx's tab-prune effects: a
	 * View/Dashboard/Label/Project tab may belong to a workspace other than the
	 * one currently on screen (Tabs live above the per-workspace remount
	 * boundary), so pruning must check every workspace — not just the active
	 * snapshot — or it silently closes other workspaces' tabs on every switch.
	 */
	/** The workspace holding this Saved View's `Views/<id>.md`, if any. */
	snapshotWithView(viewId: string): WorkspaceSnapshot | null {
		for (const s of this.snapshots.values())
			if (s.views.some((v) => v.id === viewId)) return s;
		return null;
	}

	/** The workspace holding this dashboard's `Dashboards/<id>.md`, if any. */
	snapshotWithDashboard(dashboardId: string): WorkspaceSnapshot | null {
		for (const s of this.snapshots.values())
			if (s.dashboards.some((d) => d.id === dashboardId)) return s;
		return null;
	}

	/** The workspace whose taxonomy defines this label, if any. */
	snapshotWithLabel(labelId: string): WorkspaceSnapshot | null {
		for (const s of this.snapshots.values())
			if (s.workspace.labels.some((l) => l.id === labelId)) return s;
		return null;
	}

	hasView(viewId: string): boolean {
		return this.snapshotWithView(viewId) != null;
	}

	hasDashboard(dashboardId: string): boolean {
		return this.snapshotWithDashboard(dashboardId) != null;
	}

	hasLabel(labelId: string): boolean {
		return this.snapshotWithLabel(labelId) != null;
	}

	hasProject(path: string): boolean {
		return this.workspaceFor(path)?.projects.some((p) => p.path === path) ?? false;
	}

	/** Parse problems found in a note, for the "this note has issues" badge. */
	issuesFor(path: string): string[] {
		return this.issues.get(path) ?? [];
	}

	allIssues(): Map<string, string[]> {
		return new Map(this.issues);
	}

	/** Every ID prefix in the vault — the input to the collision handling. */
	takenPrefixes(): string[] {
		return [...this.snapshots.values()].map((s) => s.workspace.idPrefix);
	}

	isEmpty(): boolean {
		return this.snapshots.size === 0;
	}

	// -- Building -------------------------------------------------------------

	async rebuild(): Promise<void> {
		let files = this.app.vault.getMarkdownFiles();
		const issues = new Map<string, string[]>();
		const addIssue = (path: string, message: string) => {
			const list = issues.get(path);
			if (list) list.push(message);
			else issues.set(path, [message]);
		};

		// Pass 1: find the workspaces. Everything else needs to know which
		// workspace it belongs to (and that workspace's default status).
		const configs = new Map<string, WorkspaceSnapshot>();
		const prefixEntries: {
			notePath: string;
			name: string;
			idPrefix: string;
		}[] = [];
		for (const file of files) {
			const path = withoutExtension(file.path);
			if (basenameOf(path) !== WORKSPACE_NOTE) continue;

			const parsed = parseWorkspace(this.io.readFrontmatter(file), { path });
			for (const message of parsed.issues) addIssue(path, message);

			configs.set(parsed.value.root, {
				workspace: parsed.value,
				tasks: [],
				projects: [],
				views: [],
				dashboards: [],
			});
			prefixEntries.push({
				notePath: path,
				name: parsed.value.name,
				idPrefix: parsed.value.idPrefix,
			});
		}

		// Two workspaces sharing an `idPrefix` break short-form wikilink
		// resolution. Not fatal — both still load — but flagged on each
		// `_workspace.md` through the same "this note has issues" surface.
		for (const collision of detectPrefixCollisions(prefixEntries)) {
			const others = collision.others.map((name) => `"${name}"`).join(", ");
			addIssue(
				collision.notePath,
				`ID prefix "${collision.prefix}" is also used by ${others}. ` +
					`Task links may resolve to the wrong workspace — change one prefix in workspace settings.`,
			);
		}

		// One-time migration off the retired shared `_views.md` / `_dashboards`
		// config notes: each non-System-View entry becomes its own file under
		// `Views/` / `Dashboards/`, then the old note is retired to `*.legacy`
		// (no `.md`, so `getMarkdownFiles()` never returns it again). The
		// existence check inside makes repeated `rebuild()` calls a no-op once a
		// workspace has migrated. Runs before Pass 2 so the freshly-written
		// files are classified in the same rebuild — hence the re-list.
		let migrated = false;
		for (const root of configs.keys()) {
			try {
				if (await this.migrateSharedConfigNotes(root)) migrated = true;
			} catch (err) {
				// A failed migration must not take the whole index down. The
				// per-file notes it did write are already valid; the old note
				// lingers and the next rebuild retries (writing nothing new).
				console.error(`[vertex-flow] config-note migration failed for "${root}"`, err);
			}
		}
		if (migrated) files = this.app.vault.getMarkdownFiles();

		// Pass 2: sort every other note into its workspace.
		for (const file of files) {
			const path = withoutExtension(file.path);
			const base = basenameOf(path);
			if (base === WORKSPACE_NOTE) continue;

			const snapshot = deepestMatch(configs, path);
			if (!snapshot) continue;

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
				case "view": {
					// Read from disk, not the metadata cache: a "New view" the user
					// is watching for may have been written milliseconds ago and the
					// cache would still hold its previous (or no) contents.
					const parsed = parseView(
						await this.io.readConfigFrontmatter(file),
						{ path },
					);
					if (parsed.issues.length > 0) issues.set(path, parsed.issues);
					snapshot.views.push(parsed.value);
					break;
				}
				case "dashboard": {
					const parsed = parseDashboard(
						await this.io.readConfigFrontmatter(file),
						{ path },
					);
					if (parsed.issues.length > 0) issues.set(path, parsed.issues);
					snapshot.dashboards.push(parsed.value);
					break;
				}
			}
		}

		// Two `Views/*.md` (or `Dashboards/*.md`) notes resolving to the same id
		// make lookups ambiguous — flagged per file like a project-title clash.
		for (const snapshot of configs.values()) {
			for (const collision of detectViewIdCollisions(snapshot.views)) {
				addIssue(
					collision.path,
					`Another view in this workspace also has the id "${collision.id}" — ` +
						`rename one so it can be opened and saved reliably.`,
				);
			}
			for (const collision of detectDashboardIdCollisions(snapshot.dashboards)) {
				addIssue(
					collision.path,
					`Another dashboard in this workspace also has the id "${collision.id}" — ` +
						`rename one so it can be opened and saved reliably.`,
				);
			}
		}

		// Two projects in one workspace sharing a title (case-insensitive) make
		// `project:` filters and links ambiguous. Not fatal — both load —
		// but flagged on each note the same way an ID-prefix collision is.
		for (const snapshot of configs.values()) {
			for (const collision of detectProjectTitleCollisions(snapshot.projects)) {
				addIssue(
					collision.path,
					`Another project in this workspace is also named "${collision.title}" — ` +
						`rename one so project: filters and links resolve correctly.`,
				);
			}
		}

		// The two permanent System Views are synthetic — never files — so they're
		// injected into every workspace here, ahead of the user's own views, so
		// the sidebar is never empty on a fresh install. Legacy data is remapped
		// in memory (a user who deliberately renamed "All Tasks" keeps their
		// name; it persists on their next edit); a real per-file view colliding
		// with a System View id would already have been dropped during migration.
		for (const snapshot of configs.values()) {
			injectSystemViews(snapshot.views, snapshot.workspace.root);
		}

		this.snapshots = configs;
		this.issues = issues;
		this.notify();

		// Pass 3 (lazy): resolve @mentions from note bodies.
		void this.refreshMentions();
	}

	/**
	 * Split a workspace's retired `_views.md` / `_dashboards` array notes into
	 * one file per item, then retire the old note to `<name>.legacy`. Idempotent
	 * and safe on every `rebuild()`: the plain existence check up front makes a
	 * second invocation a no-op. Returns whether it wrote anything.
	 */
	private async migrateSharedConfigNotes(root: string): Promise<boolean> {
		let did = false;
		// System View entries (current + legacy ids) must never become files.
		if (
			await this.migrateSharedConfigNote(
				root,
				VIEWS_NOTE,
				FOLDERS.views,
				(raw) => parseViews(raw),
				serializeView,
				(id) => !isSystemViewId(id) && id !== LEGACY_SYSTEM_VIEW_UNTRIAGED_ID,
			)
		) {
			did = true;
		}
		// Dashboards have no System-Item equivalent — migrate every entry.
		if (
			await this.migrateSharedConfigNote(
				root,
				DASHBOARDS_NOTE,
				FOLDERS.dashboards,
				(raw) => parseDashboards(raw),
				serializeDashboard,
				() => true,
			)
		) {
			did = true;
		}
		return did;
	}

	private async migrateSharedConfigNote<T extends { id: string }>(
		root: string,
		noteName: string,
		folder: string,
		parseAll: (raw: Record<string, unknown> | null) => { value: T[] },
		serializeOne: (item: T) => Record<string, unknown>,
		keep: (id: string) => boolean,
	): Promise<boolean> {
		const notePath = joinPath(root, noteName);
		const file = this.io.getFile(notePath);
		if (!file) return false;

		const { value: items } = parseAll(await this.io.readConfigFrontmatter(file));
		for (const item of items) {
			if (!keep(item.id)) continue;
			const target = joinPath(root, folder, item.id);
			if (this.io.getFile(target)) continue;
			await this.io.create(target, serializeOne(item));
		}
		// No `.md` — `getMarkdownFiles()` will never surface it again, and it
		// reads as obviously inert to anyone browsing the vault.
		await this.io.rename(file, `${notePath}.legacy`);
		return true;
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

/**
 * Guarantee both permanent System Views exist in `views` (in memory only),
 * remapping any pre-rename data first. Mutates the array in place.
 */
function injectSystemViews(views: SavedView[], root: string): void {
	// "Inbox" → "Untriaged": the id changed (name too, if it's still the old
	// default). Persisted on the view's next edit; migration also drops it, so
	// this only bites during the transitional rebuild or on hand-placed files.
	for (const view of views) {
		if (view.id === LEGACY_SYSTEM_VIEW_UNTRIAGED_ID) {
			view.id = SYSTEM_VIEW_UNTRIAGED_ID;
			if (view.name === LEGACY_SYSTEM_VIEW_UNTRIAGED_NAME) {
				view.name = SYSTEM_VIEW_UNTRIAGED_NAME;
			}
		}
	}

	const allTasks = views.find((v) => v.id === SYSTEM_VIEW_ALL_TASKS_ID);
	if (allTasks && allTasks.name === LEGACY_SYSTEM_VIEW_ALL_TASKS_NAME) {
		allTasks.name = SYSTEM_VIEW_ALL_TASKS_NAME;
	}

	const defaults = defaultViews().map((v) => ({
		...v,
		path: joinPath(root, FOLDERS.views, v.id),
	}));
	if (!views.some((v) => v.id === SYSTEM_VIEW_UNTRIAGED_ID)) {
		views.unshift(defaults[1]);
	}
	if (!views.some((v) => v.id === SYSTEM_VIEW_ALL_TASKS_ID)) {
		views.unshift(defaults[0]);
	}
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

const FOLDER_KINDS: Record<string, EntityKind> = {
	[FOLDERS.tasks]: "task",
	[FOLDERS.projects]: "project",
	[FOLDERS.views]: "view",
	[FOLDERS.dashboards]: "dashboard",
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
	view: "view",
	dashboard: "dashboard",
};
