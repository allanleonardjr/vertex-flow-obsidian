/**
 * Auto-grow helpers for elements whose height must fit their wrapped content.
 *
 * Setting `el.style.height = "auto"` inline is flagged by Obsidian's lint as a
 * static style assignment (`obsidianmd/no-static-styles-assignment`). Instead
 * the base height lives in the shared `.vf-auto-grow` CSS class, and the JS
 * only writes the *measured* scroll-height pixel value (a dynamic assignment,
 * which is allowed). `resetAutoGrow` clears the inline override so the element
 * reverts to the CSS class height before re-measuring.
 */

/**
 * Reset an inline height override back to the `.vf-auto-grow` CSS height so a
 * fresh measurement reflects the content's natural wrapped height.
 */
export function resetAutoGrow(el: HTMLElement): void {
	el.style.removeProperty("height");
}
