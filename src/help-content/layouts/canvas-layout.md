---
title: Canvas layout
order: 50
---

The Canvas layout paints your view's tasks as a **relationship graph**: cards
laid out by a layout engine, with dependencies, hierarchy, and related links
drawn between them. Where List and Board arrange the same cards into columns
and rows, Canvas arranges them by *how they connect* — the graph is shaped by
the relations themselves.

Press **`v` `d`** to switch the current view to Canvas, or pick **Canvas**
from the layout picker.

## Arranging the graph

The **Arrange** chip in the view bar chooses how cards are laid out: two
arrangements, each in two directions.

| Option | What gets ranked |
| --- | --- |
| **Dependency flow** (left to right / top to bottom) | Every dependency (`Blocks`) and parent→child edge, ranked together |
| **Hierarchy** (left to right / top to bottom) | Only parent→child edges; dependencies draw as overlays after layout |

Left-to-right / top-to-bottom is the flow axis of the graph, not the reading
direction of your arena. In **Hierarchy**, dependency edges are drawn edge to
edge between final card centres after layout rather than feeding the ranking,
the same way related links are. If the view has no visible hierarchy edge at
all, Hierarchy silently falls back to flow — with a subtle hint explaining
why.

## Groups

Set **Group by** to Status, Priority, Type, Assignee, or Project and each
group (including its "None") becomes a labelled box; hidden groups drop out,
exactly as on the Board. **Label** grouping and no grouping render the canvas
flat.

## Cards and edges

Each card shows the task's status, type, priority, due date, ID, and
assignee, plus the project when you're not grouping by it. The **Fields**
popover narrows itself to just those fields on Canvas — Labels, Estimate,
Start date, Progress, and Relations aren't offered there, because toggling
them would do nothing.

Edges come in three styles, keyed in the corner legend:

- **Solid arrow** — `Blocks` / `Blocked by` dependencies.
- **Thin connector** — `Parent of` → sub-task hierarchy, with a small square
  at the parent end so direction reads without following the arrow convention
  alone.
- **Dashed** — `Related` links.

The **Relations** chip toggles each style on and off. Hiding a dependency or
hierarchy edge also removes it from the layout ranking, so the graph actually
re-flows; hiding related links only redraws those lines.

## Working on the graph

- **Open a task** — click its card.
- **Pan** — drag the empty canvas background.
- **Zoom** — scroll the wheel (or pinch on touch). A bottom-left widget adds
  − / + buttons, a slider, a percentage readout, and a **Fit to view** button.
- **Hover a card** — everything unconnected dims, and everything directly
  connected gets a bright border, so it's clear *which* of the still-bright
  cards a hover is calling out.

### Creating relations

The **Connect** control sits at the top-left of the canvas. It's **Off** by
default — nothing draws until you pick a kind: **Blocks**, **Parent of**, or
**Related**. Then:

- **Drag** — every card shows a small handle on hover; drag it onto another
  card to draw that relation. The drop target highlights, turning red when the
  link would be refused.
- **Tap** — with a draw kind on, tapping a card arms it as the connection's
  source (a pulsing border); tapping a second card completes the link, with a
  screen-anchored confirm bar showing the pending pair and offering
  **Cancel** / **Connect**.

Both methods share the same safeguards: self-loops and already-existing links
are silent no-ops, dependency and hierarchy cycles are refused with a clear
message before anything is written, and giving a task that already has a
different parent a new one asks for confirmation first. Re-tapping the armed
card, tapping a third card, or pressing `Esc` cancels or re-targets an
in-progress drag-and-tap gesture.

### Editing relations

Click an edge to select it. A small popup offers **Delete** and, for
Blocks / Parent-of edges, **Reverse** — which re-checks for cycles in the new
direction before flipping it. `Delete` / `Backspace` also removes the selected
edge.

## Isolated cards

Tasks nothing on the graph connects to — a task linked only via `Related`, or
a `Blocks`-only task while in Hierarchy arrangement — don't get consigned to a
long lonely strip. A scope's unconnected cards are grid-packed into a compact
two-dimensional grid in the view's existing sort order, below or beside its
connected block, inside the group's box (never re-sorted). A graph where
*everything* is isolated is the same logic with nothing connected at all.

## Saving

Arrangement, direction, and hidden relation kinds all travel with the view:
flip the same Saved View back to Canvas later and it looks the same. The text
query spells them `canvas-layout:` / `canvas-direction:` (e.g.
`canvas-layout:tree`, `canvas-direction:down`) and the Relations chip's state
as a `relations:` clause.