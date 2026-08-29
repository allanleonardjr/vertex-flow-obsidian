/**
 * Shared entity builders for the unit suite.
 *
 * `timeline.test.ts` and `calendar.test.ts` both need a `Task` (and the
 * timeline suite a `Project`) with every field defaulted so a test can set just
 * the one or two it cares about. Kept here rather than copied into each file so
 * the two views' tests can't drift on what a "default task" looks like.
 */

import { emptyRelations, type Project, type Task } from "../../src/core/types";

export function task(partial: Partial<Task>): Task {
	return {
		type: "task",
		id: "TSK-1",
		title: "T",
		taskType: null,
		status: "todo",
		priority: null,
		rank: "0|hzzzzz:",
		project: null,
		parent: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		path: "W/Tasks/TSK-1",
		mentions: [],
		...partial,
	};
}

export function project(partial: Partial<Project>): Project {
	return {
		type: "project",
		title: "P",
		status: "in-progress",
		priority: null,
		labels: [],
		startDate: null,
		dueDate: null,
		owner: null,
		archived: false,
		archivedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		path: "W/Projects/P",
		...partial,
	};
}
