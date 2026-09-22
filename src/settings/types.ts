/**
 * Plugin-level settings (`data.json`).
 *
 * Deliberately tiny. Anything that describes *the work* — taxonomies, views,
 * hierarchy — lives in the vault as Markdown, not here. This file only
 * holds per-install UI state that would be meaningless to sync or diff.
 */

import { DEFAULT_AI_MODEL_ID } from "../ai/AiEngineService";
import {
  DEFAULT_LOCAL_SERVER_BASE_URL,
  type AiProvider,
} from "../core/ai/local-server";

/**
 * Interface text density. `compact` is the built-in baseline;
 * the larger tiers scale the plugin's `--font-ui-*` tokens up by a fixed
 * factor (see `--vf-text-scale` in `styles.css`).
 */
export type UiTextSize = "compact" | "cozy" | "comfortable";

export interface VertexFlowSettings {
  /** Interface text size — scales the whole plugin UI, not per-workspace. */
  uiTextSize: UiTextSize;
  /** Where new workspaces are offered by default. */
  defaultWorkspaceFolder: string;
  /** Width, in pixels, of the property rail in the Task editor. */
  taskEditorRailWidth: number;
  /** Width, in pixels, of the property rail in the Project editor. */
  projectEditorRailWidth: number;
  /** Whether the Task editor's property rail is collapsed to a sliver. */
  taskEditorRailCollapsed: boolean;
  /** Whether the Project editor's property rail is collapsed to a sliver. */
  projectEditorRailCollapsed: boolean;
  // sidebarCollapsed, sidebarWidth, sidebarMinimized REMOVED — see
  // SidebarChromeState / SidebarChromeProvider in ui/context.tsx. This was
  // the source of the cross-pane (and cross-machine, via synced data.json)
  // sidebar-state bleed; it's runtime-only and per-pane now.
  /**
   * Whether the text query row under the view bar is expanded. Plugin-global
   * rather than per-view: someone who works this way wants it everywhere.
   */
  queryBarOpen: boolean;
  /**
   * Whether the view bar's secondary controls (Group, Sort, Sub-tasks,
   * Fields, filters, the query editor, etc.) are collapsed behind a "View
   * options" toggle. Mobile-only — desktop always shows everything.
   */
  viewOptionsCollapsed: boolean;
  /** Whether the raw-source section at the bottom of the Task editor is open. */
  taskEditorSourceOpen: boolean;
  /** Whether the raw-source section at the bottom of the Project editor is open. */
  projectEditorSourceOpen: boolean;
  /** Whether the Task editor's collapsible description section is closed. */
  taskDescriptionCollapsed: boolean;
  /** Whether the Project editor's collapsible description section is closed. */
  projectDescriptionCollapsed: boolean;
  /** Whether a Saved View's collapsible description section is closed. */
  viewDescriptionCollapsed: boolean;
  /** Whether a Label editor's collapsible description section is closed. */
  labelDescriptionCollapsed: boolean;
  /** Whether the Task editor's Description field shows raw Source instead of Live Preview. */
  taskDescriptionSourceMode: boolean;
  /** Whether the Project editor's Description field shows raw Source instead of Live Preview. */
  projectDescriptionSourceMode: boolean;
  /** Whether a Saved View's Description field shows raw Source instead of Live Preview. */
  viewDescriptionSourceMode: boolean;
  /** Whether a Label editor's Description field shows raw Source instead of Live Preview. */
  labelDescriptionSourceMode: boolean;
  /**
   * Whether the description field inside lightweight creation dialogs (Label,
   * generic named+icon) shows raw Source instead of Live Preview. Kept
   * separate from the per-editor description settings above — these dialogs
   * aren't one of the Task/Project/View/Label editor kinds, and this flag is
   * plugin-global the same way `queryBarOpen` is: a way of working, not a
   * property of whatever's being created.
   */
  dialogDescriptionSourceMode: boolean;
  /** Whether comment fields (composer + edit-in-place) show raw Source instead of Live Preview. */
  commentSourceMode: boolean;
  /** Collapsed state of the other task-editor sections, keyed by section id. */
  editorSectionsCollapsed: Record<string, boolean>;
  /** Height, in pixels, of the Project editor's info pane above its task list. */
  projectInfoHeight: number;
  /** Height, in pixels, of the Task editor's description pane above Sub-tasks. */
  taskDescriptionHeight: number;
  /** Height, in pixels, of a Saved View's description pane above its Board/List. */
  viewDescriptionHeight: number;
  /** Timeline view: width of the sticky task-label column left of the chart. */
  timelineLeftWidth: number;
  /** Timeline view: that label column collapsed to a sliver. */
  timelineLeftCollapsed: boolean;
  /** Timeline view: height of the Unscheduled pane below the chart. */
  timelineLowerHeight: number;
  /** Timeline view: that Unscheduled pane collapsed to its header. */
  timelineLowerCollapsed: boolean;
  /** Calendar view: the Unscheduled drawer collapsed to its header. */
  calendarUnscheduledCollapsed: boolean;
  /** Calendar view: height of the Unscheduled drawer below the month grid. */
  calendarUnscheduledHeight: number;
  /** Size of the Parent / relation task-picker popover, drag-resizable. */
  taskPickerWidth: number;
  taskPickerHeight: number;
  /** Width, in pixels, of the topic tree in the Help pane (drag-resizable). */
  helpSidebarWidth: number;
  /**
   * Whether opening a task note anywhere in Obsidian (search, a wikilink,
   * the quick switcher) redirects into Vertex Flow's editor instead of the
   * plain Markdown view. Plugin-global rather than per-workspace — this
   * governs Obsidian navigation behaviour, not anything about a workspace's
   * data, so it lives here rather than in `_workspace.md`.
   */
  redirectTaskNotes: boolean;
  /**
   * Whether the local Model Context Protocol server is running. An opt-in
   * bridge for local AI clients (LM Studio / LM Link) to read the vault over
   * `http://127.0.0.1:<mcpServerPort>/mcp`. Desktop-only (Obsidian Mobile has
   * no second process to talk to), read-only, and the shared-secret bearer
   * token never lives in synced `data.json` — see `src/obsidian/mcp-token.ts`.
   */
  mcpServerEnabled: boolean;
  /** TCP port the MCP server binds. Only `127.0.0.1` is ever bound. */
  mcpServerPort: number;
  /**
   * Which AI Chat model is active — a device/install setting like the rest of
   * this file, not workspace data, since exactly one model is ever loaded in
   * the worker regardless of which workspace is open. Several other models
   * may still be cached in IndexedDB without being this one (see
   * `AiEngineService`); switching this resets the AI Chat session's message
   * history (`AiChatSessionProvider`), since a fresh model has no memory of
   * the old one's conversation anyway.
   */
  selectedAiModelId: string;
  /**
   * Whether AI Chat is allowed to load a model into memory at all. Off
   * releases the currently loaded model immediately (see
   * `AiEngineService.unloadFromMemory`) without touching its cached
   * download, and gates the AI Chat tab to a disabled empty state instead of
   * its normal install/chat flow. Defaults to `true` so existing users see
   * no behavior change on upgrade.
   */
  aiChatEnabled: boolean;
  /**
   * Which engine answers in AI Chat: `"builtin"` — the in-browser WebLLM
   * models above — or `"local-server"`, an OpenAI-compatible server the user
   * runs themselves (LM Studio, Ollama, …) that calls the MCP tool set
   * natively. Local server is desktop-only: on mobile the effective provider
   * is always builtin (`effectiveAiProvider`), and this stored value is left
   * alone rather than rewritten, since it syncs to the desktop too.
   */
  aiProvider: AiProvider;
  /**
   * The local model server's OpenAI-compatible base URL, usually ending in
   * `/v1`. Only the URL is stored — the preset shown in Settings is derived
   * from it (`presetForUrl`). Its optional API key is a secret, so it lives
   * in `localStorage` instead (see `src/obsidian/local-server-key.ts`).
   */
  localServerBaseUrl: string;
  /**
   * The local server model AI Chat talks to, as listed by `GET /models`.
   * Empty (or no longer listed) means "the first model the server lists" —
   * see `pickModelId`.
   */
  localServerModelId: string;
  /**
   * One-time UI discovery badges the user has already dismissed by
   * visiting the feature, keyed by a stable feature id (e.g.
   * "layout-table"). Absent or false = show the badge; true = seen,
   * never show again. New badges are added by picking a new key here,
   * not by adding a new settings field.
   */
  seenFeatures: Record<string, boolean>;
  // "Who me is" is deliberately NOT here. It's per-device and per-workspace,
  // held in the app's own localStorage (never the vault) — see
  // `src/obsidian/me-storage.ts`. A single global value in this synced file
  // was a cross-collaborator correctness bug.
}

/**
 * Sidebar chrome (minimize, width, per-section collapse) for one pane.
 * Deliberately not part of VertexFlowSettings — see SidebarChromeProvider.
 */
export interface SidebarChromeState {
  minimized: boolean;
  width: number;
  collapsed: Record<string, boolean>;
}

export const DEFAULT_SIDEBAR_CHROME: SidebarChromeState = {
  minimized: false,
  width: 220,
  collapsed: {},
};

export const DEFAULT_SETTINGS: VertexFlowSettings = {
  uiTextSize: "compact",
  defaultWorkspaceFolder: "Vertex Flow",
  taskEditorRailWidth: 264,
  projectEditorRailWidth: 264,
  taskEditorRailCollapsed: false,
  projectEditorRailCollapsed: false,
  // sidebarCollapsed / sidebarWidth / sidebarMinimized REMOVED
  queryBarOpen: false,
  viewOptionsCollapsed: true,
  taskEditorSourceOpen: false,
  projectEditorSourceOpen: false,
  taskDescriptionCollapsed: false,
  projectDescriptionCollapsed: false,
  viewDescriptionCollapsed: false,
  labelDescriptionCollapsed: false,
  taskDescriptionSourceMode: false,
  projectDescriptionSourceMode: false,
  viewDescriptionSourceMode: false,
  labelDescriptionSourceMode: false,
  dialogDescriptionSourceMode: false,
  commentSourceMode: false,
  editorSectionsCollapsed: {},
  projectInfoHeight: 220,
  taskDescriptionHeight: 220,
  viewDescriptionHeight: 220,
  timelineLeftWidth: 300,
  timelineLeftCollapsed: false,
  timelineLowerHeight: 200,
  timelineLowerCollapsed: false,
  calendarUnscheduledCollapsed: false,
  calendarUnscheduledHeight: 200,
  taskPickerWidth: 380,
  taskPickerHeight: 360,
  helpSidebarWidth: 240,
  redirectTaskNotes: true,
  mcpServerEnabled: false,
  mcpServerPort: 27124,
  selectedAiModelId: DEFAULT_AI_MODEL_ID,
  aiChatEnabled: true,
  aiProvider: "builtin",
  localServerBaseUrl: DEFAULT_LOCAL_SERVER_BASE_URL,
  localServerModelId: "",
  seenFeatures: {},
};
