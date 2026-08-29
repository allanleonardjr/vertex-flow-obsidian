/**
 * Onboarding (§13).
 *
 * No workspaces yet → the template gallery, rendered straight into the main
 * content area. There's no "blank" shortcut and no wizard: the plainest
 * template ("Getting Started") is the first card, and picking any card drops
 * you into a short config step before a single file is written.
 */

import { useState } from "react";
import { Icon } from "./components/Icon";
import { TemplateGallery } from "./TemplateGallery";

export function EmptyState() {
  const [showGallery, setShowGallery] = useState(false);

  return (
    <div className="vf-empty-scroll">
      {showGallery ? (
        <TemplateGallery onClose={() => setShowGallery(false)} />
      ) : (
        <Welcome onClose={() => setShowGallery(true)} />
      )}
    </div>
  );
}

function Welcome({ onClose }: { onClose: () => void }) {
  return (
    <div className="vf-welcome">
      <div className="vf-welcome-icon">
        <Icon id="kanban" fallback="layers" size={30} />
      </div>
      <h1>Welcome to Vertex Flow</h1>
      <p className="vf-welcome-sub">
        Task management for your Obsidian vault. <br />
        Projects and Tasks, List and Board views, all stored as plain Markdown
        notes.
      </p>
      <button type="button" className="mod-cta" onClick={onClose}>
        Create your first workspace
      </button>
    </div>
  );
}
