/**
 * Onboarding (§13).
 *
 * No workspaces yet → the template gallery, rendered straight into the main
 * content area. There's no "blank" shortcut and no wizard: the plainest
 * template ("Getting Started") is the first card, and picking any card drops
 * you into a short config step before a single file is written.
 */

import { TemplateGallery } from "./TemplateGallery";

export function EmptyState() {
	return (
		<div className="vf-empty-scroll">
			<TemplateGallery />
		</div>
	);
}
