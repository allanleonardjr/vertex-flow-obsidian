/**
 * Deep-link URIs for the MCP layer.
 *
 * The MCP tools are read-only, so "here's a thing, go look at it" is expressed
 * as a custom-protocol URI (`obsidian://vertex-flow?…`) the plugin itself hooks
 * with `registerObsidianProtocolHandler`. Building and parsing both live here
 * in core — one grammer, round-tripped by the unit tests — so the tool layer
 * and the protocol handler can never drift apart.
 *
 * Grammar (each URI carries exactly one action):
 *
 *   open-note=<encoded path>      Open a note in Vertex Flow's editor
 *       &target=vf|native           (`vf` = the Task editor tab; `native` =
 *                                   Obsidian's plain markdown leaf — the one
 *                                   exception, useful for non-task notes)
 *   open-view=<encoded viewId>    Open a Saved View tab in the plugin UI
 *       &root=<encoded root>        System Views need the owning workspace root;
 *                                   a user view resolves its owner via the index
 *                                   and ignores `root`.
 *   help=<encoded topicId>        Land the Help pane on a specific topic.
 *       &anchor=<encoded slug>      Optional heading slug (see `slugifyHeading`).
 *   query=<encoded source>        Open an ephemeral, never-persisted view built
 *       &root=<encoded root>        from query-language text, bound to `root`
 *                                   (default: the pane's active workspace).
 *
 * All values are URLSearchParams-encoded, so paths with slashes/spaces are fine.
 */

export const MCP_URI_SCHEME = "obsidian://vertex-flow";

export type VaultUriIntent =
	| { action: "open-note"; path: string; target: "vf" | "native" }
	| { action: "open-view"; viewId: string; root?: string }
	| { action: "help"; topicId: string; anchor?: string }
	| { action: "query"; source: string; root?: string };

/** Render an intent as a `obsidian://vertex-flow…` URI. */
export function buildVaultUri(intent: VaultUriIntent): string {
	const params = new URLSearchParams();
	switch (intent.action) {
		case "open-note":
			params.set("open-note", intent.path);
			params.set("target", intent.target);
			break;
		case "open-view":
			params.set("open-view", intent.viewId);
			if (intent.root) params.set("root", intent.root);
			break;
		case "help":
			params.set("help", intent.topicId);
			if (intent.anchor) params.set("anchor", intent.anchor);
			break;
		case "query":
			params.set("query", intent.source);
			if (intent.root) params.set("root", intent.root);
			break;
	}
	return `${MCP_URI_SCHEME}?${params.toString()}`;
}

/**
 * Decode what an Obsidian protocol handler hands us (`ObsidianProtocolData` —
 * a flat string map) into an intent. `null` for anything that names no action.
 */
export function intentFromParams(
	params: Record<string, string | null | undefined>,
): VaultUriIntent | null {
	if (typeof params["open-note"] === "string" && params["open-note"] !== "") {
		return {
			action: "open-note",
			path: params["open-note"],
			target: params["target"] === "native" ? "native" : "vf",
		};
	}
	if (typeof params["open-view"] === "string" && params["open-view"] !== "") {
		return {
			action: "open-view",
			viewId: params["open-view"],
			root: params["root"] || undefined,
		};
	}
	if (typeof params["help"] === "string" && params["help"] !== "") {
		return {
			action: "help",
			topicId: params["help"],
			anchor: params["anchor"] || undefined,
		};
	}
	if (typeof params["query"] === "string") {
		return {
			action: "query",
			source: params["query"],
			root: params["root"] || undefined,
		};
	}
	return null;
}

/** Parse a full `obsidian://vertex-flow…` URI back into an intent. */
export function parseVaultUri(uri: string): VaultUriIntent | null {
	if (!uri.startsWith(MCP_URI_SCHEME)) return null;
	const query = uri.slice(MCP_URI_SCHEME.length);
	const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
	const map: Record<string, string | null> = {};
	for (const [key, value] of params.entries()) map[key] = value;
	for (const key of params.keys()) if (!(key in map)) map[key] = null;
	return intentFromParams(map);
}