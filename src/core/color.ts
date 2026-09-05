/**
 * App-wide color palette.
 *
 * The single source of truth for the preset swatches offered across the app
 * (the taxonomy settings, the label editor, and anything else that colors an
 * entity). Laid out as a 48-color Spectrum Matrix so that rendering it in an
 * 8-column CSS grid (`grid-template-columns: repeat(8, 1fr);`) produces
 * vertical color columns.
 *
 * Row 1 (indices 0-7) is a monochromatic neutral scale from Pure White to
 * Pitch Black. Rows 2-6 (indices 8-47) are five chromatic intensity bands, one
 * swatch per color family per band. Because CSS grid fills left-to-right, each
 * family occupies a fixed column (same index mod 8) and reads vertically down
 * the matrix:
 *
 *   Col 1 Reds · Col 2 Oranges · Col 3 Yellows · Col 4 Limes/Greens
 *   Col 5 Teals/Cyans · Col 6 Blues · Col 7 Indigos/Purples · Col 8 Pinks/Magentas
 *
 *   Row 2 Soft / Pastel · Row 3 Vibrant Mid-Tones · Row 4 Muted Chromatics
 *   Row 5 Deep / Dark · Row 6 Earths & Muted Darks
 *
 * The source of truth lives in `COLOR_PALETTE_ENTRIES` — `[name, hex]` pairs so
 * the friendly swatch names never drift from the values. `COLOR_PALETTE` and
 * `COLOR_PALETTE_NAMES` are derived from it and always stay the same length in
 * the same order.
 */

export const COLOR_PALETTE_ENTRIES: readonly (readonly [name: string, hex: string])[] = [
  // ROW 1: Monochromatic Neutral Scale (Col 1: White -> Col 8: Black)
  ["Pure White", "#ffffff"],
  ["Off-White / Slate 100", "#f1f5f9"],
  ["Light Gray / Slate 300", "#cbd5e1"],
  ["Cool Gray / Slate 400", "#94a3b8"],
  ["Mid Gray / Slate 500", "#64748b"],
  ["Dark Slate / Slate 700", "#334155"],
  ["Deep Charcoal / Slate 800", "#1e293b"],
  ["Pitch Black", "#000000"],

  // ROW 2: Soft / Pastel Accents (Col 1: Red -> Col 8: Pink)
  ["Soft Red", "#fca5a5"],
  ["Soft Orange", "#fdba74"],
  ["Soft Yellow", "#fcd34d"],
  ["Soft Mint Green", "#6ee7b7"],
  ["Soft Cyan", "#67e8f9"],
  ["Soft Blue", "#93c5fd"],
  ["Soft Purple", "#d8b4fe"],
  ["Soft Pink", "#f9a8d4"],

  // ROW 3: Vibrant Mid-Tones (Col 1: Red -> Col 8: Pink)
  ["Red", "#ef4444"],
  ["Orange", "#f97316"],
  ["Amber", "#f59e0b"],
  ["True Green", "#22c55e"],
  ["Cyan", "#06b6d4"],
  ["Blue", "#3b82f6"],
  ["Purple", "#a855f7"],
  ["Pink", "#ec4899"],

  // ROW 4: Muted Chromatics (Col 1: Red -> Col 8: Pink)
  ["Rose Red", "#f43f5e"],
  ["Muted Orange", "#ea580c"],
  ["Golden Yellow", "#eab308"],
  ["Emerald Green", "#34d399"],
  ["Muted Teal", "#14b8a6"],
  ["Sky Blue", "#60a5fa"],
  ["Indigo", "#6366f1"],
  ["Deep Rose Pink", "#db2777"],

  // ROW 5: Deep / Dark Tones (Col 1: Red -> Col 8: Pink)
  ["Deep Red", "#b91c1c"],
  ["Deep Orange", "#c2410c"],
  ["Deep Amber", "#a16207"],
  ["Deep Forest Green", "#15803d"],
  ["Deep Teal", "#0f766e"],
  ["Deep Sapphire Blue", "#1d4ed8"],
  ["Deep Violet", "#8b5cf6"],
  ["Deep Magenta", "#be185d"],

  // ROW 6: Earths & Muted Darks (Col 1: Red -> Col 8: Pink)
  ["Terracotta / Rust", "#9a3412"],
  ["Walnut Brown", "#78350f"],
  ["Deep Olive-Gold", "#854d0e"],
  ["Deep Olive Green", "#4d7c0f"],
  ["Dark Pine / Teal", "#134e4a"],
  ["Dark Navy Blue", "#1e3a8a"],
  ["Dark Purple", "#6b21a8"],
  ["Deep Plum", "#831843"],
];

/** The 48 hex values, index-aligned with `COLOR_PALETTE_NAMES`. */
export const COLOR_PALETTE: readonly string[] = COLOR_PALETTE_ENTRIES.map(
  ([, hex]) => hex,
);

/** The 48 friendly names, index-aligned with `COLOR_PALETTE`. */
export const COLOR_PALETTE_NAMES: readonly string[] = COLOR_PALETTE_ENTRIES.map(
  ([name]) => name,
);