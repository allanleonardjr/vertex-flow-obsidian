/**
 * Generic sidebar-style tree: items whose display name contains `/` are
 * split into nested, collapsible folders — one level per segment — purely
 * for rendering; the item's stored name/title stays the full path
 * everywhere else.
 *
 * Extracted from `Sidebar.tsx` so a transient filter popover (Labels/Project
 * group-wildcard filtering) can reuse the same folder-building and rendering
 * logic without inheriting the sidebar's persistent collapse-state storage.
 */

import { Fragment, type ReactNode } from "react";

export type TreeNode<T> =
  | { kind: "leaf"; segment: string; value: T }
  | {
      kind: "folder";
      segment: string;
      /** Full path from the root, e.g. `"Application/UI"`. */
      path: string;
      children: TreeNode<T>[];
    };

/**
 * Alphabetical by segment, leaf before folder on a tie. This is today's
 * only sort — exported so a future manual-order feature can fall back to
 * it (e.g. "alphabetical unless a stored rank says otherwise") instead of
 * re-deriving the tie-break rule.
 */
export function defaultTreeSort<T>(a: TreeNode<T>, b: TreeNode<T>): number {
  const bySegment = a.segment.localeCompare(b.segment);
  if (bySegment !== 0) return bySegment;
  return (a.kind === "leaf" ? 0 : 1) - (b.kind === "leaf" ? 0 : 1);
}

type MutableFolder<T> = {
  path: string;
  folders: Map<string, MutableFolder<T>>;
  leaves: T[];
};

/**
 * Split each item's name on `/` and walk/create folder nodes for every
 * segment but the last. Siblings at each depth are ordered by
 * `compareSiblings` (defaults to `defaultTreeSort`) — a future manual-sort
 * feature can pass a comparator that checks a stored rank first and falls
 * back to `defaultTreeSort`, without buildTree's own logic changing.
 */
export function buildTree<T>(
  items: T[],
  getName: (item: T) => string,
  options?: { compareSiblings?: (a: TreeNode<T>, b: TreeNode<T>) => number },
): TreeNode<T>[] {
  const compare = options?.compareSiblings ?? defaultTreeSort;
  const root: MutableFolder<T> = { path: "", folders: new Map(), leaves: [] };

  for (const item of items) {
    const segments = getName(item)
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (segments.length <= 1) {
      root.leaves.push(item);
      continue;
    }

    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = {
          path: folder.path ? `${folder.path}/${segment}` : segment,
          folders: new Map(),
          leaves: [],
        };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.leaves.push(item);
  }

  const convert = (folder: MutableFolder<T>): TreeNode<T>[] => {
    const nodes: TreeNode<T>[] = [];
    for (const [segment, child] of folder.folders) {
      nodes.push({
        kind: "folder",
        segment,
        path: child.path,
        children: convert(child),
      });
    }
    for (const value of folder.leaves) {
      const segments = getName(value)
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      nodes.push({
        kind: "leaf",
        segment: segments[segments.length - 1] ?? getName(value),
        value,
      });
    }
    nodes.sort(compare);
    return nodes;
  };

  return convert(root);
}

export function TreeGroupRow({
  segment,
  path,
  depth,
  collapsed,
  onToggle,
}: {
  segment: string;
  /** Full path from the root — shown as the hover tooltip. */
  path: string;
  depth: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="vf-tree-group-row"
      aria-expanded={!collapsed}
      onClick={onToggle}
      aria-label={path}
      style={{ paddingLeft: 20 + depth * 14 }}
    >
      <span
        className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
        aria-hidden
      >
        ›
      </span>
      {segment}
    </button>
  );
}

/**
 * Renders `nodes` as an indented, collapsible forest. `TreeList` owns only
 * the folder recursion; collapse state is fully controlled by the caller via
 * `isCollapsed`/`onToggle` (the sidebar keys it into `useSidebarChrome()`'s
 * persistent collapse map; a transient popover can back it with local
 * `useState` instead). The caller's `renderLeaf` supplies the row for the
 * leaf case, receiving the leaf value, its leaf segment, and its depth.
 */
export function TreeList<T>({
  nodes,
  depth,
  groupKeyPrefix,
  renderLeaf,
  isCollapsed,
  onToggle,
  renderFolderExtra,
}: {
  nodes: TreeNode<T>[];
  depth: number;
  groupKeyPrefix: string;
  renderLeaf: (value: T, segment: string, depth: number) => ReactNode;
  isCollapsed: (groupId: string) => boolean;
  onToggle: (groupId: string) => void;
  /**
   * Optional extra control rendered beside a folder's row (e.g. a
   * group-filter chip) — separate from the row's own expand/collapse
   * chevron, which always toggles via `onToggle` alone. Omitted by callers
   * (like the sidebar) that have no such per-folder control.
   */
  renderFolderExtra?: (path: string, depth: number) => ReactNode;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === "leaf") {
          return (
            <Fragment key={`leaf:${i}:${node.segment}`}>
              {renderLeaf(node.value, node.segment, depth)}
            </Fragment>
          );
        }

        const groupId = `${groupKeyPrefix}:${node.path}`;
        const collapsed = isCollapsed(groupId);
        return (
          <div className="vf-tree-group" key={`folder:${node.path}`}>
            {renderFolderExtra ? (
              <div className="vf-tree-group-head">
                <TreeGroupRow
                  segment={node.segment}
                  path={node.path}
                  depth={depth}
                  collapsed={collapsed}
                  onToggle={() => onToggle(groupId)}
                />
                {renderFolderExtra(node.path, depth)}
              </div>
            ) : (
              <TreeGroupRow
                segment={node.segment}
                path={node.path}
                depth={depth}
                collapsed={collapsed}
                onToggle={() => onToggle(groupId)}
              />
            )}
            {!collapsed && (
              <TreeList
                nodes={node.children}
                depth={depth + 1}
                groupKeyPrefix={groupKeyPrefix}
                renderLeaf={renderLeaf}
                isCollapsed={isCollapsed}
                onToggle={onToggle}
                renderFolderExtra={renderFolderExtra}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
