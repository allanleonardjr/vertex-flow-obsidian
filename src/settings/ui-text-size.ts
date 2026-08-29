/**
 * Applies the interface text-size preference as a `<body>` class, so the
 * scaled `--font-ui-*` tokens (see `styles.css`) reach both the plugin's own
 * subtree and everything it portals to `document.body` (dialogs, the link
 * autocomplete, the drag layer).
 */

import type { UiTextSize } from "./types";

const CLASSES: Record<UiTextSize, string> = {
	compact: "vf-text-compact",
	cozy: "vf-text-cozy",
	comfortable: "vf-text-comfortable",
};

export function applyUiTextSize(size: UiTextSize): void {
	const body = document.body;
	for (const cls of Object.values(CLASSES)) body.removeClass(cls);
	body.addClass(CLASSES[size]);
}

export function clearUiTextSize(): void {
	for (const cls of Object.values(CLASSES)) document.body.removeClass(cls);
}
