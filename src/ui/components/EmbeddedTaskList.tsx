import { Unlink } from "lucide-react";
import { basename } from "../../core/links";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import { TaskList } from "./TaskList";
import { MissingTaskRow } from "./TaskRow";

export interface EmbeddedTaskListProps {
  tasks: Task[];
  missingPaths?: string[];
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onOpenTask: (path: string) => void;
  onRemove: (path: string) => void;
  /**
   * Tooltip for the unlink button. Should name the link being broken and make
   * clear the task itself survives — nothing in these lists deletes a note.
   */
  removeTitle?: (title: string) => string;
  /** Optional callback to render the bottom "+ Add..." trigger or selector */
  renderAddTrigger?: () => React.ReactNode;
}

/**
 * Shared wrapper for embedded task lists (Sub-tasks and Relations).
 * Unifies TaskList configuration, missing row handling, and linear action buttons across views.
 *
 * The trailing row action is deliberately an *unlink*, never a delete: it
 * clears a `parent` field or drops a path from `relations`, and the task it
 * points at is untouched. Hence the broken-chain icon and the neutral hover —
 * `Trash2` and the red `.vf-row-remove` treatment are reserved for the List
 * view's real deletion, which routes through `planDeletion` and confirms first.
 */
export function EmbeddedTaskList({
  tasks,
  missingPaths = [],
  snapshot,
  taxonomies,
  onOpenTask,
  onRemove,
  removeTitle = (title) => `Unlink “${title}” — the task is kept`,
  renderAddTrigger,
}: EmbeddedTaskListProps) {
  const isEmpty = tasks.length === 0 && missingPaths.length === 0;

  if (isEmpty && !renderAddTrigger) return null;

  return (
    <div className="vf-list-embedded-container">
      {!isEmpty && (
        <TaskList
          className="vf-list-embedded"
          groups={[{ key: "embedded-items", tasks }]}
          snapshot={snapshot}
          taxonomies={taxonomies}
          onOpenTask={onOpenTask}
          rowAction={(item) => (
            <button
              type="button"
              className="vf-icon-button vf-row-unlink"
              title={removeTitle(item.title)}
              aria-label={removeTitle(item.title)}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.path);
              }}
            >
              <Unlink size={13} />
            </button>
          )}
        >
          {missingPaths.map((path) => (
            <MissingTaskRow
              key={path}
              label={basename(path)}
              onRemove={() => onRemove(path)}
              removeTitle={removeTitle(basename(path))}
            />
          ))}
        </TaskList>
      )}

      {renderAddTrigger && (
        <div className="vf-embedded-list-footer">{renderAddTrigger()}</div>
      )}
    </div>
  );
}
