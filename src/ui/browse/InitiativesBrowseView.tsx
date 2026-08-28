/**
 * Initiatives browse screen — the top of the hierarchy (§2).
 */
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { WorkspaceListItem } from "../../ui/components/WorkspaceListItem"; // Your new flexbox wrapper

export function InitiativesBrowseView({
  snapshot,
  taxonomies,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  // Access the initiatives correctly from the snapshot data model
  const initiatives = Object.values(snapshot.initiatives || {});

  return (
    <div className="vf-browse-container">
      {/* View Header */}
      <div className="vf-browse-header">
        <div className="vf-browse-title-group">
          <h2>Initiatives</h2>
          <span className="vf-browse-count">
            {initiatives.length} initiative{initiatives.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button className="mod-cta">New initiative</button>
      </div>

      {/* Initiatives List Container */}
      <div className="vf-list-container">
        {initiatives.map((initiative) => {
          // Map against actual properties on your Initiative interface
          const status =
            taxonomies.statuses?.[initiative.statusId]?.name || "In Progress";
          const projectCount = initiative.projectIds?.length || 0;

          return (
            <div key={initiative.uuid || initiative.id} className="vf-card-row">
              <div className="vf-card-top">
                <div className="vf-card-title-area">
                  <span className="vf-status-badge">{status}</span>
                  <span className="vf-card-title">{initiative.title}</span>
                </div>
                <div className="vf-card-meta">
                  <span>{projectCount} projects</span>
                  <span>
                    Created{" "}
                    {new Date(initiative.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {initiatives.length === 0 && (
          <div className="vf-empty-state">No initiatives found.</div>
        )}
      </div>
    </div>
  );
}
