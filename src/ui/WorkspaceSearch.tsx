/**
 * The Option/Alt+K "jump to anything" overlay — a Raycast/Linear-style launcher
 * that searches the active workspace's Tasks, Projects, Views, Dashboards,
 * Labels and People and opens whatever you pick as an internal tab.
 *
 * Mounted once near the app root next to `TabSwitcher` / `PrefixEngine`. It owns
 * its open/closed state and portals the overlay to `document.body`. Purely
 * additive — nothing else changes.
 *
 * Opening:
 *   - a `document`-level `keydown` for **Alt+K** (Option on macOS — same
 *     physical key, `altKey` on both), working regardless of focus; and
 *   - `plugin.pendingWorkspaceSearch`, the "flag set outside React, consumed
 *     once inside" bridge the Command Palette entry (main.ts) trips.
 *
 * While open: `Escape` closes and clears; `ArrowDown`/`Alt+j` and
 * `ArrowUp`/`Alt+k` move the selection (clamped, no wraparound); `Enter` or a
 * click activates the selected result. State does not persist across opens.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Platform } from "obsidian";
import type { WorkspaceSnapshot } from "../core/types";
import {
  searchWorkspace,
  splitMatches,
  type SearchResultItem,
  type SearchResultKind,
} from "../obsidian/workspace-search";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { Icon } from "./components/Icon";
import { LabelChip, PersonAvatar } from "./components/TaskBits";

/** macOS reads the launcher modifier as Option, elsewhere as Alt — same
 *  detection `TabSwitcher` uses, not `navigator`. */
const IS_MAC = Platform.isMacOS;
const ALT_KEY_LABEL = IS_MAC ? "⌥" : "Alt+";

/** Fixed render order, and how each group is labelled. */
const GROUPS: { label: string; kinds: SearchResultKind[] }[] = [
  { label: "Tasks", kinds: ["task"] },
  { label: "Projects", kinds: ["project"] },
  { label: "Views & Dashboards", kinds: ["view", "dashboard"] },
  { label: "Labels", kinds: ["label"] },
  { label: "People", kinds: ["person"] },
];

/** Fallback icon id per kind when the entity carries none. */
const DEFAULT_ICON: Record<SearchResultKind, string> = {
  task: "circle-dot",
  project: "folder",
  view: "list",
  dashboard: "layout-dashboard",
  label: "tag",
  person: "circle",
};

/**
 * The always-present "Actions" rows. Kept structurally separate from
 * `SearchResultItem` (a distinct `isAction` shape, not a widened
 * `SearchResultKind`) so nothing about fuzzy matching or its exhaustive `kind`
 * switches has to change. These never enter `searchWorkspace`.
 */
type ActionKind =
  | "create-task"
  | "create-project"
  | "create-view"
  | "create-dashboard"
  | "create-label"
  | "create-person";

interface ActionItem {
  isAction: true;
  kind: ActionKind;
  title: string;
  icon: string;
}

const ACTIONS: ActionItem[] = [
  {
    isAction: true,
    kind: "create-task",
    title: "Create task",
    icon: "circle-dot",
  },
  {
    isAction: true,
    kind: "create-project",
    title: "Create project",
    icon: "folder",
  },
  { isAction: true, kind: "create-view", title: "Create view", icon: "list" },
  {
    isAction: true,
    kind: "create-dashboard",
    title: "Create dashboard",
    icon: "layout-dashboard",
  },
  { isAction: true, kind: "create-label", title: "Create label", icon: "tag" },
  {
    isAction: true,
    kind: "create-person",
    title: "Create person",
    icon: "user",
  },
];

function Highlighted({
  text,
  matches,
}: {
  text: string;
  matches: SearchResultItem["snippetMatches"];
}) {
  return (
    <>
      {splitMatches(text, matches).map((seg, i) =>
        seg.matched ? (
          <mark key={i}>{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function WorkspaceSearch({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const tabs = useTabs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Re-render on index revision so the pending-flag bridge below re-runs when
  // the command calls `index.touch()`.
  useSyncExternalStore(
    useCallback((cb: () => void) => plugin.index.subscribe(cb), [plugin]),
    () => plugin.index.revision,
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  // Global Alt/Option+K opens the overlay from anywhere. It never toggles
  // closed — once open, focus is in the search box and Alt+k is "move
  // selection up" (see `onKeyDown`); `Escape` / backdrop / a pick close it.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code === "KeyK" &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !openRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Command Palette bridge — "flag set outside React, consumed once inside".
  useEffect(() => {
    if (!plugin.pendingWorkspaceSearch) return;
    plugin.pendingWorkspaceSearch = false;
    setOpen(true);
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(
    () => (open ? searchWorkspace(snapshot, plugin.index, query) : []),
    [open, snapshot, plugin, query],
  );

  // Group in fixed order; `flat` mirrors the rendered top-to-bottom order so
  // the active index lines up with what's on screen.
  const grouped = useMemo(() => {
    const resultSections = GROUPS.map((g) => ({
      label: g.label,
      items: results.filter((r) => g.kinds.includes(r.kind)),
    })).filter((s) => s.items.length > 0);

    const sections: {
      label: string;
      items: (SearchResultItem | ActionItem)[];
    }[] = open ? [...resultSections, { label: "Actions", items: ACTIONS }] : [];

    const flat: (SearchResultItem | ActionItem)[] = sections.flatMap(
      (s) => s.items,
    );
    return { sections, flat, hasMatches: results.length > 0 };
  }, [results, open]);

  // Keep the selection in range as results change.
  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, grouped.flat.length - 1)));
  }, [grouped.flat.length]);

  // Scroll the active row into view when keyboard nav moves off-screen.
  useEffect(() => {
    const row = resultsRef.current?.querySelector<HTMLElement>(
      ".vf-wsearch-row.is-active",
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const activate = useCallback(
    (item: SearchResultItem | ActionItem) => {
      if ("isAction" in item) {
        switch (item.kind) {
          case "create-task":
            void plugin.quickCapture();
            break;
          case "create-project":
            plugin.pendingCreateKind = "project";
            plugin.index.touch();
            break;
          case "create-view":
            plugin.pendingCreateKind = "view";
            plugin.index.touch();
            break;
          case "create-dashboard":
            plugin.pendingCreateKind = "dashboard";
            plugin.index.touch();
            break;
          case "create-label":
            plugin.pendingCreateKind = "label";
            plugin.index.touch();
            break;
          case "create-person":
            plugin.pendingCreateKind = "person";
            plugin.index.touch();
            break;
        }
        close();
        return;
      }
      switch (item.kind) {
        case "task":
          tabs.openTask(item.id);
          break;
        case "project":
          tabs.openProject(item.id);
          break;
        case "view":
          tabs.openView(item.id);
          break;
        case "dashboard":
          tabs.openDashboard(item.id);
          break;
        case "label":
          tabs.openLabel(item.id);
          break;
        case "person":
          tabs.openPerson(item.id);
          break;
      }
      close();
    },
    [tabs, close, plugin],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const count = grouped.flat.length;
      const down =
        event.key === "ArrowDown" ||
        (event.altKey && (event.key === "j" || event.code === "KeyJ"));
      const up =
        event.key === "ArrowUp" ||
        (event.altKey && (event.key === "k" || event.code === "KeyK"));
      if (down) {
        event.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(0, count - 1)));
        return;
      }
      if (up) {
        event.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = grouped.flat[active];
        if (item) activate(item);
      }
    },
    [grouped.flat, active, activate, close],
  );

  if (!open) return null;

  let renderIndex = -1;

  return createPortal(
    <div
      className="vf-wsearch-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="vf-wsearch" role="dialog" aria-label="Search workspace">
        <div className="vf-wsearch-field">
          <Icon id="search" size={16} className="vf-wsearch-field-icon" />
          <input
            ref={inputRef}
            className="vf-input vf-wsearch-input"
            type="text"
            placeholder="Search tasks, projects, views…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="vf-wsearch-scope">This workspace</span>
        </div>

        <div ref={resultsRef} className="vf-wsearch-results">
          {query.trim() && !grouped.hasMatches ? (
            <div className="vf-wsearch-empty">
              No matches for tasks, projects, views…
            </div>
          ) : null}
          {grouped.sections.map((section) => (
            <div key={section.label} className="vf-wsearch-group">
              <div
                className={`vf-wsearch-group-title${
                  section.label === "Actions" ? " is-actions" : ""
                }`}
              >
                {section.label}
              </div>
              {section.items.map((item) => {
                renderIndex += 1;
                const index = renderIndex;
                const isAction = "isAction" in item;
                return (
                  <button
                    key={
                      isAction
                        ? `action:${item.kind}`
                        : `${item.kind}:${item.id}`
                    }
                    type="button"
                    className={`vf-wsearch-row${
                      index === active ? " is-active" : ""
                    }`}
                    onMouseMove={() => setActive(index)}
                    onClick={() => activate(item)}
                  >
                    <span className="vf-wsearch-row-lead">
                      {isAction ? (
                        <Icon id={item.icon} size={14} />
                      ) : item.kind === "person" ? (
                        <PersonAvatar name={item.personName ?? item.title} />
                      ) : item.kind === "label" ? (
                        <LabelChip
                          name=""
                          color={item.color}
                          className="vf-wsearch-swatch"
                        />
                      ) : (
                        <Icon
                          id={item.icon}
                          fallback={DEFAULT_ICON[item.kind]}
                          size={14}
                        />
                      )}
                    </span>
                    <span className="vf-wsearch-row-text">
                      <span className="vf-wsearch-row-title">
                        {isAction ? (
                          item.title
                        ) : (
                          <Highlighted
                            text={item.title}
                            matches={item.titleMatches}
                          />
                        )}
                      </span>
                      {!isAction && item.snippet ? (
                        <span className="vf-wsearch-row-snippet">
                          <Highlighted
                            text={item.snippet}
                            matches={item.snippetMatches}
                          />
                        </span>
                      ) : null}
                    </span>
                    {!isAction ? (
                      <span className="vf-wsearch-row-kind">{item.kind}</span>
                    ) : null}
                    {index === active ? (
                      <span className="vf-wsearch-row-enter">↵</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="vf-wsearch-footer">
          <span className="vf-wsearch-keys">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <span className="vf-wsearch-keys-sep">/</span>
            <kbd>{ALT_KEY_LABEL}j</kbd>
            <kbd>{ALT_KEY_LABEL}k</kbd>
            navigate
          </span>
          <span className="vf-wsearch-keys">
            <kbd>↵</kbd>
            open
          </span>
          <span className="vf-wsearch-keys">
            <kbd>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
