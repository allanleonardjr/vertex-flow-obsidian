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
import {
	commentCountsInBody,
	mentionsInNote,
} from "../core/serialization/comments";
import { mergeCommentCounts } from "../core/people";
import {
	detectProjectTitleCollisions,
	extractProjectDescription,
	parseProject,
} from "../core/serialization/entities";
import { parseTask } from "../core/serialization/task";
import { parseDescription } from "../core/serialization/description";
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
	SavedView,
	Task,
	TrashedItem,
	WorkspaceConfig,
	WorkspaceSnapshot,
} from "../core/types";
import { NoteIO, withoutExtension } from "./note-io";
import { trashedItemKind } from "./trash-paths";
import { HistoryLog } from "./history-log";
import { SYSTEM_ACTOR_NAME } from "../core/history";
import type { HistoryActor, HistoryTarget } from "../core/types";
import {
	parseLegacyViewDefinition,
	parseLegacyProjectView,
	serializeProjectView,
} from "../core/serialization/views";
import { parseLegacyDashboardFilters } from "../core/serialization/dashboards";
import {
	printQuery,
	printFilters,
	workspaceQueryContext,
	type QueryContext,
} from "../core/query";

export { TRASH_FOLDER } from "./trash-paths";

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

	/** path → { mtime, mentions, commentCounts }, so unchanged notes are never re-read. */
	private mentionCache = new Map<
		string,
		{ mtime: number; mentions: string[]; commentCounts: Record<string, number> }
	>();

	/**
	 * path → { mtime, text }: the `## Description` prose of a task, and the whole
	 * body of a project, so the workspace-search overlay has that text to match
	 * against without re-reading every note per keystroke. Filled by the same
	 * mtime-gated body-read pass as `mentionCache` (`refreshMentions`), and — like
	 * `mentions` — reads empty until that async pass first completes.
	 */
	private descriptionCache = new Map<string, { mtime: number; text: string }>();

	private readonly scheduleRebuild = debounce(
		() => void this.rebuild(),
		250,
		true,
	);

	constructor(
		private readonly app: App,
		private readonly io: NoteIO,
		private readonly history: HistoryLog,
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

	/**
	 * Every workspace in the vault, ordered by name. Soft-deleted workspaces
	 * (`_workspace.md` carrying `deletedAt`) are hidden by default — they stay
	 * indexed and reachable through `get()` so `restoreWorkspace` can find them.
	 */
	list(options?: { includeDeleted?: boolean }): WorkspaceSnapshot[] {
		return [...this.snapshots.values()]
			.filter((s) => options?.includeDeleted || s.workspace.deletedAt == null)
			.sort((a, b) => a.workspace.name.localeCompare(b.workspace.name));
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

	/** The workspace whose People register defines this person, if any. */
	snapshotWithPerson(personId: string): WorkspaceSnapshot | null {
		for (const s of this.snapshots.values())
			if (s.workspace.people.some((p) => p.id === personId)) return s;
		return null;
	}

	/**
	 * Total comments authored by each Person, across every task in this
	 * workspace. Derived from the same mtime-gated body-read pass that already
	 * powers `@mention` resolution — no separate scan. Exactly like `mentions`,
	 * a freshly-added task shows `0` until the async pass completes.
	 */
	commentCountsByPerson(root: string): Record<string, number> {
		const snapshot = this.snapshots.get(root);
		if (!snapshot) return {};
		const tallies: Record<string, number>[] = [];
		for (const task of snapshot.tasks) {
			const cached = this.mentionCache.get(task.path);
			if (cached) tallies.push(cached.commentCounts);
		}
		return mergeCommentCounts(tallies);
	}

	/**
	 * The `## Description` text of a task, cached from its note body. Returns `""`
	 * until the lazy body-read pass has seen the file (same "empty until the pass
	 * finishes" contract as `mentions`) and after the note is deleted.
	 */
	taskDescription(path: string): string {
		return this.descriptionCache.get(path)?.text ?? "";
	}

	/**
	 * A project's description (its whole note body, trimmed), cached from disk.
	 * Same "empty until the lazy pass finishes" contract as `taskDescription`.
	 */
	projectDescription(path: string): string {
		return this.descriptionCache.get(path)?.text ?? "";
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

	hasPerson(personId: string): boolean {
		return this.snapshotWithPerson(personId) != null;
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
		return this.list().length === 0;
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
				trash: [],
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
		for (const [root, snapshot] of configs) {
			const runMigration = async (
				label: string,
				fn: () => Promise<boolean>,
			) => {
				try {
					if (await fn()) migrated = true;
				} catch (err) {
					// A failed migration must not take the whole index down. The
					// notes it did write are already valid; the rest lingers and
					// the next rebuild retries (writing nothing new).
					console.error(`[vertex-flow] ${label} failed for "${root}"`, err);
				}
			};
			await runMigration("config-note migration", () =>
				this.migrateSharedConfigNotes(snapshot.workspace),
			);
			await runMigration("on-close date-mode migration", () =>
				this.migrateOnCloseDateModes(snapshot.workspace),
			);
			await runMigration("view query-format migration", () =>
				this.migrateViewQueries(snapshot.workspace),
			);
			await runMigration("dashboard filter-format migration", () =>
				this.migrateDashboardFilters(snapshot.workspace),
			);
		}
		if (migrated) files = this.app.vault.getMarkdownFiles();

		// Query-resolution context for a workspace's `query:`/`filter:` strings.
		// Workspace-only (no project/task lists): an unresolved entity value is
		// preserved verbatim, so a definition round-trips without them.
		const queryContexts = new Map<string, QueryContext>();
		const contextFor = (snapshot: WorkspaceSnapshot): QueryContext => {
			let ctx = queryContexts.get(snapshot.workspace.root);
			if (!ctx) {
				ctx = workspaceQueryContext(snapshot.workspace);
				queryContexts.set(snapshot.workspace.root, ctx);
			}
			return ctx;
		};

		// Pass 2: sort every other note into its workspace.
		for (const file of files) {
			const path = withoutExtension(file.path);
			const base = basenameOf(path);
			if (base === WORKSPACE_NOTE) continue;

			const snapshot = deepestMatch(configs, path);
			if (!snapshot) continue;

			// A file under `<root>/Trash/` is handled entirely separately — it
			// must never reach `entityKindOf`, which classifies by `type:`
			// frontmatter and would resurface a trashed task as a live one.
			const trashedKind = trashedItemKind(snapshot.workspace.root, path);
			if (trashedKind) {
				snapshot.trash.push(
					await this.parseTrashedFile(snapshot, file, path, trashedKind),
				);
				continue;
			}

			const frontmatter = this.io.readFrontmatter(file);
			const kind = entityKindOf(frontmatter, path, snapshot.workspace.root);
			if (!kind) continue;

			const context = contextFor(snapshot);
			const options = {
				path,
				defaultStatus: snapshot.workspace.defaultNewTaskStatus,
				statuses: snapshot.workspace.statuses,
				context,
			};

			switch (kind) {
				case "task": {
					const parsed = parseTask(frontmatter, {
						...options,
						mentions: this.mentionCache.get(path)?.mentions ?? [],
					});
					if (parsed.issues.length > 0) issues.set(path, parsed.issues);
					snapshot.tasks.push(parsed.value);
					break;
				}
				case "project":
					snapshot.projects.push(parseProject(frontmatter, options).value);
					break;
				case "view": {
					// Read from disk, not the metadata cache: a "New view" the user
					// is watching for may have been written milliseconds ago and the
					// cache would still hold its previous (or no) contents.
					const parsed = parseView(
						await this.io.readConfigFrontmatter(file),
						{ path, context },
					);
					if (parsed.issues.length > 0) issues.set(path, parsed.issues);
					snapshot.views.push(parsed.value);
					break;
				}
				case "dashboard": {
					const parsed = parseDashboard(
						await this.io.readConfigFrontmatter(file),
						{ path, context },
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
	 * Parse one note sitting under `<root>/Trash/<Kind>/` into a `TrashedItem`.
	 * Runs it through the same parser the live path uses — the extra
	 * `vf-trashedAt` key is harmless there (forgiving-parse contract) and is
	 * pulled out separately here. Views/dashboards read from disk, not the
	 * metadata cache, for the same freshness reason the live path does.
	 */
	private async parseTrashedFile(
		snapshot: WorkspaceSnapshot,
		file: TFile,
		path: string,
		kind: EntityKind,
	): Promise<TrashedItem> {
		const readConfig = kind === "view" || kind === "dashboard";
		const frontmatter = readConfig
			? await this.io.readConfigFrontmatter(file)
			: this.io.readFrontmatter(file);

		const stamp = frontmatter?.["vf-trashedAt"];
		const trashedAt = typeof stamp === "string" ? stamp : "";

		const context = workspaceQueryContext(snapshot.workspace);
		const options = {
			path,
			defaultStatus: snapshot.workspace.defaultNewTaskStatus,
			statuses: snapshot.workspace.statuses,
			context,
		};

		const entity: TrashedItem["entity"] =
			kind === "task"
				? parseTask(frontmatter, { ...options, mentions: [] }).value
				: kind === "project"
					? parseProject(frontmatter, options).value
					: kind === "view"
						? parseView(frontmatter, { path, context }).value
						: parseDashboard(frontmatter, { path, context }).value;

		return { kind, trashedAt, entity };
	}

	/** Log one aggregated `[system]` entry per kind a migration touched. */
	private logMigration(
		workspace: WorkspaceConfig,
		action: string,
		targets: HistoryTarget[],
	): void {
		if (targets.length === 0) return;
		const actor: HistoryActor = { kind: "system", name: SYSTEM_ACTOR_NAME };
		this.history.record(workspace, { action, targets, actorOverride: actor });
	}

	/**
	 * Split a workspace's retired `_views.md` / `_dashboards` array notes into
	 * one file per item, then retire the old note to `<name>.legacy`. Idempotent
	 * and safe on every `rebuild()`: the plain existence check up front makes a
	 * second invocation a no-op. Returns whether it wrote anything.
	 */
	private async migrateSharedConfigNotes(
		workspace: WorkspaceConfig,
	): Promise<boolean> {
		const root = workspace.root;
		const ctx = workspaceQueryContext(workspace);
		let did = false;

		// System View entries (current + legacy ids) must never become files.
		const viewTargets = await this.migrateSharedConfigNote(
			root,
			VIEWS_NOTE,
			FOLDERS.views,
			"view",
			(raw) => parseViews(raw),
			(item) => serializeView(item, ctx),
			(id) => !isSystemViewId(id) && id !== LEGACY_SYSTEM_VIEW_UNTRIAGED_ID,
		);
		if (viewTargets) {
			did = true;
			this.logMigration(workspace, "view.migrate-storage", viewTargets.wrote);
		}

		// Dashboards have no System-Item equivalent — migrate every entry.
		const dashTargets = await this.migrateSharedConfigNote(
			root,
			DASHBOARDS_NOTE,
			FOLDERS.dashboards,
			"dashboard",
			(raw) => parseDashboards(raw),
			(item) => serializeDashboard(item, ctx),
			() => true,
		);
		if (dashTargets) {
			did = true;
			this.logMigration(
				workspace,
				"dashboard.migrate-storage",
				dashTargets.wrote,
			);
		}

		return did;
	}

	private async migrateSharedConfigNote<T extends { id: string }>(
		root: string,
		noteName: string,
		folder: string,
		kind: HistoryTarget["kind"],
		parseAll: (raw: Record<string, unknown> | null) => { value: T[] },
		serializeOne: (item: T) => Record<string, unknown>,
		keep: (id: string) => boolean,
	): Promise<{ wrote: HistoryTarget[] } | null> {
		const notePath = joinPath(root, noteName);
		const file = this.io.getFile(notePath);
		if (!file) return null;

		const wrote: HistoryTarget[] = [];
		const { value: items } = parseAll(await this.io.readConfigFrontmatter(file));
		for (const item of items) {
			if (!keep(item.id)) continue;
			const target = joinPath(root, folder, item.id);
			if (this.io.getFile(target)) continue;
			await this.io.create(target, serializeOne(item));
			wrote.push({ kind, id: item.id, path: target });
		}
		// No `.md` — `getMarkdownFiles()` will never surface it again, and it
		// reads as obviously inert to anyone browsing the vault.
		await this.io.rename(file, `${notePath}.legacy`);
		return { wrote };
	}

	/**
	 * Backfill `onCloseStartDateMode`/`onCloseDueDateMode` onto every live
	 * on-close recurrence written before those fields existed. Written
	 * explicitly to frontmatter (never inferred at read time) so a vault's
	 * on-disk state stays the single source of truth: reopening a note in a
	 * plain text editor shows the same schedule the app is running. Idempotent
	 * — a note that already has both keys is left untouched — safe on every
	 * `rebuild()`.
	 */
	private async migrateOnCloseDateModes(
		workspace: WorkspaceConfig,
	): Promise<boolean> {
		const root = workspace.root;
		const touched: HistoryTarget[] = [];
		for (const file of this.io.listFiles(joinPath(root, FOLDERS.tasks))) {
			const frontmatter = this.io.readFrontmatter(file);
			const recurrence = frontmatter?.recurrence as
				| Record<string, unknown>
				| undefined;
			if (!recurrence || recurrence.trigger !== "on-close") continue;
			if (
				recurrence.onCloseStartDateMode != null &&
				recurrence.onCloseDueDateMode != null
			) {
				continue;
			}
			await this.io.updateFrontmatter(file, (fm) => {
				const rec = fm.recurrence as Record<string, unknown> | undefined;
				if (!rec) return;
				rec.onCloseStartDateMode ??= "immediate";
				rec.onCloseDueDateMode ??= "immediate";
			});
			touched.push({
				kind: "task",
				id: asId(frontmatter?.id, file.path),
				path: withoutExtension(file.path),
			});
		}
		this.logMigration(
			workspace,
			"task.migrate-recurrence-date-modes",
			touched,
		);
		return touched.length > 0;
	}

	/**
	 * Cut every `Views/*.md` and `Projects/*.md` `view:` block over from the
	 * retired structured keys (`viewType`/`filters`/`groupBy`/…) to a single
	 * `query:` string — the same text the Query Bar round-trips. Idempotent: a
	 * file already carrying `query` is skipped. Runs in Pass 1 with a
	 * workspace-only `QueryContext`; an unresolved project path / task id is
	 * kept verbatim by the resolver, so the conversion is lossless without the
	 * (not-yet-built) snapshot entity lists.
	 */
	private async migrateViewQueries(
		workspace: WorkspaceConfig,
	): Promise<boolean> {
		const root = workspace.root;
		const ctx = workspaceQueryContext(workspace);
		let wroteAny = false;

		const viewTargets: HistoryTarget[] = [];
		for (const file of this.io.listFiles(joinPath(root, FOLDERS.views))) {
			const fm = await this.io.readConfigFrontmatter(file);
			if (!fm || fm.query != null) continue;
			if (!LEGACY_VIEW_KEYS.some((key) => fm[key] != null)) continue;

			const query = printQuery(parseLegacyViewDefinition(fm), ctx);
			await this.io.updateFrontmatter(file, (draft) => {
				for (const key of LEGACY_VIEW_KEYS) delete draft[key];
				if (query) draft.query = query;
			});
			wroteAny = true;
			viewTargets.push({
				kind: "view",
				id: asId(fm.id, file.path),
				path: withoutExtension(file.path),
			});
		}
		this.logMigration(workspace, "view.migrate-query-format", viewTargets);

		const projectTargets: HistoryTarget[] = [];
		for (const file of this.io.listFiles(joinPath(root, FOLDERS.projects))) {
			const fm = await this.io.readConfigFrontmatter(file);
			const view = fm?.view;
			if (!view || typeof view !== "object") continue;
			const viewRecord = view as Record<string, unknown>;
			if (viewRecord.query != null) continue;
			if (!LEGACY_VIEW_KEYS.some((key) => viewRecord[key] != null)) continue;

			const rebuilt = serializeProjectView(
				parseLegacyProjectView(viewRecord),
				ctx,
			);
			await this.io.updateFrontmatter(file, (draft) => {
				draft.view = rebuilt;
			});
			wroteAny = true;
			projectTargets.push({
				kind: "project",
				id: asId(fm?.title, file.path),
				path: withoutExtension(file.path),
			});
		}
		this.logMigration(
			workspace,
			"project.migrate-query-format",
			projectTargets,
		);

		return wroteAny;
	}

	/**
	 * Cut every `Dashboards/*.md` over from the retired structured `filters:`
	 * block to a single `filter:` string (the filters-only grammar — no layout
	 * tokens). Same idiom and `QueryContext` handling as `migrateViewQueries`.
	 */
	private async migrateDashboardFilters(
		workspace: WorkspaceConfig,
	): Promise<boolean> {
		const root = workspace.root;
		const ctx = workspaceQueryContext(workspace);
		const targets: HistoryTarget[] = [];

		for (const file of this.io.listFiles(joinPath(root, FOLDERS.dashboards))) {
			const fm = await this.io.readConfigFrontmatter(file);
			if (!fm || fm.filter != null || fm.filters == null) continue;

			const filter = printFilters(parseLegacyDashboardFilters(fm), ctx);
			await this.io.updateFrontmatter(file, (draft) => {
				delete draft.filters;
				if (filter) draft.filter = filter;
			});
			targets.push({
				kind: "dashboard",
				id: asId(fm.id, file.path),
				path: withoutExtension(file.path),
			});
		}
		this.logMigration(
			workspace,
			"dashboard.migrate-filter-format",
			targets,
		);
		return targets.length > 0;
	}

	/**
	 * Read task and project bodies, skipping files whose mtime hasn't moved.
	 * Resolves task `@mentions` (+ the per-author comment tally) and caches the
	 * task-description / project-body text for the workspace-search overlay —
	 * every note is read **at most once** per pass, both derived values coming
	 * out of the same string. Runs after the structural index is already
	 * published, so it never delays a render.
	 */
	private async refreshMentions(): Promise<void> {
		let changed = false;
		const liveTasks = new Set<string>();
		const describable = new Set<string>();

		for (const snapshot of this.snapshots.values()) {
			const people = snapshot.workspace.people;

			for (const task of snapshot.tasks) {
				liveTasks.add(task.path);
				describable.add(task.path);
				const file = this.io.getFile(task.path);
				if (!file) continue;

				const cachedMention = this.mentionCache.get(task.path);
				const cachedDesc = this.descriptionCache.get(task.path);
				// With no People register there's nothing to resolve, so an
				// absent mention-cache entry is not itself a reason to re-read.
				const mentionFresh =
					people.length === 0 ||
					(cachedMention != null && cachedMention.mtime === file.stat.mtime);
				const descFresh =
					cachedDesc != null && cachedDesc.mtime === file.stat.mtime;
				if (mentionFresh && descFresh) {
					if (cachedMention) task.mentions = cachedMention.mentions;
					continue;
				}

				const body = await this.io.readBody(file);

				if (people.length > 0) {
					// `@mention` resolution and the per-author comment tally both
					// come out of this one string.
					const mentions = mentionsInNote(body, people);
					this.mentionCache.set(task.path, {
						mtime: file.stat.mtime,
						mentions,
						commentCounts: commentCountsInBody(body),
					});
					task.mentions = mentions;
				}
				this.descriptionCache.set(task.path, {
					mtime: file.stat.mtime,
					text: parseDescription(body),
				});
				changed = true;
			}

			// Projects: their whole body is the description. `refreshMentions`
			// doesn't otherwise touch them, so this is a separate, smaller loop.
			for (const project of snapshot.projects) {
				describable.add(project.path);
				const file = this.io.getFile(project.path);
				if (!file) continue;

				const cached = this.descriptionCache.get(project.path);
				if (cached && cached.mtime === file.stat.mtime) continue;

				const body = await this.io.readBody(file);
				this.descriptionCache.set(project.path, {
					mtime: file.stat.mtime,
					text: extractProjectDescription(body),
				});
				changed = true;
			}
		}

		// Drop cache entries for notes that no longer exist.
		for (const path of [...this.mentionCache.keys()]) {
			if (!liveTasks.has(path)) this.mentionCache.delete(path);
		}
		for (const path of [...this.descriptionCache.keys()]) {
			if (!describable.has(path)) this.descriptionCache.delete(path);
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

/** The retired structured view-definition keys, top-level on a `Views/*.md`
 *  note and nested under `view:` on a Project. Their presence is what marks a
 *  file as still needing the `query:` cutover. */
const LEGACY_VIEW_KEYS = [
	"viewType",
	"filters",
	"groupBy",
	"sortBy",
	"sortDirection",
	"emptyColumnBehavior",
	"hiddenFields",
	"subtaskDisplay",
	"calendarDateField",
	"recurringPreview",
] as const;

/** A history target's `id`: the entity's own id/title, else the filename. */
function asId(raw: unknown, filePath: string): string {
	return typeof raw === "string" && raw
		? raw
		: withoutExtension(basenameOf(filePath));
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

/**
 * `type:` frontmatter value → `EntityKind`. Accepts both the current
 * `vertex-flow-`-prefixed values and the pre-1.1 bare ones, mapped to the same
 * kind — a note the post-rebuild migration hasn't reached yet still classifies
 * correctly rather than falling through to the folder-name fallback.
 */
const FOLDER_KINDS_BY_TYPE: Record<string, EntityKind> = {
	"vertex-flow-task": "task",
	"vertex-flow-project": "project",
	"vertex-flow-view": "view",
	"vertex-flow-dashboard": "dashboard",
	task: "task",
	project: "project",
	view: "view",
	dashboard: "dashboard",
};
