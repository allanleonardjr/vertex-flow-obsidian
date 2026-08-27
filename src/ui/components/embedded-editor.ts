/**
 * A real Obsidian Markdown editor, embedded in the task panel.
 *
 * This is what makes the description behave like a native note — one surface
 * where `[[links]]` render as you type, with Obsidian's own `[[` suggester,
 * its own hotkeys, and its own Live Preview — rather than a textarea with a
 * separate rendered pane underneath it.
 *
 * ## The catch, stated plainly
 *
 * Obsidian exposes no public API for embedding an editor. `MarkdownRenderer`
 * renders read-only HTML; `MarkdownEditView` is in the typings but has no
 * constructible public path. The technique here — reaching the editor class
 * through `app.embedRegistry`, which is **undocumented internal API** — is the
 * one the wider plugin community uses for this, but it is not covered by
 * Obsidian's compatibility guarantees and *can* break in a future release.
 *
 * That risk is contained deliberately:
 *
 *   - Every internal access is wrapped, and any failure resolves to `null`.
 *   - `MarkdownField` treats `null` as "use the plain textarea instead", so a
 *     future Obsidian that breaks this degrades to the previous behaviour
 *     (textarea + preview pane + this plugin's own link autocomplete) rather
 *     than to a broken editor or a crash.
 *   - The probe runs once and caches, so a broken build costs one failed
 *     attempt, not one per field.
 *
 * If this ever does break, deleting this file and the `native` branch in
 * `MarkdownField` is a complete, working rollback.
 */

import type { App } from "obsidian";

/** Internal Obsidian surfaces have no typings; confine the `any` to here. */
type Internal = Record<string, any>;

export interface EmbeddedEditorOptions {
	value: string;
	onChange: (value: string) => void;
	onBlur?: (value: string) => void;
}

export interface EmbeddedEditorHandle {
	getValue: () => string;
	setValue: (value: string) => void;
	focus: () => void;
	destroy: () => void;
}

let cachedConstructor: Internal | null = null;
let probeFailed = false;

/**
 * Find the editor constructor by building a throwaway Markdown embed and
 * walking up its prototype chain.
 *
 * `embedRegistry.embedByExtension.md` builds an embed whose `editMode` is an
 * instance of a subclass of Obsidian's internal `MarkdownEditor`; two
 * `getPrototypeOf` hops land on that base class. Depending on the build, that
 * lands on either the constructor itself or its prototype, so both are handled.
 */
function resolveEditorConstructor(app: App): Internal | null {
	if (cachedConstructor) return cachedConstructor;
	if (probeFailed) return null;

	try {
		const registry = (app as unknown as Internal).embedRegistry;
		const createEmbed = registry?.embedByExtension?.md;
		if (typeof createEmbed !== "function") throw new Error("no markdown embed factory");

		const probeEl = document.createElement("div");
		const probe: Internal = createEmbed({ app, containerEl: probeEl }, null, "");
		probe.editable = true;
		probe.showEditor?.();

		const editMode = probe.editMode;
		if (!editMode) throw new Error("embed exposed no editMode");

		const base = Object.getPrototypeOf(Object.getPrototypeOf(editMode));
		const ctor = typeof base === "function" ? base : base?.constructor;

		probe.unload?.();
		probeEl.remove();

		if (typeof ctor !== "function") throw new Error("could not resolve editor constructor");

		cachedConstructor = ctor;
		return ctor;
	} catch (cause) {
		probeFailed = true;
		console.warn(
			"[Vertex Flow] Obsidian's embedded Markdown editor is unavailable; " +
				"falling back to a plain text editor with a preview pane.",
			cause,
		);
		return null;
	}
}

export function isNativeEditorAvailable(app: App): boolean {
	return resolveEditorConstructor(app) != null;
}

function readValue(editor: Internal): string {
	try {
		if (typeof editor.get === "function") return editor.get() ?? "";
	} catch {
		// fall through to reading CodeMirror's document directly
	}
	const doc = (editor.editor?.cm ?? editor.cm)?.state?.doc;
	return typeof doc?.toString === "function" ? doc.toString() : "";
}

export function createEmbeddedEditor(
	app: App,
	container: HTMLElement,
	options: EmbeddedEditorOptions,
): EmbeddedEditorHandle | null {
	const Editor = resolveEditorConstructor(app);
	if (!Editor) return null;

	try {
		// The owner object the internal editor expects — it calls these back
		// during scrolling and mode checks.
		const owner: Internal = {
			app,
			getMode: () => "source",
			onMarkdownScroll: () => {},
			showSearch: () => {},
		};

		const editor: Internal = new (Editor as new (...args: unknown[]) => Internal)(
			app,
			container,
			owner,
		);

		editor.set?.(options.value ?? "", false);

		// Changes arrive through the base class's own update hook; wrap rather
		// than replace so whatever it does internally still happens.
		const inheritedOnUpdate = typeof editor.onUpdate === "function"
			? editor.onUpdate.bind(editor)
			: null;
		editor.onUpdate = (update: unknown, changed: boolean) => {
			inheritedOnUpdate?.(update, changed);
			if (changed) options.onChange(readValue(editor));
		};

		const contentEl: HTMLElement | undefined = (editor.editor?.cm ?? editor.cm)?.contentDOM;
		const handleBlur = () => options.onBlur?.(readValue(editor));
		contentEl?.addEventListener("blur", handleBlur);

		return {
			getValue: () => readValue(editor),
			setValue: (value) => editor.set?.(value, false),
			focus: () => {
				try {
					(editor.editor?.cm ?? editor.cm)?.focus?.();
				} catch {
					// A focus failure is cosmetic; never let it break a render.
				}
			},
			destroy: () => {
				contentEl?.removeEventListener("blur", handleBlur);
				try {
					editor.destroy?.();
					editor.unload?.();
				} catch (cause) {
					console.warn("[Vertex Flow] Embedded editor teardown failed.", cause);
				}
			},
		};
	} catch (cause) {
		// Construction can fail even when the probe succeeded (a changed
		// signature, say). Mark the whole path unavailable so every other
		// field falls back immediately instead of retrying and failing too.
		probeFailed = true;
		cachedConstructor = null;
		console.warn(
			"[Vertex Flow] Could not construct the embedded Markdown editor; " +
				"falling back to a plain text editor.",
			cause,
		);
		return null;
	}
}
