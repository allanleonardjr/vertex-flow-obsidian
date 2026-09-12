/**
 * The always-visible display controls on the view bar: a flat List/Board
 * switch and the Group / Sort text controls. Nothing here is styled as a
 * button — each is quiet text that reveals a faint hover background and opens a
 * short option list (via `Popover`) on click.
 */

import { Eye, EyeOff } from "lucide-react";
import type { BarControlId } from "./FilterControls";
import type { FilterKey } from "./viewOptions";
import {
  CANVAS_RELATION_KINDS,
  type CanvasArrangement,
  type CanvasDirection,
  type CanvasRelationKind,
  type EmptyColumnBehavior,
  type GroupByField,
  type SavedView,
  type SortField,
  type SubtaskDisplay,
  type ViewType,
} from "../../core/types";
import { layoutIcon } from "../../core/views";
import { Icon } from "../components/Icon";
import { Popover } from "../components/Popover";
import { RELATION_KIND_LABELS } from "./CanvasView";
import {
  CANVAS_ARRANGE_OPTIONS,
  EMPTY_COLUMN_OPTIONS,
  FIELD_OPTIONS,
  GROUP_OPTIONS,
  SORT_OPTIONS,
  SUBTASK_OPTIONS,
  canvasArrangeSummary,
  optionLabel,
  type TaskField,
} from "./viewOptions";

export function LayoutToggle({
  view,
  onChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
}) {
  const layouts: { value: ViewType; label: string }[] = [
    { value: "list", label: "List" },
    { value: "board", label: "Board" },
    { value: "timeline", label: "Timeline" },
    { value: "calendar", label: "Calendar" },
    { value: "canvas", label: "Canvas" },
  ];
  return (
    <div className="vf-layout-toggle" role="group" aria-label="Layout">
      {layouts.map((layout) => (
        <button
          key={layout.value}
          type="button"
          className={`vf-layout-opt${view.viewType === layout.value ? " is-on" : ""}`}
          aria-pressed={view.viewType === layout.value}
          aria-label={layout.label}
          title={layout.label}
          onClick={() =>
            view.viewType !== layout.value &&
            onChange({ ...view, viewType: layout.value })
          }
        >
          <span className="vf-bar-icon" aria-hidden>
            <Icon id={layoutIcon(layout.value)} size={14} />
          </span>
          {layout.value === "canvas" && view.viewType === "canvas" && (
            <span className="vf-canvas-beta-badge" aria-hidden>
              BETA
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function BarSelect<T extends string>({
  id,
  label,
  value,
  options,
  onSelect,
  openId,
  onOpenChange,
}: {
  id: BarControlId;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const open = openId === id;
  return (
    <span className="vf-control-anchor">
      <button
        type="button"
        className={`vf-bar-item${open ? " is-on" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(open ? null : id);
        }}
      >
        <span className="vf-bar-label">{label}</span>
        <span className="vf-bar-value">{optionLabel(options, value)}</span>
        <span className="vf-bar-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <Popover align="left" onClose={() => onOpenChange(null)}>
          <div className="vf-option-list">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`vf-menu-item${option.value === value ? " is-active" : ""}`}
                onClick={() => {
                  onSelect(option.value);
                  onOpenChange(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

export function GroupChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  return (
    <BarSelect
      id="group"
      label="Group"
      value={view.groupBy}
      options={GROUP_OPTIONS}
      onSelect={(groupBy: GroupByField) => onChange({ ...view, groupBy })}
      openId={openId}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * How the view treats sub-tasks. Definitional, so it sits with Group and
 * Sort as a display control.
 *
 * `Nested` only means something on the List view — every other layout renders a
 * tree as a flat set — so on Board/Timeline/Calendar the control drops to
 * Flat/Hidden and a stored `nested` reads as `Flat`. The value is still kept, so
 * flipping the view back to List restores the tree (same as `hiddenFields`).
 */
export function SubtasksChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const isList = view.viewType === "list";
  const options = isList
    ? SUBTASK_OPTIONS
    : SUBTASK_OPTIONS.filter((option) => option.value !== "nested");
  const value: SubtaskDisplay =
    !isList && view.subtaskDisplay === "nested" ? "flat" : view.subtaskDisplay;

  return (
    <BarSelect
      id="subtasks"
      label="Sub-tasks"
      value={value}
      options={options}
      onSelect={(subtaskDisplay: SubtaskDisplay) =>
        onChange({ ...view, subtaskDisplay })
      }
      openId={openId}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * Whether the view previews upcoming occurrences of recurring tasks as ghost
 * rows (`show:recurring` in the text query). Definitional — persists with the
 * view — and off by default on every view.
 */
export function RecurringPreviewChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  return (
    <BarSelect
      id="recurring"
      label="Upcoming"
      value={view.recurringPreview ? "on" : "off"}
      options={[
        { value: "off", label: "Hide recurring" },
        { value: "on", label: "Show recurring" },
      ]}
      onSelect={(next: "on" | "off") =>
        onChange({ ...view, recurringPreview: next === "on" })
      }
      openId={openId}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * Board-only: empty-column behavior. Previously reachable only through
 * the text query (`empty:auto-collapse`); this surfaces it on the bar like the
 * other display controls.
 */
export function EmptyColumnsChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  return (
    <BarSelect
      id="emptyColumns"
      label="Empty cols"
      value={view.emptyColumnBehavior}
      options={EMPTY_COLUMN_OPTIONS}
      onSelect={(emptyColumnBehavior: EmptyColumnBehavior) =>
        onChange({ ...view, emptyColumnBehavior })
      }
      openId={openId}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * Which task fields this view's rows/cards show. Stored as `hiddenFields`
 * but presented positively — a lit row means "visible". Status icon, ID and
 * title are mandatory and never listed. All fields are offered in both layouts;
 * one a layout can't render (e.g. Type on a list) is simply inert there, which
 * is what each option's `hint` is for.
 *
 * A vertical checklist rather than a chip cloud: the list is long enough now
 * that a wrapped cloud has no scan order, and a row leaves space for the
 * eye/eye-off icon that carries the state without relying on colour alone.
 */
export function FieldsControl({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const open = openId === "fields";
  const hidden = view.hiddenFields;
  // Canvas curates its field set (Phase 4) — it never even offers the other
  // five as toggleable, so the popover, the count, and the bulk actions below
  // all have to work off this filtered set, not the global FIELD_OPTIONS.
  const options = FIELD_OPTIONS.filter(
    (o) => !o.unsupportedFor?.includes(view.viewType),
  );
  const visibleCount = options.filter((o) => !hidden.includes(o.value)).length;

  const toggle = (field: TaskField) =>
    onChange({
      ...view,
      hiddenFields: hidden.includes(field)
        ? hidden.filter((f) => f !== field)
        : [...hidden, field],
    });

  return (
    <span className="vf-control-anchor">
      <button
        type="button"
        className={`vf-bar-item${open ? " is-on" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(open ? null : "fields");
        }}
      >
        <span className="vf-bar-label">Fields</span>
        <span className="vf-bar-value">
          {visibleCount === options.length
            ? "All"
            : `${visibleCount} of ${options.length}`}
        </span>
        <span className="vf-bar-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <Popover align="left" onClose={() => onOpenChange(null)}>
          <div className="vf-field-list">
            {options.map((option) => {
              const shown = !hidden.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`vf-field-row${shown ? " is-on" : ""}`}
                  aria-pressed={shown}
                  title={
                    shown ? `Hide ${option.label}` : `Show ${option.label}`
                  }
                  onClick={() => toggle(option.value)}
                >
                  <span className="vf-field-eye" aria-hidden>
                    {shown ? <Eye size={14} /> : <EyeOff size={14} />}
                  </span>
                  <span className="vf-field-label">{option.label}</span>
                  {option.hint && (
                    <span className="vf-field-hint">{option.hint}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="vf-field-list-footer">
            <button
              type="button"
              className="vf-field-bulk"
              disabled={hidden.length === 0}
              onClick={() => onChange({ ...view, hiddenFields: [] })}
            >
              Show all
            </button>
            <button
              type="button"
              className="vf-field-bulk"
              disabled={visibleCount === 0}
              onClick={() =>
                onChange({
                  ...view,
                  // hiddenFields is shared across every layout a view can take
                  // (Board's Labels stay hidden even after switching to
                  // Canvas), so "Hide all" here must only add the fields this
                  // view's popover actually offered — never the ones Canvas
                  // never showed as toggleable in the first place.
                  hiddenFields: [
                    ...hidden.filter(
                      (f) => !options.some((o) => o.value === f),
                    ),
                    ...options.map((o) => o.value),
                  ],
                })
              }
            >
              Hide all
            </button>
          </div>

          <p className="vf-fields-note">
            Status, ID and title are always shown.
          </p>
        </Popover>
      )}
    </span>
  );
}

/**
 * Canvas-only: which relationship kinds the graph draws. A *hidden* list, like
 * `hiddenFields` — empty means all three show. Hiding `dependency`/`hierarchy`
 * also drops those edges from the layout ranking (handled in `CanvasView`).
 */
export function CanvasRelationsChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const open = openId === "canvasRelations";
  const hidden = view.canvasHiddenRelationKinds ?? [];

  const toggle = (kind: CanvasRelationKind) => {
    const next = hidden.includes(kind)
      ? hidden.filter((k) => k !== kind)
      : [...hidden, kind];
    onChange({
      ...view,
      canvasHiddenRelationKinds: next.length > 0 ? next : undefined,
    });
  };

  return (
    <span className="vf-control-anchor">
      <button
        type="button"
        className={`vf-bar-item${open ? " is-on" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(open ? null : "canvasRelations");
        }}
      >
        <span className="vf-bar-label">Relations</span>
        <span className="vf-bar-value">
          {hidden.length === 0
            ? "All"
            : `${CANVAS_RELATION_KINDS.length - hidden.length} of ${CANVAS_RELATION_KINDS.length}`}
        </span>
        <span className="vf-bar-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <Popover align="left" onClose={() => onOpenChange(null)}>
          <div className="vf-field-list">
            {CANVAS_RELATION_KINDS.map((kind) => {
              const shown = !hidden.includes(kind);
              const label = RELATION_KIND_LABELS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className={`vf-field-row${shown ? " is-on" : ""}`}
                  aria-pressed={shown}
                  title={shown ? `Hide ${label}` : `Show ${label}`}
                  onClick={() => toggle(kind)}
                >
                  <span className="vf-field-eye" aria-hidden>
                    {shown ? <Eye size={14} /> : <EyeOff size={14} />}
                  </span>
                  <span className="vf-field-label">{label}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </span>
  );
}

/**
 * Canvas-only: how the graph is arranged — two layouts (dependency *flow* vs
 * parent–child *tree*) × two directions (left-to-right / top-to-bottom). One
 * control, four options, exactly like `Rel`-ations above it; the text query
 * spells it `canvas-layout:` / `canvas-direction:`.
 */
export function CanvasArrangeChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const open = openId === "canvasArrange";
  const arrangement: CanvasArrangement = view.canvasArrangement ?? "flow";
  const direction: CanvasDirection = view.canvasDirection ?? "right";

  return (
    <span className="vf-control-anchor">
      <button
        type="button"
        className={`vf-bar-item${open ? " is-on" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(open ? null : "canvasArrange");
        }}
      >
        <span className="vf-bar-label">Arrange</span>
        <span className="vf-bar-value">
          {canvasArrangeSummary(arrangement, direction)}
        </span>
        <span className="vf-bar-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <Popover align="left" onClose={() => onOpenChange(null)}>
          <div className="vf-field-list">
            {CANVAS_ARRANGE_OPTIONS.map((option) => {
              const active =
                option.value.arrangement === arrangement &&
                option.value.direction === direction;
              return (
                <button
                  key={`${option.value.arrangement}-${option.value.direction}`}
                  type="button"
                  className={`vf-field-row${active ? " is-on" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    onChange({
                      ...view,
                      canvasArrangement: option.value.arrangement,
                      canvasDirection: option.value.direction,
                    });
                    onOpenChange(null);
                  }}
                >
                  <span className="vf-field-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </span>
  );
}

export function SortChip({
  view,
  onChange,
  openId,
  onOpenChange,
}: {
  view: SavedView;
  onChange: (next: SavedView) => void;
  openId: BarControlId | FilterKey | null;
  onOpenChange: (id: BarControlId | FilterKey | null) => void;
}) {
  const flip = () =>
    onChange({
      ...view,
      sortDirection: view.sortDirection === "asc" ? "desc" : "asc",
    });
  return (
    <span className="vf-bar-group">
      <BarSelect
        id="sort"
        label="Sort"
        value={view.sortBy}
        options={SORT_OPTIONS}
        onSelect={(sortBy: SortField) => onChange({ ...view, sortBy })}
        openId={openId}
        onOpenChange={onOpenChange}
      />
      <button
        type="button"
        className="vf-bar-item vf-bar-dir"
        title={view.sortDirection === "asc" ? "Ascending" : "Descending"}
        aria-label={`Sort direction: ${view.sortDirection === "asc" ? "ascending" : "descending"}`}
        onClick={flip}
      >
        {view.sortDirection === "asc" ? "↑" : "↓"}
      </button>
    </span>
  );
}
