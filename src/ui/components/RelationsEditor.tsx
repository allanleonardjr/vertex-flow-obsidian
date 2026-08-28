import { relationProgress, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import { OptionSelect } from "./fields";
import { ProgressBar } from "./TaskBits";
import { EmbeddedTaskList } from "./EmbeddedTaskList";

const RELATION_KINDS = [
  { key: "blockedBy", label: "Blocked by" },
  { key: "blocks", label: "Blocks" },
  { key: "related", label: "Related" },
] as const;

export interface RelationsEditorProps {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onChange: (patch: Partial<Task>) => void;
  onOpenTask: (path: string) => void;
}

export function RelationsEditor({
  task,
  snapshot,
  taxonomies,
  onChange,
  onOpenTask,
}: RelationsEditorProps) {
  const scope = scopeOf(snapshot);

  const others = snapshot.tasks.filter(
    (candidate) => candidate.path !== task.path,
  );

  const partition = (paths: string[]) => {
    const found: Task[] = [];
    const missing: string[] = [];
    for (const path of paths) {
      const related = snapshot.tasks.find(
        (candidate) => candidate.path === path,
      );
      if (related) found.push(related);
      else missing.push(path);
    }
    return { found, missing };
  };

  return (
    <div className="vf-relation-groups">
      {RELATION_KINDS.map(({ key, label }) => {
        const current = task.relations?.[key] || [];
        const progress = relationProgress(scope, task, key, taxonomies.status);
        const { found, missing } = partition(current);

        return (
          <div key={key} className="vf-relation-group">
            <div className="vf-relation-group-header">
              <span className="vf-relation-group-label">
                {label}{" "}
                {current.length > 0 && <ProgressBar progress={progress} />}
              </span>
            </div>

            <EmbeddedTaskList
              tasks={found}
              missingPaths={missing}
              snapshot={snapshot}
              taxonomies={taxonomies}
              onOpenTask={onOpenTask}
              onRemove={(pathToRemove) =>
                onChange({
                  relations: {
                    ...task.relations,
                    [key]: current.filter((entry) => entry !== pathToRemove),
                  },
                })
              }
              renderAddTrigger={() => (
                <OptionSelect
                  noneLabel={`+ Add ${label.toLowerCase()} relation…`}
                  value={null}
                  options={others
                    .filter((candidate) => !current.includes(candidate.path))
                    .map((candidate) => ({
                      value: candidate.path,
                      label: `${candidate.id} ${candidate.title}`,
                    }))}
                  onChange={(path) => {
                    if (!path) return;
                    onChange({
                      relations: {
                        ...task.relations,
                        [key]: [...current, path],
                      },
                    });
                  }}
                />
              )}
            />
          </div>
        );
      })}

      <div className="vf-relation-group">
        <div className="vf-relation-group-header">
          <span className="vf-relation-group-label">Duplicate of</span>
        </div>

        {(() => {
          const duplicatePath = task.relations?.duplicateOf;
          const { found, missing } = partition(
            duplicatePath ? [duplicatePath] : [],
          );

          return (
            <EmbeddedTaskList
              tasks={found}
              missingPaths={missing}
              snapshot={snapshot}
              taxonomies={taxonomies}
              onOpenTask={onOpenTask}
              onRemove={() =>
                onChange({
                  relations: { ...task.relations, duplicateOf: null },
                })
              }
              renderAddTrigger={() =>
                !duplicatePath ? (
                  <OptionSelect
                    noneLabel="+ Add duplicate of…"
                    value={null}
                    options={others.map((candidate) => ({
                      value: candidate.path,
                      label: `${candidate.id} ${candidate.title}`,
                    }))}
                    onChange={(duplicateOf) =>
                      onChange({
                        relations: { ...task.relations, duplicateOf },
                      })
                    }
                  />
                ) : null
              }
            />
          );
        })()}
      </div>
    </div>
  );
}
