import { Trash2 } from "lucide-react";
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
  removeTitle?: (title: string) => string;
  /** Optional callback to render the bottom "+ Add..." trigger or selector */
  renderAddTrigger?: () => React.ReactNode;
}

/**
 * Shared wrapper for embedded task lists (Sub-tasks and Relations).
 * Unifies TaskList configuration, missing row handling, and linear action buttons across views.
 */
export function EmbeddedTaskList({
  tasks,
  missingPaths = [],
  snapshot,
  taxonomies,
  onOpenTask,
  onRemove,
  removeTitle = (title) => `Remove ${title}`,
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
              className="vf-icon-button vf-row-remove"
              title={removeTitle(item.title)}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.path);
              }}
            >
              <Trash2 size={13} />
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
