/**
 * The task editor's label control (§5.4).
 *
 * Labels are fluid: you don't pre-define them in Settings. The current labels
 * stack vertically, each removable with `×`; the text box below creates a new
 * label (or attaches an existing one, case-insensitively) on Enter, and offers
 * matching existing labels as you type.
 */

import { useMemo, useState } from "react";
import { listValues } from "../../core/taxonomy";
import type { Taxonomy } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function LabelEditor({
	snapshot,
	taxonomy,
	value,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomy: Taxonomy;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const plugin = usePlugin();
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);

	const byId = useMemo(
		() => new Map(taxonomy.values.map((v) => [v.id, v])),
		[taxonomy.values],
	);

	const suggestions = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return [];
		return listValues(taxonomy)
			.filter(
				(v) =>
					!value.includes(v.id) && v.name.toLowerCase().includes(needle),
			)
			.slice(0, 6);
	}, [taxonomy, value, query]);

	const exactMatch = suggestions.some(
		(v) => v.name.trim().toLowerCase() === query.trim().toLowerCase(),
	);

	const attach = (id: string) => {
		if (!value.includes(id)) onChange([...value, id]);
		setQuery("");
	};

	const commit = async () => {
		const name = query.trim();
		if (!name || busy) return;
		setBusy(true);
		try {
			const id = await plugin.mutations.addLabel(snapshot, name);
			if (!value.includes(id)) onChange([...value, id]);
			setQuery("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="vf-label-editor">
			{value.length > 0 && (
				<div className="vf-label-editor-list">
					{value.map((id) => {
						const label = byId.get(id);
						return (
							<span key={id} className="vf-label-editor-row">
								<span
									className="vf-label-dot"
									style={{ backgroundColor: label?.color ?? "var(--vf-muted)" }}
								/>
								<span className="vf-label-editor-name">
									{label?.name ?? id}
								</span>
								<button
									type="button"
									className="vf-icon-button"
									title={`Remove ${label?.name ?? id}`}
									onClick={() => onChange(value.filter((v) => v !== id))}
								>
									✕
								</button>
							</span>
						);
					})}
				</div>
			)}

			<div className="vf-label-editor-input">
				<input
					type="text"
					className="vf-input"
					placeholder="Add a label…"
					value={query}
					disabled={busy}
					onChange={(event) => setQuery(event.target.value)}
					onBlur={() => window.setTimeout(() => setQuery(""), 120)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void commit();
						}
					}}
				/>

				{query.trim() && (
					<div
						className="vf-label-editor-menu"
						onMouseDown={(event) => event.preventDefault()}
					>
						{suggestions.map((v) => (
							<button
								key={v.id}
								type="button"
								className="vf-menu-item"
								onClick={() => attach(v.id)}
							>
								<span
									className="vf-label-dot"
									style={{ backgroundColor: v.color }}
								/>
								{v.name}
							</button>
						))}
						{!exactMatch && (
							<button
								type="button"
								className="vf-menu-item vf-label-editor-create"
								onClick={() => void commit()}
							>
								Create “{query.trim()}”
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
