/**
 * The shared empty state for a view that has nothing to show — a List/Board
 * with no matching tasks, or a Dashboard that no longer exists.
 *
 * Deliberately small: an icon, a one-line title, an optional note (a hint), an
 * optional "New task" button for the cases where creating one is the obvious
 * next move, and an optional extra `action` button (e.g. "Clear filters").
 * Callers decide which of those apply.
 */

import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyView({
  icon,
  iconFallback,
  title,
  note,
  onNewTask,
  action,
}: {
  icon?: string;
  iconFallback: string;
  title: string;
  note?: ReactNode;
  onNewTask?: () => void;
  /** An extra call-to-action, rendered as a button like "New task". */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="vf-app-background vf-view-empty">
      <span className="vf-view-empty-icon" aria-hidden>
        <Icon id={icon} fallback={iconFallback} size={33} />
      </span>
      <p className="vf-view-empty-title">{title}</p>
      {note != null && <p className="vf-empty-note">{note}</p>}
      {onNewTask && (
        <button
          type="button"
          className="vf-empty-cta mod-cta"
          onClick={onNewTask}
        >
          New task
        </button>
      )}
      {action && (
        <button
          type="button"
          className="vf-empty-cta mod-cta"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
