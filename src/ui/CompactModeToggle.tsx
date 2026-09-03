/**
 * The toggle strip shown in compact (narrow) panes: `[Navigation ..... Properties]`.
 *
 * Rendered above the tab strip inside `.vf-main`. In wide panes it's hidden by
 * CSS; in compact panes it's the only way to open the nav drawer and the
 * task/project properties drawer. The Properties button appears only when the
 * front tab is a Task or Project editor (the two screens that own an
 * `EditorRail`).
 */

import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useCompactNav } from "./compact-nav-context";
import { useTabs } from "./tabs-context";

export function CompactModeToggle() {
  const { activeTab } = useTabs();
  const { navOpen, propertiesOpen, toggleNav, toggleProperties } =
    useCompactNav();

  const hasProperties =
    activeTab?.kind === "task" || activeTab?.kind === "project";

  return (
    <div className="vf-compact-toggle">
      <button
        type="button"
        className={`vf-compact-toggle-btn${navOpen ? " is-active" : ""}`}
        aria-expanded={navOpen}
        aria-label={navOpen ? "Close navigation" : "Open navigation"}
        onClick={toggleNav}
      >
        <PanelLeftOpen size={14} aria-hidden />
        <span>Navigation</span>
      </button>
      <span className="vf-compact-toggle-gap" aria-hidden />
      {hasProperties && (
        <button
          type="button"
          className={`vf-compact-toggle-btn${propertiesOpen ? " is-active" : ""}`}
          aria-expanded={propertiesOpen}
          aria-label={
            propertiesOpen ? "Close properties" : "Open properties"
          }
          onClick={toggleProperties}
        >
          <PanelRightOpen size={14} aria-hidden />
          <span>Properties</span>
        </button>
      )}
    </div>
  );
}