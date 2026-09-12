/**
 * The body of a Workspace card — icon, name, ID prefix, an `Active` chip for
 * the current workspace, a one-line task/project count, and the workspace's
 * folder path on its own muted line below.
 */

import type { WorkspaceSnapshot } from "../../core/types";
import { Icon } from "../components/Icon";
import { BrowseMeta, pluralize } from "./shared";

export function WorkspaceCardContent({
  snapshot,
  active,
}: {
  snapshot: WorkspaceSnapshot;
  /** Whether this is the pane's currently active workspace — drives the chip. */
  active?: boolean;
}) {
  const { workspace } = snapshot;
  return (
    <div className="vf-workspace-card" aria-label={`Path: ${workspace.root}`}>
      <div className="vf-workspace-card-row">
        <div className="vf-browse-card-top">
          <span className="vf-browse-card-icon" aria-hidden>
            <Icon id={workspace.icon} fallback="layers" size={15} />
          </span>
          <span className="vf-browse-title">{workspace.name}</span>
          <span className="vf-view-title-code">({workspace.idPrefix})</span>
          {active && <span className="vf-active-badge">Active</span>}
        </div>
        <BrowseMeta>
          <span>{pluralize(snapshot.tasks.length, "task")}</span>
          <span>{pluralize(snapshot.projects.length, "project")}</span>
        </BrowseMeta>
      </div>
    </div>
  );
}
