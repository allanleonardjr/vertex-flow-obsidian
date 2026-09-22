/**
 * The one native dropdown every screen uses. Obsidian's base theme strips the
 * `<select>` arrow (an `appearance` reset) and draws no replacement, so a
 * bare `<select>` reads as a text box. A `<select>` can't host a
 * pseudo-element, and a `background-image` arrow can't follow a theme
 * variable, so the chevron is the wrapper's `::after`, masked from an SVG and
 * painted with `var(--text-muted)` (see `.vf-select-wrap` in `styles.css`).
 *
 * Takes every native `<select>` prop; `className` stays on the `<select>`
 * itself so existing rules (`.vf-select`, `.vf-input`, …) keep matching, and
 * `wrapClassName` styles the wrapper where a call site needs it (width,
 * flex behavior). A bare `<select>` elsewhere in `src/` fails lint.
 */

import { forwardRef, type SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Extra class on the `.vf-select-wrap` wrapper, e.g. `vf-select-wrap-block` to fill the row. */
  wrapClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { wrapClassName, className, ...rest },
  ref,
) {
  return (
    <span
      className={
        "vf-select-wrap" +
        (wrapClassName ? ` ${wrapClassName}` : "") +
        (rest.disabled ? " is-disabled" : "")
      }
    >
      <select ref={ref} {...rest} className={className} />
    </span>
  );
});
