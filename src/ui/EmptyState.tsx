/**
 * Onboarding (§13).
 *
 * Two explicit paths, not a forced wizard. Someone who knows what they want
 * shouldn't have to click through a tour, and someone who doesn't shouldn't
 * have to invent a workspace structure before seeing what this thing is.
 */

import { useState } from "react";
import { WorkspaceDialog, type WorkspaceDialogMode } from "./modals/WorkspaceDialog";

export function EmptyState() {
	const [dialog, setDialog] = useState<WorkspaceDialogMode | null>(null);

	return (
		<div className="vf-empty">
			<div className="vf-empty-card">
				<h1>Vertex Flow</h1>
				<p className="vf-empty-lead">
					Task management that lives in your vault as plain Markdown. Start
					from scratch, or look around a populated example first.
				</p>

				<div className="vf-empty-actions">
					<button className="mod-cta" onClick={() => setDialog("create")}>
						Create a workspace
					</button>
					<button onClick={() => setDialog("sample")}>
						Try a sample workspace
					</button>
				</div>

				<p className="vf-empty-note">
					Everything is a note: hierarchy lives in frontmatter links, so
					nothing here is locked inside a plugin database.
				</p>
			</div>

			{dialog && (
				<WorkspaceDialog mode={dialog} onClose={() => setDialog(null)} />
			)}
		</div>
	);
}
