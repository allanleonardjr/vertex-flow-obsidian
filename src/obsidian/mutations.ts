/**
 * Every write the plugin performs.
 *
 * The pattern throughout: **core decides, this layer applies.** A drag computes
 * its new rank in `src/core/ranking`; a deletion computes its plan in
 * `src/core/hierarchy`. Nothing here re-derives domain rules — it turns a plan
 * into vault operations and nothing more.
 */

import { App, Notice, TFile } from "obsidian";
import { nextTaskId, suggestPrefix } from "../core/ids";
import { formatLink, joinPath } from "../core/links";
import { planReorder, rankForNewTask } from "../core/ranking";
import { generateSampleWorkspace } from "../core/sample/generate";
import {
	nextCommentId,
	parseComments,
	withComments,
} from "../core/serialization/comments";
import {
	extractDescription,
	withDescription,
} from "../core/serialization/description";
import { serializeProject } from "../core/serialization/entities";
import { serializeTask } from "../core/serialization/task";
import { serializeViews } from "../core/serialization/views";
import {
	createWorkspaceConfig,
	serializeWorkspace,
} from "../core/serialization/workspace";
import {
	addValue,
	applyTaxonomyDeletion,
	findValueByName,
	reassignValue,
	reassignValues,
	updateValue,
	workspaceTaxonomies,
	type Taxonomy,
	type TaxonomyDeletionPlan,
} from "../core/taxonomy";
import { withTaxonomy } from "../core/taxonomy";
import { TAXONOMY_PALETTE } from "../core/taxonomy/defaults";
import { defaultViews } from "../core/views/defaults";
import {
	emptyRelations,
	type Comment,
	type Project,
	type SavedView,
	type Task,
	type WorkspaceConfig,
	type WorkspaceSnapshot,
} from "../core/types";
import {
	applyDeletion,
	danglingRelationEdits,
	scopeOf,
	type DeletionChoice,
	type DeletionOutcome,
	type DeletionPlan,
} from "../core/hierarchy";
import { FOLDERS, VaultIndex, VIEWS_NOTE, WORKSPACE_NOTE } from "./index-store";
import { NoteIO } from "./note-io";

export interface NewTaskInput {
	title: string;
	status?: string;
	priority?: string | null;
	taskType?: string | null;
	assignee?: string | null;
	project?: string | null;
	parent?: string | null;
	labels?: string[];
	estimate?: number | null;
	startDate?: string | null;
	dueDate?: string | null;
	description?: string;
}

export class Mutations {
	constructor(
		private readonly app: App,
		private readonly io: NoteIO,
		private readonly index: VaultIndex,
	) {}

	// -- Tasks ----------------------------------------------------------------

	async createTask(
		snapshot: WorkspaceSnapshot,
		input: NewTaskInput,
	): Promise<TFile> {
		const workspace = snapshot.workspace;
		const id = nextTaskId(
			workspace.idPrefix,
			snapshot.tasks.map((task) => task.id),
		);
		const path = joinPath(workspace.root, FOLDERS.tasks, id);
		const now = new Date().toISOString();

		// New tasks land at the top of whatever they're joining, so the person
		// who just created one can actually see it.
		const siblings = input.parent
			? snapshot.tasks.filter((task) => task.parent === input.parent)
			: snapshot.tasks;

		const task: Task = {
			type: "task",
			id,
			title: input.title.trim() || id,
			taskType: input.taskType ?? null,
			status: input.status ?? workspace.defaultNewTaskStatus,
			priority: input.priority ?? null,
			rank: rankForNewTask(siblings),
			project: input.project ?? null,
			parent: input.parent ?? null,
			assignee: input.assignee ?? null,
			estimate: input.estimate ?? null,
			labels: input.labels ?? [],
			startDate: input.startDate ?? null,
			dueDate: input.dueDate ?? null,
			archived: false,
			archivedAt: null,
			relations: emptyRelations(),
			createdAt: now,
			updatedAt: now,
			path,
			mentions: [],
		};

		const body = input.description?.trim()
			? `## Description\n${input.description.trim()}\n`
			: "";

		const file = await this.io.create(path, serializeTask(task), body);
		await this.index.rebuild();
		return file;
	}

	/**
	 * Patch a task's frontmatter. `updatedAt` is stamped here rather than by
	 * each caller, so no code path can forget it.
	 */
	async updateTask(task: Task, patch: Partial<Task>): Promise<void> {
		const file = this.requireFile(task.path);
		const merged: Task = { ...task, ...patch, updatedAt: new Date().toISOString() };
		await this.io.replaceFrontmatter(file, serializeTask(merged));
	}

	async setStatus(task: Task, status: string): Promise<void> {
		await this.updateTask(task, { status });
	}

	async setPriority(task: Task, priority: string | null): Promise<void> {
		await this.updateTask(task, { priority });
	}

	async setAssignee(task: Task, assignee: string | null): Promise<void> {
		await this.updateTask(task, { assignee });
	}

	async setLabels(task: Task, labels: string[]): Promise<void> {
		await this.updateTask(task, { labels });
	}

	/**
	 * Archiving is a visibility flag, not a location (§7.7) — the note never
	 * moves folders, which is what keeps wikilinks stable.
	 */
	async setArchived(task: Task, archived: boolean): Promise<void> {
		await this.updateTask(task, {
			archived,
			archivedAt: archived ? new Date().toISOString() : null,
		});
	}

	/** Re-parenting is a one-field edit, never a file move (Golden Rule). */
	async reparent(
		task: Task,
		parent: { kind: "task" | "project" | "none"; path?: string },
	): Promise<void> {
		await this.updateTask(task, {
			parent: parent.kind === "task" ? (parent.path ?? null) : null,
			project: parent.kind === "project" ? (parent.path ?? null) : null,
		});
	}

	/**
	 * Apply a drag. `siblings` is the destination column verbatim; the ranking
	 * engine handles whether this is a reorder or a cross-column move.
	 */
	async moveTask(
		task: Task,
		siblings: Task[],
		toIndex: number,
		fieldEdit?: Partial<Task>,
	): Promise<void> {
		const assignment = planReorder(task, siblings, toIndex);
		await this.updateTask(task, { rank: assignment.rank, ...fieldEdit });
	}

	/** Bulk edit across a multi-selection (§9.3). */
	async bulkUpdate(tasks: Task[], patch: Partial<Task>): Promise<void> {
		for (const task of tasks) {
			await this.updateTask(task, patch);
		}
		new Notice(`Updated ${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
	}

	// -- Note body ------------------------------------------------------------

	/** The task note's full text — frontmatter and body, exactly as on disk. */
	async readRaw(task: Task): Promise<string> {
		const file = this.io.getFile(task.path);
		return file ? this.io.read(file) : "";
	}

	/**
	 * The parts of a task that live in the body rather than in frontmatter.
	 * Read on demand — the index deliberately doesn't hold these, so opening a
	 * board never costs a file read per card.
	 */
	async readDocument(
		task: Task,
	): Promise<{ description: string; comments: Comment[] }> {
		const file = this.io.getFile(task.path);
		if (!file) return { description: "", comments: [] };
		const body = await this.io.readBody(file);
		return { description: extractDescription(body), comments: parseComments(body) };
	}

	/**
	 * Write the description into the note's `## Description` section, leaving
	 * every other section — and the comment block — untouched.
	 */
	async setDescription(task: Task, text: string): Promise<void> {
		const file = this.requireFile(task.path);
		await this.io.processBody(file, (body) => withDescription(body, text));
		// Stamp `updatedAt`; the body write doesn't touch frontmatter.
		await this.updateTask(task, {});
	}

	// -- Comments -------------------------------------------------------------

	async addComment(task: Task, author: string, body: string): Promise<void> {
		const file = this.requireFile(task.path);
		await this.io.processBody(file, (content) => {
			const comments = parseComments(content);
			const comment: Comment = {
				id: nextCommentId(comments),
				author,
				date: new Date().toISOString(),
				body: body.trim(),
				reactions: {},
			};
			return withComments(content, [...comments, comment]);
		});
		await this.updateTask(task, {});
	}

	async deleteComment(task: Task, commentId: string): Promise<void> {
		const file = this.requireFile(task.path);
		await this.io.processBody(file, (content) =>
			withComments(
				content,
				parseComments(content).filter((comment) => comment.id !== commentId),
			),
		);
	}

	async toggleReaction(
		task: Task,
		commentId: string,
		emoji: string,
	): Promise<void> {
		const file = this.requireFile(task.path);
		await this.io.processBody(file, (content) => {
			const comments = parseComments(content).map((comment) => {
				if (comment.id !== commentId) return comment;
				const reactions = { ...comment.reactions };
				// No per-user reaction tracking in v1 — there's no auth, so a
				// reaction is just a counter anyone can bump.
				reactions[emoji] = (reactions[emoji] ?? 0) + 1;
				return { ...comment, reactions };
			});
			return withComments(content, comments);
		});
	}

	// -- Deletion (§7.8) ------------------------------------------------------

	/**
	 * Apply one confirmed deletion dialog. Returns any follow-up plans, each of
	 * which the caller must present as its own dialog — this method deliberately
	 * will not run them itself.
	 */
	async applyDeletionPlan(
		snapshot: WorkspaceSnapshot,
		plan: DeletionPlan,
		choice: DeletionChoice,
	): Promise<DeletionPlan[]> {
		const scope = scopeOf(snapshot);
		const outcome: DeletionOutcome = applyDeletion(scope, plan, choice);
		if (choice === "cancel") return [];

		// Unparent first: if a later delete fails, children are already safe.
		for (const edit of outcome.edits) {
			const file = this.io.getFile(edit.path);
			if (!file) continue;
			await this.io.updateFrontmatter(file, (frontmatter) => {
				delete frontmatter[edit.field];
			});
		}

		// Relations aren't hierarchy, so they're tidied silently rather than
		// prompted about (§7.3).
		for (const edit of danglingRelationEdits(scope, outcome.deletePaths)) {
			const file = this.io.getFile(edit.path);
			if (!file) continue;
			await this.io.updateFrontmatter(file, (frontmatter) => {
				frontmatter.relations = {
					blocks: edit.relations.blocks.map((p) => formatLink(p)),
					blockedBy: edit.relations.blockedBy.map((p) => formatLink(p)),
					related: edit.relations.related.map((p) => formatLink(p)),
					duplicateOf: formatLink(edit.relations.duplicateOf),
				};
			});
		}

		for (const path of outcome.deletePaths) {
			const file = this.io.getFile(path);
			if (file) await this.io.trash(file);
		}

		await this.index.rebuild();
		return outcome.followUps;
	}

	// -- Taxonomy (§5.6) ------------------------------------------------------

	/**
	 * Delete a taxonomy value, reassigning everything that used it. The guard
	 * itself lives in core; this just applies the outcome across the vault.
	 */
	async applyTaxonomyDeletionPlan(
		snapshot: WorkspaceSnapshot,
		taxonomy: Taxonomy,
		plan: TaxonomyDeletionPlan,
		replacementId: string | null,
	): Promise<void> {
		const result = applyTaxonomyDeletion(taxonomy, plan, replacementId);
		const kind = taxonomy.schema.kind;
		const to = result.replacementId;

		if (result.removeFromAll) {
			// Multi-select only (labels): just strip the value everywhere.
			for (const task of snapshot.tasks) {
				if (!task.labels.includes(plan.valueId)) continue;
				await this.updateTask(task, {
					labels: task.labels.filter((id) => id !== plan.valueId),
				});
			}
		} else if (to) {
			for (const task of snapshot.tasks) {
				if (kind === "label") {
					const labels = reassignValues(task.labels, plan.valueId, to);
					if (labels !== task.labels) await this.updateTask(task, { labels });
					continue;
				}

				const current = task[kind] as string | null;
				const next = reassignValue(current, plan.valueId, to);
				if (next !== current) {
					await this.updateTask(task, { [kind]: next } as Partial<Task>);
				}
			}

			// Projects share the status taxonomy (§5.1).
			if (kind === "status") {
				for (const entity of snapshot.projects) {
					if (entity.status !== plan.valueId) continue;
					const file = this.io.getFile(entity.path);
					if (!file) continue;
					await this.io.updateFrontmatter(file, (frontmatter) => {
						frontmatter.status = to;
					});
				}
			}
		}

		await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, result.taxonomy));
	}

	// -- Labels (§5.4) — fluid: created and edited outside Settings ----------

	/** First palette colour not already used by a label, cycling if all are. */
	private nextLabelColor(snapshot: WorkspaceSnapshot): string {
		const used = new Set(snapshot.workspace.labels.map((l) => l.color));
		return (
			TAXONOMY_PALETTE.find((c) => !used.has(c)) ??
			TAXONOMY_PALETTE[snapshot.workspace.labels.length % TAXONOMY_PALETTE.length]
		);
	}

	/**
	 * Attach-or-create by name: returns the id of the matching label (any case)
	 * or a freshly created one. The "no two labels alike" rule (§5.4) lives in
	 * `addValue`; this makes typing a dup a no-op rather than an error.
	 */
	async addLabel(snapshot: WorkspaceSnapshot, name: string): Promise<string> {
		const labels = workspaceTaxonomies(snapshot.workspace).label;
		const existing = findValueByName(labels, name);
		if (existing) return existing.id;

		const next = addValue(labels, {
			name: name.trim(),
			color: this.nextLabelColor(snapshot),
		});
		const created = next.values[next.values.length - 1];
		await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
		return created.id;
	}

	async createLabel(
		snapshot: WorkspaceSnapshot,
		name: string,
		color: string,
	): Promise<string> {
		const labels = workspaceTaxonomies(snapshot.workspace).label;
		const next = addValue(labels, { name: name.trim(), color });
		const created = next.values[next.values.length - 1];
		await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
		return created.id;
	}

	async updateLabel(
		snapshot: WorkspaceSnapshot,
		id: string,
		patch: { name?: string; color?: string },
	): Promise<void> {
		const labels = workspaceTaxonomies(snapshot.workspace).label;
		const next = updateValue(labels, id, patch);
		await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
	}

	// -- Config notes ---------------------------------------------------------

	async saveWorkspaceConfig(workspace: WorkspaceConfig): Promise<void> {
		const path = joinPath(workspace.root, WORKSPACE_NOTE);
		const file = this.io.getFile(path);
		if (!file) throw new Error(`Missing workspace note at "${path}"`);
		await this.io.replaceFrontmatter(file, serializeWorkspace(workspace));
		await this.index.rebuild();
	}

	async saveViews(
		snapshot: WorkspaceSnapshot,
		views: SavedView[],
	): Promise<void> {
		const path = joinPath(snapshot.workspace.root, VIEWS_NOTE);
		const file = this.io.getFile(path);
		if (file) {
			await this.io.replaceFrontmatter(file, serializeViews(views));
		} else {
			await this.io.create(path, serializeViews(views));
		}
		await this.index.rebuild();
	}

	/** Read the live view list for a workspace, so concurrent edits don't clobber. */
	private liveViews(snapshot: WorkspaceSnapshot): SavedView[] {
		return (this.index.get(snapshot.workspace.root) ?? snapshot).views;
	}

	/** Append a new Saved View. */
	async addView(snapshot: WorkspaceSnapshot, view: SavedView): Promise<void> {
		await this.saveViews(snapshot, [...this.liveViews(snapshot), view]);
	}

	/** Replace one Saved View by id (used for rename, duplicate-then-edit, etc). */
	async updateView(snapshot: WorkspaceSnapshot, view: SavedView): Promise<void> {
		await this.saveViews(
			snapshot,
			this.liveViews(snapshot).map((v) => (v.id === view.id ? view : v)),
		);
	}

	/** Remove a Saved View. The built-in "Tasks" view is protected by the UI. */
	async deleteView(snapshot: WorkspaceSnapshot, id: string): Promise<void> {
		await this.saveViews(
			snapshot,
			this.liveViews(snapshot).filter((v) => v.id !== id),
		);
	}

	// -- Projects -----------------------------------------------------------

	async createProject(
		snapshot: WorkspaceSnapshot,
		title: string,
		icon?: string,
	): Promise<TFile> {
		const now = new Date().toISOString();
		const path = this.io.availablePath(
			joinPath(snapshot.workspace.root, FOLDERS.projects, sanitize(title)),
		);
		const file = await this.io.create(
			path,
			serializeProject({
				type: "project",
				title,
				icon,
				status: snapshot.workspace.defaultNewTaskStatus,
				archived: false,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
				path,
			}),
			"## Overview\n",
		);
		await this.index.rebuild();
		return file;
	}

	/**
	 * Patch a project's frontmatter (rename, icon). The note's *filename* is
	 * never touched — the vault schema makes the frontmatter `title` the display
	 * override, so a rename here can't cascade through wikilinks.
	 */
	async updateProject(project: Project, patch: Partial<Project>): Promise<void> {
		const file = this.requireFile(project.path);
		const merged: Project = {
			...project,
			...patch,
			updatedAt: new Date().toISOString(),
		};
		await this.io.replaceFrontmatter(file, serializeProject(merged));
		await this.index.rebuild();
	}

	// -- Workspaces (§13) -----------------------------------------------------

	async createWorkspace(
		name: string,
		root: string,
		idPrefix?: string,
		icon?: string,
	): Promise<WorkspaceConfig> {
		const prefix = (
			idPrefix?.trim() || suggestPrefix(name, this.index.takenPrefixes())
		).toUpperCase();
		const workspace = createWorkspaceConfig(name, prefix, root, icon);

		await this.io.ensureFolder(root);
		for (const folder of Object.values(FOLDERS)) {
			await this.io.ensureFolder(joinPath(root, folder));
		}

		await this.io.create(joinPath(root, WORKSPACE_NOTE), serializeWorkspace(workspace));
		await this.io.create(joinPath(root, VIEWS_NOTE), serializeViews(defaultViews()));

		await this.index.rebuild();
		return workspace;
	}

	/** The "Try a Sample Workspace" onboarding path (§13). */
	async createSampleWorkspace(root: string): Promise<void> {
		const generated = generateSampleWorkspace({
			root,
			idPrefix: suggestPrefix("Sample Workspace", this.index.takenPrefixes()),
		});

		await this.io.ensureFolder(root);
		for (const folder of Object.values(FOLDERS)) {
			await this.io.ensureFolder(joinPath(root, folder));
		}

		for (const note of generated.notes) {
			await this.io.create(note.path, note.frontmatter, note.body);
		}

		await this.index.rebuild();
		new Notice(`Created sample workspace at "${root}"`);
	}

	// -- Helpers --------------------------------------------------------------

	private requireFile(path: string): TFile {
		const file = this.io.getFile(path);
		if (!file) throw new Error(`Note not found: "${path}"`);
		return file;
	}

	async open(path: string, newLeaf = false): Promise<void> {
		const file = this.io.getFile(path);
		if (!file) return;
		await this.app.workspace.getLeaf(newLeaf).openFile(file);
	}
}

/** Strip characters Obsidian won't accept in a filename. */
function sanitize(title: string): string {
	return title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
}
