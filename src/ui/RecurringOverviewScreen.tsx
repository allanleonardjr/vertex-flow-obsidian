/**
 * Recurring Overview — a full sidebar-navigable tab showing every live
 * recurrence in the workspace.
 *
 * Renders the same rows the modal (`RecurringOverviewModal`) displays, with the
 * same click-to-jump and stop-behavior, but as a proper browse hub — a
 * `BrowseHeader` + `BrowseList` page that fills the pane like Trash, Labels,
 * and History — not a boxed dialog card.
 */

import { useEffect, useState } from "react";
import { localTodayIso } from "../core/date";
import { describeRecurrence, recurringOverview } from "../core/recurrence";
import type { Task, WorkspaceSnapshot } from "../core/types";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { StatusDot } from "./components/TaskBits";
import { displayTitle } from "./components/TaskTitle";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { BrowseEmpty, BrowseHeader, BrowseList } from "./browse/shared";

/** Row data produced by `recurringOverview`, mirroring `RecurringOverviewRow`. */
interface RecurringScreenRow {
	task: Task;
	chainLength: number;
	nextDate: string | null;
	recurrenceEndsAfter: number | null;
	description: string;
}

/** Render a single row with title, metadata, and action buttons. */
function RecurringRow({
	task,
	chainLength,
	nextDate,
	taxonomies,
	onOpen,
	onStop,
}: RecurringScreenRow & {
	taxonomies: WorkspaceTaxonomies;
	onOpen: (task: Task) => void;
	onStop: (task: Task) => void;
}) {
	return (
		<li className="vf-recurring-item">
			<div className="vf-recurring-main">
				<span className="vf-recurring-title">
					<StatusDot taxonomies={taxonomies} status={task.status} />
					{displayTitle(task)}
				</span>
				<span className="vf-dialog-hint">
					{chainLength} occurrence
					{chainLength > 1 && ` of ${chainLength}`}
					{nextDate ? ` · next ${nextDate}` : ""}
				</span>
			</div>
			<div className="vf-recurring-actions">
				<button
					type="button"
					className="vf-linkish"
					onClick={() => onOpen(task)}
				>
					Open
				</button>
				<button
					type="button"
					className="vf-linkish vf-linkish-warn"
					onClick={() => onStop(task)}
				>
					Stop
				</button>
			</div>
		</li>
	);
}

/** The screen component — rendered when the active tab kind is "recurring". */
export function RecurringOverviewScreen({
	snapshot,
	taxonomies,
	tabs,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	tabs: ReturnType<typeof useTabs>;
}) {
	const plugin = usePlugin();
	const [rows, setRows] = useState<RecurringScreenRow[]>([]);
	const [stopTask, setStopTask] = useState<Task | null>(null);

	// Rebuild the list whenever the snapshot changes — a stopped series drops
	// out on the next rebuild.
	useEffect(() => {
		setRows(
			recurringOverview(snapshot, localTodayIso()).map((row) => ({
				task: row.task,
				chainLength: row.chainLength,
				nextDate: row.nextDate ?? null,
				recurrenceEndsAfter: row.recurrence.endsAfter,
				description: describeRecurrence(
					row.recurrence,
					snapshot.workspace.statuses,
				),
			})),
		);
	}, [snapshot, taxonomies]);

	const openTask = (task: Task) => {
		tabs.openTask(task.path);
	};

	const handleStop = (task: Task) => {
		setStopTask(task);
	};

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Recurring"
				noun="recurring task"
				plural="recurring tasks"
				count={rows.length}
			/>

			{rows.length === 0 ? (
				<BrowseEmpty label="recurring tasks" />
			) : (
				<BrowseList>
					<ul className="vf-recurring-list">
						{rows.map((row) => (
							<RecurringRow
								key={row.task.path}
								{...row}
								taxonomies={taxonomies}
								onOpen={openTask}
								onStop={handleStop}
							/>
						))}
					</ul>
				</BrowseList>
			)}

			{stopTask && (
				<ConfirmDeleteDialog
					title={`Stop “${displayTitle(stopTask)}” repeating?`}
					body="Occurrences already spawned stay; no new ones are created."
					confirmLabel="Stop repeating"
					destructive={false}
					onCancel={() => setStopTask(null)}
					onConfirm={() => {
						void plugin.mutations.stopRecurrence(stopTask);
						setStopTask(null);
					}}
				/>
			)}
		</div>
	);
}
