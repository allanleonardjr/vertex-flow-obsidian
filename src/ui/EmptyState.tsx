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
// import { HelpView } from "./help/HelpView";
import { RoughNotation } from "react-rough-notation";
import { TemplateGallery } from "./TemplateGallery";

export function EmptyState() {
  const [showGallery, setShowGallery] = useState(false);

  return (
    <div className="vf-empty-scroll">
      <div className="vf-app-background">
        {showGallery ? (
          <TemplateGallery onClose={() => setShowGallery(false)} />
        ) : (
          <Welcome onClose={() => setShowGallery(true)} />
          //<HelpView />
        )}
      </div>
    </div>
  );
}

function Welcome({ onClose }: { onClose: () => void }) {
  const iconSize = 70;
  const padding = iconSize / 10; //7; // space between the icon and the edge of its box

  return (
    <div className="vf-welcome">
      <div
        className="vf-welcome-icon"
        style={{
          width: iconSize + padding * 2,
          height: iconSize + padding * 2,
          borderRadius: (iconSize + padding * 2) * 0.23,
        }}
      >
        <Icon id="kanban-square" fallback="layers" size={iconSize} />
      </div>
      <h1>Welcome to Vertex Flow</h1>
      <p className="vf-welcome-sub">
        Task management for your Obsidian vault. <br />
        Projects and Tasks, List and Board views, all stored as{" "}
        <RoughNotation
          type="underline"
          multiline={true}
          color="#ff0000"
          animationDelay={300}
          show={true}
        >
          <span style={{ fontWeight: "bold" }}>plain Markdown notes.</span>
        </RoughNotation>
      </p>
      <button
        type="button"
        className="vf-welcome-cta mod-cta"
        onClick={onClose}
      >
        Create your first workspace
      </button>
    </div>
  );
}
