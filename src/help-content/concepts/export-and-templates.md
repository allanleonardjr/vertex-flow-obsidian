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
- **Scope** — the current view, a saved view, a project, a label, a person, or
  the whole workspace.
- **Where it lands** — `<workspace>/Exports/`, named
  `vertex-flow-export-<date>-<time>-<workspace>-<kind>-<name>.<ext>` (the
  date/time pair keeps every export's filename unique on its own).

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
the sidebar) captures a workspace's setup as a portable Markdown template file:
statuses, priorities, task types, labels, the people roster, saved views, and
dashboards — each one riding in the file's frontmatter, like your **Projects**,
with their title, icon, description, status, priority, owner, labels, and
dates. **Tasks stay behind by default** — the file is a starting point, not a
backup. Tick **"Include tasks in the template file"** and the export also
carries your tasks into the template's body with every field; recurrence is
written as a compact shorthand (`weekly`, `every 2 weeks`, `when completed`),
and rules it can't express are left out.

Your exported template never ships gated material unless you ask for it:

- **Descriptions travel with tasks by default; comments don't.** Untick
  **"Include descriptions"** to leave task bodies out, or tick
  **"Include comments"** if you want the discussion history to come along too
  — off by default since comments are more likely to hold something private.
- **Archived Projects and Tasks stay out** unless **"Include archived"** is
  ticked too — and when it is, archived Tasks and the archived Projects they
  link to travel together, so nothing dangles. Links to anything still excluded
  are dropped rather than left broken.
- Tasks made the template one that can also **seed new workspaces**: a template
  that carries tasks shows the gallery's **"Populate with example content"**
  toggle, just like the built-ins.

You give the template a **name**, **icon**, and **description**, and pick a
destination folder — type a folder name or browse for one, with vault-root
`Vertex Flow Templates/` as the default. Exported files share the same
`vertex-flow-export-<date>-<time>-<workspace>-template-<name>.md` naming as
Task exports, so they stay recognizable once they're moved or synced
elsewhere.

## Create a workspace from your template

The **New Workspace** gallery shows every starting point — your vault's exports
and the built-ins — on a card that previews what it will actually create: its
taxonomy (**Statuses**, **Priorities**, **Task Types**, **Labels**), then the
rest in the same order as the workspace sidebar — the **Default view**, its
**Views** and **Dashboards** as named pills (carrying the icon they'll show),
its **Projects**, and its **People**. Your own templates appear beside the
built-ins in a **From your Vault** section, each card marked with a "Your
template" pill, a **"Located: `Vertex Flow Templates/<file>.md`"** line (the
folder the file actually lives in), and a **Created:** timestamp when the file
carries one. The gallery looks in vault-root `Vertex Flow Templates/` — the
export default — and still honors the legacy `Templates/` folder, so templates
exported before the rename keep showing up. Saving a template anywhere else
still works, but the dialog warns it won't appear in the gallery.

What a card previews is what you get:

- **Views, dashboards, the people register, and Projects are structure.** A
  template always creates them, whether or not you tick **"Populate with
  example content"**.
- **Tasks are the only example material.** The toggle adds sample Tasks (and,
  for built-ins, the seeded history walk-through); untick it for the bare
  structure — Projects still come along. Built-in gallery templates start with
  it ticked; your own templates show it too, but only when the export actually
  carried tasks. A template exported from an empty workspace carries no
  Projects either, so its card simply shows no Projects row.

Picking one of your templates creates a fresh workspace that starts with the
exported taxonomy, views, dashboards, people, and projects — a new workspace
that already feels like the one you exported.