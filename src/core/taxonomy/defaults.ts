/**
 * Default taxonomy configurations for a new Workspace (§5.1–5.4).
 *
 * Every default here is overridable per Workspace — that is the whole point of
 * the taxonomy engine. These values simply mean a brand-new workspace is
 * immediately usable without visiting settings.
 */

import type {
	LabelValue,
	PriorityValue,
	StatusValue,
	TaskTypeValue,
} from "../types";

/**
 * Default statuses map 1:1 to the fixed category enum, matching Linear's own
 * default workflow. Users may rename, recolor, reorder, add and remove these
 * freely — the categories underneath never change.
 */
export const DEFAULT_STATUSES: StatusValue[] = [
	{ id: "queue", name: "Queue", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "todo", name: "Todo", color: "#60a5fa", category: "unstarted", order: 2 },
	{
		id: "in-progress",
		name: "In Progress",
		color: "#fbbf24",
		category: "started",
		order: 3,
	},
	{ id: "done", name: "Done", color: "#34d399", category: "completed", order: 4 },
	{
		id: "canceled",
		name: "Canceled",
		color: "#f87171",
		category: "canceled",
		order: 5,
	},
];

/** Fully flexible and ordered — order carries meaning, count does not (§5.2). */
export const DEFAULT_PRIORITIES: PriorityValue[] = [
	{ id: "urgent", name: "Urgent", color: "#ef4444", order: 1 },
	{ id: "high", name: "High", color: "#f97316", order: 2 },
	{ id: "medium", name: "Medium", color: "#eab308", order: 3 },
	{ id: "low", name: "Low", color: "#3b82f6", order: 4 },
	{ id: "none", name: "No Priority", color: "#94a3b8", order: 5 },
];

export const DEFAULT_TASK_TYPES: TaskTypeValue[] = [
	{ id: "bug", name: "Bug", color: "#ef4444" },
	{ id: "feature", name: "Feature", color: "#3b82f6" },
	{ id: "chore", name: "Chore", color: "#94a3b8" },
];

/** Workspaces start with no labels — labels are inherently project-specific. */
export const DEFAULT_LABELS: LabelValue[] = [];

/**
 * Default status for brand-new tasks. Configurable independently of category
 * (§5.1) — this is a status *id*, not "the first backlog status".
 */
export const DEFAULT_NEW_TASK_STATUS = "queue";

/** Palette offered when creating a taxonomy value in settings. */
export const TAXONOMY_PALETTE: readonly string[] = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#eab308",
	"#84cc16",
	"#22c55e",
	"#34d399",
	"#14b8a6",
	"#06b6d4",
	"#60a5fa",
	"#3b82f6",
	"#6366f1",
	"#8b5cf6",
	"#a855f7",
	"#ec4899",
	"#94a3b8",
] as const;
