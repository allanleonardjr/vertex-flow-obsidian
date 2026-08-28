/**
 * The taxonomy settings section — one component for all four taxonomies
 * (Golden Rule: one generic engine, configured four ways, and that includes
 * whatever edits it). `kind` picks the configuration; everything else —
 * add, rename, recolor, reorder, and the uniform §5.6 deletion guard — is the
 * same code path regardless of which of the four you're looking at.
 */

import { useState } from "react";
import { Notice } from "obsidian";
import {
	addValue,
	applyTaxonomyDeletion,
	findTaxonomyUsage,
	listValues,
	planTaxonomyDeletion,
	reorderValues,
	updateValue,
	type Taxonomy,
	type TaxonomyDeletionPlan,
	type TaxonomyUsage,
	TAXONOMY_PALETTE,
} from "../../core/taxonomy";
import {
	STATUS_CATEGORIES,
	type StatusCategory,
	type TaxonomyKind,
	type TaxonomyValue,
	type WorkspaceSnapshot,
} from "../../core/types";
import { withTaxonomy } from "../../core/taxonomy";
import { usePlugin } from "../context";
import { ReplaceValueDialog } from "./ReplaceValueDialog";

const CATEGORY_LABEL: Record<StatusCategory, string> = {
	backlog: "Backlog",
	unstarted: "Unstarted",
	started: "Started",
	completed: "Completed",
	canceled: "Canceled",
};

export function TaxonomySection({
	title,
	description,
	kind,
	taxonomy,
	snapshot,
}: {
	title: string;
	description: string;
	kind: TaxonomyKind;
	taxonomy: Taxonomy;
	snapshot: WorkspaceSnapshot;
}) {
	const plugin = usePlugin();
	const [dialog, setDialog] = useState<{
		plan: TaxonomyDeletionPlan;
		usage: TaxonomyUsage;
	} | null>(null);

	const commit = (next: Taxonomy) => {
		void plugin.mutations.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
	};

	const usageScope = {
		tasks: snapshot.tasks,
		projects: snapshot.projects,
	};

	const requestDelete = (valueId: string) => {
		// A UI-level guard on top of the engine: the engine's usage-based check
		// would happily delete the last status if no task currently used it,
		// but status is the one taxonomy that's never optional (§5.1) — a
		// workspace with zero statuses can't render a board or accept a new
		// task. The other three taxonomies have no such floor.
		if (kind === "status" && taxonomy.values.length <= 1) {
			new Notice("A workspace needs at least one status.");
			return;
		}

		const usage = findTaxonomyUsage(kind, valueId, usageScope);
		const plan = planTaxonomyDeletion(taxonomy, valueId, usage.count);

		if (!plan.blocked) {
			// Zero usage never needs a replacement — this also handles renumbering
			// `order` on an ordered taxonomy, so ranks stay contiguous.
			const { taxonomy: next } = applyTaxonomyDeletion(taxonomy, plan, null);
			commit(next);
			return;
		}

		if (plan.lastValueInUse) {
			new Notice(
				`Can't delete "${plan.valueName}" — it's the only ${plan.label} left, and ${usage.count} item(s) still use it.`,
			);
			return;
		}

		setDialog({ plan, usage });
	};

	return (
		<section className="vf-settings-section">
			<h3>{title}</h3>
			<p className="vf-settings-description">{description}</p>

			<div className="vf-taxonomy-table">
				{listValues(taxonomy).map((value, index, ordered) => (
					<TaxonomyRow
						key={value.id}
						value={value}
						index={index}
						count={ordered.length}
						ordered={taxonomy.schema.ordered}
						categorized={taxonomy.schema.categorized}
						onRename={(name) => commit(updateValue(taxonomy, value.id, { name }))}
						onRecolor={(color) => commit(updateValue(taxonomy, value.id, { color }))}
						onRecategorize={(category) =>
							commit(updateValue(taxonomy, value.id, { category }))
						}
						onMove={(delta) => {
							const ids = ordered.map((v) => v.id);
							const at = ids.indexOf(value.id);
							const target = at + delta;
							if (target < 0 || target >= ids.length) return;
							[ids[at], ids[target]] = [ids[target], ids[at]];
							commit(reorderValues(taxonomy, ids));
						}}
						onDelete={() => requestDelete(value.id)}
					/>
				))}
			</div>

			<AddValueRow
				categorized={taxonomy.schema.categorized}
				onAdd={(name, color, category) =>
					commit(addValue(taxonomy, { name, color, category }))
				}
			/>

			{dialog && (
				<ReplaceValueDialog
					plan={dialog.plan}
					usage={dialog.usage}
					onCancel={() => setDialog(null)}
					onConfirm={(replacementId) => {
						void plugin.mutations.applyTaxonomyDeletionPlan(
							snapshot,
							taxonomy,
							dialog.plan,
							replacementId,
						);
						setDialog(null);
					}}
				/>
			)}
		</section>
	);
}

function TaxonomyRow({
	value,
	index,
	count,
	ordered,
	categorized,
	onRename,
	onRecolor,
	onRecategorize,
	onMove,
	onDelete,
}: {
	value: TaxonomyValue;
	index: number;
	count: number;
	ordered: boolean;
	categorized: boolean;
	onRename: (name: string) => void;
	onRecolor: (color: string) => void;
	onRecategorize: (category: StatusCategory) => void;
	onMove: (delta: number) => void;
	onDelete: () => void;
}) {
	const [name, setName] = useState(value.name);

	return (
		<div className="vf-taxonomy-row">
			<input
				type="color"
				className="vf-color-swatch"
				value={value.color}
				title="Colour"
				onChange={(event) => onRecolor(event.target.value)}
			/>

			<input
				type="text"
				className="vf-input vf-taxonomy-name"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onBlur={() => {
					const trimmed = name.trim();
					if (trimmed && trimmed !== value.name) onRename(trimmed);
					else setName(value.name);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>

			{categorized && (
				<select
					className="vf-select vf-taxonomy-category"
					value={value.category}
					onChange={(event) => onRecategorize(event.target.value as StatusCategory)}
				>
					{STATUS_CATEGORIES.map((category) => (
						<option key={category} value={category}>
							{CATEGORY_LABEL[category]}
						</option>
					))}
				</select>
			)}

			{ordered && (
				<div className="vf-reorder">
					<button
						className="vf-icon-button"
						disabled={index === 0}
						title="Move up"
						onClick={() => onMove(-1)}
					>
						↑
					</button>
					<button
						className="vf-icon-button"
						disabled={index === count - 1}
						title="Move down"
						onClick={() => onMove(1)}
					>
						↓
					</button>
				</div>
			)}

			<button className="vf-icon-button vf-taxonomy-delete" title="Delete" onClick={onDelete}>
				✕
			</button>
		</div>
	);
}

function AddValueRow({
	categorized,
	onAdd,
}: {
	categorized: boolean;
	onAdd: (name: string, color: string, category?: StatusCategory) => void;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState(
		() => TAXONOMY_PALETTE[Math.floor(Math.random() * TAXONOMY_PALETTE.length)],
	);
	const [category, setCategory] = useState<StatusCategory>("backlog");

	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onAdd(trimmed, color, categorized ? category : undefined);
		setName("");
		setColor(TAXONOMY_PALETTE[Math.floor(Math.random() * TAXONOMY_PALETTE.length)]);
	};

	return (
		<div className="vf-taxonomy-row vf-taxonomy-add">
			<input
				type="color"
				className="vf-color-swatch"
				value={color}
				title="Colour"
				onChange={(event) => setColor(event.target.value)}
			/>
			<input
				type="text"
				className="vf-input vf-taxonomy-name"
				placeholder="New value name"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") submit();
				}}
			/>
			{categorized && (
				<select
					className="vf-select vf-taxonomy-category"
					value={category}
					onChange={(event) => setCategory(event.target.value as StatusCategory)}
				>
					{STATUS_CATEGORIES.map((option) => (
						<option key={option} value={option}>
							{CATEGORY_LABEL[option]}
						</option>
					))}
				</select>
			)}
			<button className="mod-cta" disabled={!name.trim()} onClick={submit}>
				Add
			</button>
		</div>
	);
}
