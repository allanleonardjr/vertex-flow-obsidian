/**
 * Rendering and editing task prose through Obsidian's own Markdown pipeline.
 *
 * Descriptions and comments are plain Markdown (§3's whole premise — these are
 * real notes, not database rows), so `[[wikilinks]]`, `![[embeds]]`, tags, and
 * checkboxes inside them should behave exactly like they do everywhere else in
 * the vault.
 */

import { Component, MarkdownRenderer } from "obsidian";
import { useEffect, useRef, useState } from "react";
import { usePlugin } from "../context";
import { createEmbeddedEditor, type EmbeddedEditorHandle } from "./embedded-editor";
import { useLinkAutocomplete } from "./useLinkAutocomplete";

/**
 * Rendered, read-only Markdown. `sourcePath` should be the task note's own
 * vault path — it's what lets a relative link or an embed resolve the way it
 * would if you'd written it directly in that note.
 */
export function MarkdownContent({
	text,
	sourcePath,
	className,
}: {
	text: string;
	sourcePath: string;
	className?: string;
}) {
	const plugin = usePlugin();
	const containerRef = useRef<HTMLDivElement | null>(null);

	// `MarkdownRenderer.render` takes a `Component` to own the lifecycle of
	// anything it attaches — hover-preview listeners, embedded-note views. That
	// has to be unloaded on unmount, or those linger after the editor closes.
	const componentRef = useRef<Component | null>(null);
	useEffect(() => {
		const component = new Component();
		component.load();
		componentRef.current = component;
		return () => {
			component.unload();
			componentRef.current = null;
		};
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		const component = componentRef.current;
		if (!el || !component) return;

		el.empty();
		void MarkdownRenderer.render(plugin.app, text, el, sourcePath, component);
	}, [plugin, text, sourcePath]);

	return <div className={className} ref={containerRef} />;
}

/**
 * An editable Markdown field.
 *
 * Prefers a real embedded Obsidian editor — one inline surface with genuine
 * Live Preview and Obsidian's own `[[` suggester, indistinguishable from
 * editing a note. That path uses internal API, so it can become unavailable;
 * see `embedded-editor.ts`. When it does, this falls back to a plain textarea
 * with a rendered preview beneath it and this plugin's own link autocomplete —
 * less seamless, but fully functional and never broken.
 *
 * `forceRawSource` opts out of that entirely: the person asked for raw Source
 * text rather than Live Preview (the same distinction Obsidian itself draws),
 * so the fallback textarea is reused undecorated — no rendered preview, no
 * native editor mounted at all.
 *
 * Fully controlled either way: reports every keystroke via `onChange` and
 * holds no save logic of its own, so callers compose their own persistence
 * (`useDebouncedSave` for the description, plain local state for a comment
 * draft that has nowhere to save until it's posted).
 */
export function MarkdownField({
	value,
	onChange,
	sourcePath,
	placeholder,
	className,
	forceRawSource = false,
}: {
	value: string;
	onChange: (value: string) => void;
	sourcePath: string;
	placeholder?: string;
	className?: string;
	/** Show the plain textarea instead of Live Preview (§ Description toggle). */
	forceRawSource?: boolean;
}) {
	const plugin = usePlugin();
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const [mode, setMode] = useState<"probing" | "native" | "fallback">("probing");
	const handleRef = useRef<EmbeddedEditorHandle | null>(null);

	// Latest-value refs so the editor is built exactly once, not rebuilt on
	// every keystroke as `value`/`onChange` identities change. `seedValueRef`
	// tracks the latest value rather than the first one: the native editor is
	// created more than once over a field's life now (raw Source tears it down
	// and switching back builds a fresh one), and seeding it from the original
	// mount's text would silently discard everything typed while in Source.
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const seedValueRef = useRef(value);
	seedValueRef.current = value;
	const sourcePathRef = useRef(sourcePath);
	sourcePathRef.current = sourcePath;

	useEffect(() => {
		// The host div isn't rendered in raw-source mode, so `host` is already
		// null here — the second check is a belt-and-braces guard in case a
		// future render path keeps the element around.
		if (!host || forceRawSource) return;

		const handle = createEmbeddedEditor(plugin.app, host, {
			value: seedValueRef.current,
			onChange: (next) => onChangeRef.current(next),
			sourcePath: sourcePathRef.current,
		});

		handleRef.current = handle;
		setMode(handle ? "native" : "fallback");

		return () => {
			handle?.destroy();
			handleRef.current = null;
		};
	}, [host, plugin, forceRawSource]);

	// Reflect changes that came from outside this field — another device via
	// Sync, an edit to the raw note, a different task loaded into a reused
	// component. The equality check makes this a no-op for our own keystrokes,
	// which would otherwise fight the cursor on every character.
	useEffect(() => {
		const handle = handleRef.current;
		if (handle && handle.getValue() !== value) handle.setValue(value);
	}, [value]);

	// Raw Source drops the host element entirely rather than hiding it, which is
	// what tears the native editor down: React hands `setHost` a null on unmount,
	// and the effect's cleanup destroys the handle. Switching back remounts the
	// host and builds a fresh editor, exactly like the original mount.
	return (
		<div className={`vf-markdown-field${className ? ` ${className}` : ""}`}>
			{!forceRawSource && mode !== "fallback" && (
				<div className="vf-markdown-native" ref={setHost}>
					{mode === "native" && !value.trim() && placeholder && (
						<div className="vf-markdown-placeholder">{placeholder}</div>
					)}
				</div>
			)}

			{(forceRawSource || mode === "fallback") && (
				<FallbackEditor
					value={value}
					onChange={onChange}
					sourcePath={sourcePath}
					placeholder={placeholder}
					showPreview={!forceRawSource}
				/>
			)}
		</div>
	);
}

/** How long to wait after the last keystroke before re-rendering the preview. */
const PREVIEW_DEBOUNCE_MS = 150;

function useDebouncedValue<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

/**
 * The no-native-editor path: a textarea, this plugin's own `[[` autocomplete,
 * and a rendered preview underneath. `showPreview={false}` drops the preview,
 * which is what makes this double as the deliberate raw-Source surface.
 */
function FallbackEditor({
	value,
	onChange,
	sourcePath,
	placeholder,
	showPreview = true,
}: {
	value: string;
	onChange: (value: string) => void;
	sourcePath: string;
	placeholder?: string;
	/** Off when this is standing in for raw Source mode rather than falling back. */
	showPreview?: boolean;
}) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const autocomplete = useLinkAutocomplete(value, onChange);
	const previewText = useDebouncedValue(value, PREVIEW_DEBOUNCE_MS);

	// Grow with content — a Markdown box that scrolls internally while the page
	// around it doesn't is a worse writing surface.
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [value]);

	const syncCaret = () => {
		if (textareaRef.current) autocomplete.sync(textareaRef.current);
	};

	return (
		<>
			<textarea
				ref={textareaRef}
				className="vf-markdown-edit"
				value={value}
				placeholder={placeholder}
				onChange={(event) => {
					onChange(event.target.value);
					syncCaret();
				}}
				onKeyDown={autocomplete.onKeyDown}
				onKeyUp={syncCaret}
				onClick={syncCaret}
				onBlur={autocomplete.close}
			/>
			{autocomplete.node}

			{showPreview && previewText.trim() && (
				<MarkdownContent
					className="vf-markdown-preview"
					text={previewText}
					sourcePath={sourcePath}
				/>
			)}
		</>
	);
}
