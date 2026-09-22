---
title: AI integration (MCP)
icon: bot
order: 55
---

Vertex Flow can expose its data to **local, offline AI clients** (like LM
Studio) through the **Model Context Protocol** (MCP) — the same protocol
Claude Desktop and other AI tools speak. The server runs on your own machine,
keeps the vault inside your vault, and is **read-only**.

## How it works

When enabled, Vertex Flow starts a small HTTP server bound to `127.0.0.1` — a
loopback address that only your own machine can reach. It answers 27
read-only JSON tools that let an LLM:

- **List workspaces, projects, tasks, views, dashboards, labels, and people** —
  with the same filters, query language, and field visibility your own views
  use.
- **Read a single task, project, view, or dashboard in full** — comments and
  @mentions included.
- **Run a saved view as the plugin renders it** (`run_view`) and **read a
  dashboard's computed chart data** (`read_dashboard`) — so "what does the
  Board show?" and "what does the pie chart say?" get the same numbers the UI
  shows, not a guess.
- **Count and summarise** (`count_tasks`, `count_projects`, `get_summary`,
  `get_stats`) — exact, uncapped answers to "how many…", "what's overdue?" and
  "who commented most?".
- **List recurring-task series** (`list_recurring`) with their next occurrence
  dates — and honour the `show:recurring` preview in a `list_tasks` query.
- **Find** (`find`) tasks, projects, views and people by title, id or
  description, and **search task descriptions** (`search_descriptions`) by text
  or regex.
- **Search your notes** with the same query syntax you type in the view bar
  (`status:todo priority:high`, `due:today`, `assignee:me`, …).
- **Read the built-in Help docs** — so the model can answer questions about
  your workspace accurately instead of guessing, and point at the exact doc
  section that explains a concept.

Every result that points at a note or view carries a deep link
(`obsidian://vertex-flow…`) the client can hand back to Obsidian to open the
exact task, view, dashboard, or Help topic.

### Which workspace a tool talks to

If your vault has more than one workspace, every tool takes an optional
`workspace` — but you'll rarely need to pass it. Left out, a tool defaults
to **whatever workspace is currently open in the Vertex Flow window**, so
asking a question without saying which workspace you mean just works.

To point the model at a *different* workspace for the rest of the
conversation — without switching anything in the Obsidian window itself —
ask it to use `set_active_workspace` with the workspace's name, or part of
it (e.g. *"switch to the Lumen Studio workspace"*). That choice sticks for
every tool call that omits `workspace` until you change it again or this
client's session ends. (Each connected client keeps its own default —
switching workspace for one doesn't affect another.) If a name matches more
than one workspace, the model is told so and asked to be more specific
rather than guessing.

## Enable the server

1. Open **Obsidian Settings → Vertex Flow**.
2. Turn on **Enable MCP server**.
3. Note the **port** (default `27124`) and the **token** — both are shown on
   the same row. The token is generated the first time the server starts; use
   **Regenerate** on the token row to mint a new one at any time.

The server is off by default and stores nothing but its own token in this
device's local storage — it never writes to your vault, never touches synced
settings, and never phones home.

> The server is **desktop-only**: the toggle is hidden on Obsidian Mobile,
> where a listening socket isn't available.

## Connect LM Studio

In the LM Studio settings (or the AI client of your choice that supports MCP
servers over HTTP), add a server with:

- **URL:** `http://127.0.0.1:27124/mcp`
- **Header:** `Authorization: Bearer <the token from Settings>`

In an MCP config file this looks like:

```json
{
  "mcpServers": {
    "vertex-flow": {
      "type": "http",
      "url": "http://127.0.0.1:27124/mcp",
      "headers": {
        "Authorization": "Bearer <your-token-here>"
      }
    }
  }
}
```

The client then grants the model `count_*`, `get_*`, `list_*`, `read_*`,
`run_view`, and `search_help_docs` tools. Ask it something like *"what's the
oldest open task in my inbox?"*, *"how many tasks are overdue?"*, or
*"summarise everything due this week"*.

### Multiple clients at once

More than one AI client can talk to the server at the same time — e.g. LM
Studio and an MCP Inspector session together — and each holds its own
session. The MCP server section in **Workspace Settings** (and the native
**Settings → Vertex Flow** panel) shows a **Connected clients** table with
every client's name, version, connect time, and session id. Use a row's
**Disconnect** button to end one client's session immediately; the client's
next request is rejected and it must reconnect (a fresh session starts
cleanly). Restarting the server or reloading Obsidian ends them all.

## Check it's running

With the server enabled, open `http://127.0.0.1:27124/health` in a browser —
you should see a small status page. Connection issues almost always come from
a wrong port or a missing/incorrect token header.

## Security notes

- The server only listens on `127.0.0.1`, so nothing outside your machine can
  reach it.
- Every request must carry the token from Settings; a wrong or missing token
  is rejected with `401`.
- The tools are **read-only** — nothing here can create, edit, or delete a
  note. Changes still happen from within Vertex Flow itself.
- One token is shared by every client you connect; regenerate it from
  Settings to revoke them all at once.
- Turn the toggle off when you don't need it — the server stops immediately.