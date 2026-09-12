import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  ISOLATED_GRID_GAP,
  flattenCanvasLayout,
  mergeIsolatedIntoLayout,
  packCanvasGrid,
  planIsolatedGrid,
  resolveIsolatedGrids,
  type ElkLayoutNode,
  type IsolatedGridBox,
  type IsolatedGridPlan,
  type PlacedBox,
} from "../../src/core/canvas/layout";
import {
  getCanvasElkOptions,
  partitionByConnectivity,
} from "../../src/core/canvas/graph";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;
const ELK_SPACING: Record<string, string> = {
  "elk.spacing.nodeNode": "36",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
};
const GROUP_PADDING = "[top=34.0,left=16.0,bottom=16.0,right=16.0]";
// Narrow container → 2 grid columns, so grids wrap into multiple rows.
const VIEWPORT = 520;

const elk = new ELK();
const leaf = (id: string) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });
const sizeById = (ids: string[]) => new Map(ids.map((id) => [id, leaf(id)]));

const columnsFor = (count: number) =>
  Math.max(
    1,
    Math.min(
      count,
      Math.floor(
        (VIEWPORT + ISOLATED_GRID_GAP) / (NODE_WIDTH + ISOLATED_GRID_GAP),
      ),
    ),
  );

type NodeLike = { id: string; task: object };

function overlap(a: PlacedBox, b: PlacedBox) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function layoutGrouped(
  groups: { key: string; tasks: NodeLike[] }[],
  layoutEdges: readonly { source: string; target: string }[],
) {
  const partitions = new Map(
    groups.map((g) => [
      `group:${g.key}`,
      partitionByConnectivity(g.tasks as never, layoutEdges as never),
    ]),
  );

  // The reserve-then-fill pipeline from `CanvasView`: each group with
  // isolated members gets a placeholder leaf pre-sized to its grid, so ELK
  // reserves the space and pushes sibling groups clear of it.
  const gridPlans = new Map<string, IsolatedGridPlan>();
  for (const g of groups) {
    const scopeId = `group:${g.key}`;
    const isolated = partitions.get(scopeId)!.isolated;
    if (isolated.length === 0) continue;
    gridPlans.set(
      scopeId,
      planIsolatedGrid(
        scopeId,
        isolated,
        sizeById(isolated.map((n) => n.id)),
        NODE_WIDTH,
        ISOLATED_GRID_GAP,
        columnsFor(isolated.length),
      ),
    );
  }

  const children = groups.map((g) => {
    const scopeId = `group:${g.key}`;
    const plan = gridPlans.get(scopeId);
    return {
      id: scopeId,
      layoutOptions: {
        ...getCanvasElkOptions("flow", "right"),
        "elk.padding": GROUP_PADDING,
        ...ELK_SPACING,
      },
      children: [
        ...(partitions.get(scopeId)!.connected ?? []).map((n) => leaf(n.id)),
        ...(plan
          ? [
              {
                id: plan.placeholderId,
                width: plan.placeholder.width,
                height: plan.placeholder.height,
              },
            ]
          : []),
      ],
    };
  });

  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      ...getCanvasElkOptions("flow", "right"),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      ...ELK_SPACING,
    },
    children,
    edges: layoutEdges.map((e, i) => ({
      id: `edge-${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  } as never);

  const base = flattenCanvasLayout(res as unknown as ElkLayoutNode, new Map(), {
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  });
  return resolveIsolatedGrids(base, [...gridPlans.values()]);
}

function assertInside(box: PlacedBox, node: PlacedBox, id: string) {
  expect(node.x, `${id} left inside its group`).toBeGreaterThanOrEqual(box.x);
  expect(node.y, `${id} top inside its group`).toBeGreaterThanOrEqual(box.y);
  expect(node.x + node.width, `${id} right inside its group`).toBeLessThanOrEqual(
    box.x + box.width,
  );
  expect(node.y + node.height, `${id} bottom inside its group`).toBeLessThanOrEqual(
    box.y + box.height,
  );
}

describe("grouped isolated grids — reserved inside ELK", () => {
  it("regression (5e076fa): a partially-isolated group never overlaps its sibling", async () => {
    // `todo` has connected A→B plus isolated C; `done` is fully connected.
    const laidOut = await layoutGrouped(
      [
        {
          key: "todo",
          tasks: [
            { id: "A", task: {} },
            { id: "B", task: {} },
            { id: "C", task: {} },
          ],
        },
        {
          key: "done",
          tasks: [
            { id: "X", task: {} },
            { id: "Y", task: {} },
          ],
        },
      ],
      [
        { source: "A", target: "B" },
        { source: "X", target: "Y" },
      ],
    );

    const todo = laidOut.groups.get("group:todo")!;
    const done = laidOut.groups.get("group:done")!;
    expect(overlap(todo, done)).toBe(false);
    // Every card sits inside its own group's box.
    for (const id of ["A", "B", "C"]) assertInside(todo, laidOut.nodes.get(id)!, id);
    for (const id of ["X", "Y"]) assertInside(done, laidOut.nodes.get(id)!, id);
  });

  it("regression (5e076fa): two fully-isolated groups get separate compound boxes", async () => {
    // No layout edges at all — everything isolated, every group placeholder-only.
    const laidOut = await layoutGrouped(
      [
        {
          key: "todo",
          tasks: [
            { id: "A", task: {} },
            { id: "B", task: {} },
          ],
        },
        {
          key: "done",
          tasks: [
            { id: "X", task: {} },
            { id: "Y", task: {} },
          ],
        },
      ],
      [],
    );

    const todo = laidOut.groups.get("group:todo")!;
    const done = laidOut.groups.get("group:done")!;
    // Real boxes (not the old 0×0 empty compounds) that don't collide.
    expect(todo.width).toBeGreaterThan(NODE_WIDTH);
    expect(todo.height).toBeGreaterThan(NODE_HEIGHT);
    expect(done.width).toBeGreaterThan(NODE_WIDTH);
    expect(done.height).toBeGreaterThan(NODE_HEIGHT);
    expect(overlap(todo, done)).toBe(false);
    for (const id of ["A", "B"]) assertInside(todo, laidOut.nodes.get(id)!, id);
    for (const id of ["X", "Y"]) assertInside(done, laidOut.nodes.get(id)!, id);
  });

  it("no placeholders leak into the final layout", async () => {
    const laidOut = await layoutGrouped(
      [
        {
          key: "todo",
          tasks: [{ id: "A", task: {} }],
        },
      ],
      [],
    );
    for (const id of laidOut.nodes.keys()) {
      expect(id.startsWith("__vf-grid:")).toBe(false);
    }
  });
});

describe("flat root isolated grid — appended below the connected block", () => {
  it("sits below the block when direction is right, clear of the strip", async () => {
    const connected = ["A1", "A2", "A3", "A4", "A5", "A6"].map(leaf);
    const isolated = ["C1", "C2", "C3"].map((id) => ({ id, task: {} }));
    const edges = connected
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, sources: [connected[i].id], targets: [n.id] }));

    const res = await elk.layout({
      id: "root",
      layoutOptions: {
        ...getCanvasElkOptions("flow", "right"),
        ...ELK_SPACING,
      },
      children: connected,
      edges,
    } as never);
    const base = flattenCanvasLayout(res as unknown as ElkLayoutNode, new Map(), {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    });

    const cols = columnsFor(isolated.length);
    const cellHeight = NODE_HEIGHT;
    const positions = packCanvasGrid(
      isolated as never,
      NODE_WIDTH,
      cellHeight,
      ISOLATED_GRID_GAP,
      cols,
    );
    const boxes: IsolatedGridBox[] = positions.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }));
    const merged = mergeIsolatedIntoLayout(
      base,
      new Map([["root", boxes]]),
      "right",
    );

    const c1 = merged.nodes.get("C1")!;
    expect(c1.x).toBe(0);
    // Below the whole strip, not tucked under the first card.
    expect(c1.y).toBeGreaterThanOrEqual(base.height);
    expect(c1.y).toBeLessThan(base.height + ISOLATED_GRID_GAP + 1);
  });
});