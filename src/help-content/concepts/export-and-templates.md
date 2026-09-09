---
title: Export & workspace templates
order: 85
---

Everything in Vertex Flow lives as plain Markdown in your vault — but when you
need your data somewhere else, or want to reuse a workspace's setup as the
start of a new one, there are two export paths: exporting **tasks** to a file,
and exporting the **workspace itself as a template**.

## Exporting tasks

Export writes a real vault file containing the tasks in the scope you pick, in
the format you choose:

- **CSV**, **JSON**, or **iCalendar (.ics)** — pick a scope, choose which fields
  to include, and decide whether archived tasks come along. For iCalendar
  specifically, only a **Description** toggle is offered; identity, status,
  dates, and sync metadata (`CREATED`, `LAST-MODIFIED`, `SEQUENCE`) are always
  emitted, so re-importing a calendar never churns its change history.
- **Scope** — the current view, a saved view, a project, or the whole
  workspace.
- **Where it lands** — `<workspace>/Exports/`, named
  `vertex-flow-export-<workspace>-<scope>-<date>.<ext>`.

You can start an export from the sidebar's **Export…** row, the **Export…**
command in the Command Palette, a button on the view toolbar (locked to that
view), or the right-click menus on **Workspaces**, **Views** and **Projects** —
each opens the dialog already scoped to what you clicked.

When an export finishes, the dialog shows the resulting file's path with
**Reveal in Finder / File Manager** and **Open in Obsidian** actions. Obsidian's
own File Explorer hides `.csv` / `.json` / `.ics` files unless you enable
**Settings → Files and links → Show all file types** — the Reveal/Open actions
work regardless.

## Export a workspace as a template

**"Export Workspace as Template…"** (available from the same Export dialog and
the sidebar) captures a workspace's *configuration* as a portable Markdown
template file: statuses, priorities, task types, labels, the people roster,
saved views, and dashboards. **Tasks and projects never come along** — the file
is a starting point, not a backup.

You give the template a **name**, **icon**, and **description**, and pick a
destination folder — type a folder name or browse for one, with vault-root
`Templates/` as the default. Exported files carry a `vertex-flow-template-`
filename prefix so they stay recognizable once they're moved or synced
elsewhere.

## Create a workspace from your template

The **New Workspace** gallery discovers Markdown templates in your vault's
`Templates/` folder and shows them beside the bundled ones in a **From your
Vault** section — each card marked with a "Your template" pill, **Views** and
**Dashboards** rows in its settings preview (named pills, each with the icon
the view or dashboard will show, for what the template will create), an
on-disk **"Located: `Templates/<file>.md`"** line, and a **Created:**
timestamp when the template carries one. Saving a template
somewhere outside `Templates/` still works, but the dialog warns it won't
appear in the gallery.

Picking one of your templates creates a fresh workspace that starts with the
exported taxonomy, views, dashboards, and people — a new workspace that already
feels like the one you exported.