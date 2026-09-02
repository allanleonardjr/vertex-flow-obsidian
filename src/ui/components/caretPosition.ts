/**
 * Pixel coordinates of the caret inside a plain `<textarea>`.
 *
 * There's no native API for this — the standard workaround (used by every
 * editor that pops a suggestion list over a textarea) is to build an invisible
 * "mirror" element with identical font metrics and wrapping, fill it with the
 * text up to the caret, and read the position of a marker span at that point.
 * Reimplemented here rather than pulled in as a dependency: it's ~50 lines,
 * stable, and not worth a package for.
 */

const MIRRORED_PROPERTIES: (keyof CSSStyleDeclaration)[] = [
	"boxSizing",
	"width",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"borderStyle",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"fontStyle",
	"fontVariant",
	"fontWeight",
	"fontStretch",
	"fontSize",
	"lineHeight",
	"fontFamily",
	"textAlign",
	"textTransform",
	"textIndent",
	"textDecoration",
	"letterSpacing",
	"wordSpacing",
	"tabSize",
	"whiteSpace",
	"wordWrap",
];

export interface CaretCoordinates {
	/** Relative to the textarea's own border box — add its `getBoundingClientRect()` to place in the viewport. */
	top: number;
	left: number;
	height: number;
}

export function getCaretCoordinates(
	el: HTMLTextAreaElement,
	position: number,
): CaretCoordinates {
	const div = document.createElement("div");
	div.id = "vf-caret-mirror";
	document.body.appendChild(div);

	const style = div.style;
	const computed = window.getComputedStyle(el);

	style.position = "absolute";
	style.visibility = "hidden";
	style.whiteSpace = "pre-wrap";
	style.overflowWrap = "break-word";
	style.width = computed.width;

	for (const prop of MIRRORED_PROPERTIES) {
		const value = computed[prop];
		if (typeof value === "string") {
			// CSSStyleDeclaration's index signature is looser than what TS lets us
			// assign through `style[prop]` directly for every key; a cast here is
			// simpler and just as safe than a giant per-property switch.
			(style as unknown as Record<string, string>)[prop as string] = value;
		}
	}

	div.textContent = el.value.slice(0, position);

	const span = createEl("span");
	// A trailing marker character ensures the span has real dimensions even
	// when the caret sits at the very end of the text.
	span.textContent = el.value.slice(position) || ".";
	div.appendChild(span);

	const coordinates: CaretCoordinates = {
		top:
			span.offsetTop +
			Number.parseInt(computed.borderTopWidth || "0", 10) -
			el.scrollTop,
		left:
			span.offsetLeft +
			Number.parseInt(computed.borderLeftWidth || "0", 10) -
			el.scrollLeft,
		height: Number.parseInt(computed.lineHeight || "16", 10) || 16,
	};

	document.body.removeChild(div);
	return coordinates;
}
