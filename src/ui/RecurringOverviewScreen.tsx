/**
 * Recurring Overview — a full sidebar-navigable tab showing every live
 * recurrence in the workspace.
 *
 * Renders the same rows the former modal displayed, with the same
 * click-to-jump and stop-behavior, but as a proper tab that appears in
 * the tab strip alongside History, Trash, Help, and Settings.
 */

import { useEffect, useState } from "react";
import { localTodayIso } from "../core/date";
import { describeRecurrence, recurringOverview } from "../core/recurrence";
import type { WorkspaceSnapshot } from "../core/types";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { StatusDot } from "./components/TaskBits";
import { displayTitle } from "./components/TaskTitle";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";

/** Row data produced by `recurringOverview`, for the screen. */
interface RecurringScreenRow {
	taskId: string;
	title: string;
	chainLength: number;
	nextDate: string | null;
	recurrenceEndsAfter: number | null;
	description: string;
	status: string | null;
}

/** Render a single row with title, metadata, and action buttons. */
function RecurringRow({
	taskId,
	title,
	chainLength,
	nextDate,
	recurrenceEndsAfter,
	status,
	taxonomies,
	onOpen,
	onStop,
}: RecurringScreenRow & {
	taxonomies: WorkspaceTaxonomies;
	onOpen: (id: string) => void;
	onStop: (id: string) => void;
}) {
	return (
		<li className="vf-recurring-item">
			<div className="vf-recurring-main">
				<span className="vf-recurring-title">
					<StatusDot taxonomies={taxonomies} status={status} />
					{title}
				</span>
				<span className="vf-dialog-hint">
					{chainLength} occurrence
					{chainLength > 1 && ` of ${chainLength}`}
					{nextDate ? ` · next ${nextDate}` : ""}
				</span>
			</div>
			<div className="vf-recurring-actions">
				<button className="vf-linkish" onClick={() => onOpen(taskId)}>
					Open
				</button>
				<button
					className="vf-linkish vf-linkish-warn"
					onClick={() => onStop(taskId)}
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
	const [rows, setRows] = useState<RecurringScreenRow[]>([]);
	const [stopTaskPath, setStopTaskPath] = useState<string | null>(null);

	// Pull the data once on mount.
	useEffect(() => {
		setRows(
			recurringOverview(snapshot, localTodayIso()).map((row) => ({
				taskId: row.task.id,
				title: displayTitle(row.task),
				chainLength: row.chainLength,
				nextDate: row.nextDate ?? null,
				recurrenceEndsAfter: row.recurrence.endsAfter,
				description: describeRecurrence(row.recurrence, snapshot.workspace.statuses),
				status: row.task.status,
			})),
		);
	}, [snapshot, localTodayIso(), taxonomies]);

	// Open a task from a row click.
	const openTask = (id: string) => {
		tabs.openTask(id);
	};

	// Handle stop-confirmation state.
	const handleStop = (id: string) => {
		setStopTaskPath(id);
	};

	return (
		<div className="vf-dialog vf-recurring-overview" role="dialog" aria-modal="true">
			<h3>Recurring tasks</h3>

			{rows.length === 0 ? (
				<p className="vf-dialog-lead">
					Nothing in this workspace repeats yet. Open a task and set its
					Repeat field to start a series.
				</p>
			) : (
				<ul className="vf-recurring-list">
					{rows.map((row) => (
						<RecurringRow
							{...row}
							taxonomies={taxonomies}
							onOpen={openTask}
							onStop={handleStop}
						/>
					))}
				</ul>
			)}

			<div className="vf-dialog-actions">
				<span className="vf-editor-spacer" />
				<button type="button" className="mod-cta" onClick={() => window.close()}>
					Done
				</button>
			</div>

			{stopTaskPath && (
				<ConfirmDeleteDialog
					title={`Stop repeating “${rows.find((r) => r.taskId === stopTaskPath)?.title || ""}” repeating?`}
					body="Occurrences already spawned stay; no new ones are created."
					confirmLabel="Stop repeating"
					destructive={false}
					onCancel={() => setStopTaskPath(null)}
					onConfirm={() => {
						window.close();
					}}
				/>
			)}
		</div>
	);
}