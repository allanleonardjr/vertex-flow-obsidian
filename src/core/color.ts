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
 */

export const COLOR_PALETTE: readonly string[] = [
  // ROW 1: Monochromatic Neutral Scale (Col 1: White -> Col 8: Black)
  "#ffffff", // Pure White (Col 1, Row 1)
  "#f1f5f9", // Off-White / Slate 100 (Col 2, Row 1)
  "#cbd5e1", // Light Gray / Slate 300 (Col 3, Row 1)
  "#94a3b8", // Cool Gray / Slate 400 (Col 4, Row 1)
  "#64748b", // Mid Gray / Slate 500 (Col 5, Row 1)
  "#334155", // Dark Slate / Slate 700 (Col 6, Row 1)
  "#1e293b", // Deep Charcoal / Slate 800 (Col 7, Row 1)
  "#000000", // Pitch Black (Col 8, Row 1)

  // ROW 2: Soft / Pastel Accents (Col 1: Red -> Col 8: Pink)
  "#fca5a5", // Soft Red (Col 1, Row 2)
  "#fdba74", // Soft Orange (Col 2, Row 2)
  "#fcd34d", // Soft Yellow (Col 3, Row 2)
  "#6ee7b7", // Soft Mint Green (Col 4, Row 2)
  "#67e8f9", // Soft Cyan (Col 5, Row 2)
  "#93c5fd", // Soft Blue (Col 6, Row 2)
  "#d8b4fe", // Soft Purple (Col 7, Row 2)
  "#f9a8d4", // Soft Pink (Col 8, Row 2)

  // ROW 3: Vibrant Mid-Tones (Col 1: Red -> Col 8: Pink)
  "#ef4444", // Red (Col 1, Row 3)
  "#f97316", // Orange (Col 2, Row 3)
  "#f59e0b", // Amber (Col 3, Row 3)
  "#22c55e", // True Green (Col 4, Row 3)
  "#06b6d4", // Cyan (Col 5, Row 3)
  "#3b82f6", // Blue (Col 6, Row 3)
  "#a855f7", // Purple (Col 7, Row 3)
  "#ec4899", // Pink (Col 8, Row 3)

  // ROW 4: Muted Chromatics (Col 1: Red -> Col 8: Pink)
  "#f43f5e", // Rose Red (Col 1, Row 4)
  "#ea580c", // Muted Orange (Col 2, Row 4)
  "#eab308", // Golden Yellow (Col 3, Row 4)
  "#34d399", // Emerald Green (Col 4, Row 4)
  "#14b8a6", // Muted Teal (Col 5, Row 4)
  "#60a5fa", // Sky Blue (Col 6, Row 4)
  "#6366f1", // Indigo (Col 7, Row 4)
  "#db2777", // Deep Rose Pink (Col 8, Row 4)

  // ROW 5: Deep / Dark Tones (Col 1: Red -> Col 8: Pink)
  "#b91c1c", // Deep Red (Col 1, Row 5)
  "#c2410c", // Deep Orange (Col 2, Row 5)
  "#a16207", // Deep Amber (Col 3, Row 5)
  "#15803d", // Deep Forest Green (Col 4, Row 5)
  "#0f766e", // Deep Teal (Col 5, Row 5)
  "#1d4ed8", // Deep Sapphire Blue (Col 6, Row 5)
  "#8b5cf6", // Deep Violet (Col 7, Row 5)
  "#be185d", // Deep Magenta (Col 8, Row 5)

  // ROW 6: Earths & Muted Darks (Col 1: Red -> Col 8: Pink)
  "#9a3412", // Terracotta / Rust (Col 1, Row 6)
  "#78350f", // Walnut Brown (Col 2, Row 6)
  "#854d0e", // Deep Olive-Gold (Col 3, Row 6)
  "#4d7c0f", // Deep Olive Green (Col 4, Row 6)
  "#134e4a", // Dark Pine / Teal (Col 5, Row 6)
  "#1e3a8a", // Dark Navy Blue (Col 6, Row 6)
  "#6b21a8", // Dark Purple (Col 7, Row 6)
  "#831843", // Deep Plum (Col 8, Row 6)
] as const;
