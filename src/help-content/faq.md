---
title: FAQ
icon: circle-help
order: 50
---

**Where is my data stored?**
As plain Markdown notes in your vault, in flat, type-based folders. Nothing
lives outside the vault.

**Can I edit a Task note directly?**
Yes — frontmatter and body are real Markdown. Vertex Flow's editor is a
convenience layer on top, not the source of truth.

**Can I re-parent a Task without moving files?**
Yes. Hierarchy lives in frontmatter links, so changing a Task's Project or
parent is a one-field edit — the file never moves folders.

**How do I delete something? Is it permanent?**
Deleting is non-destructive by default. Items go to Vertex Flow's **Trash** —
a reversible soft-delete — where you can Restore them or Delete Forever.
See the **Trash, deletion & archiving** topic in Concepts.

**What's the difference between archiving and deleting?**
Archiving hides finished work from your views but keeps the note fully intact;
deleting sends it to the Trash. They never cascade or destroy data.

**Does it work on mobile?**
Yes. List, Board, Calendar, and Timeline all support full drag-and-drop with
touch.

**Will it slow down with a large vault?**
The index reads from Obsidian's metadata cache instead of doing slow disk
scans, so views paint immediately and edits sync automatically — even with a
lot of notes.

**What happens if I edit a Task's note by hand?**
Views stay in sync. Frontmatter fields are the source of truth, so a direct
edit to a note updates the view the next time it reads it. You can open the raw
note from the editor at any time with `o` or the ↗ button.

**Can I keep multiple separate workspaces in one vault?**
Yes. Each workspace is independent with its own statuses, priorities, types,
labels, people, and projects. Switch between them from the sidebar, and open
several side by side.

**How do Status, Priority, Type, and Labels relate?**
They're one taxonomy engine configured four ways, with the same lists,
pickers, filtering, grouping, and the same deletion guard.
See the **Status, Priority, Type & Labels** topic in Concepts.

**Can I have one task in multiple projects?**
A task has exactly one primary parent. For cross-cutting association with other
projects, use Labels or relations — never a second parent.

**Is my data safe to back up or version control?**
Everything is plain Markdown in your vault, so it syncs, backs up, and
version-controls with whatever tools you already use for your notes.
