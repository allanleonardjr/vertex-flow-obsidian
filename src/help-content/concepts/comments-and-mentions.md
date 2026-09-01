---
title: Comments, mentions & People
order: 60
---

## Comments

Any task can carry a thread of comments, each with an author, a date, reactions,
and a delete action. Comments render as Markdown, so `[[wikilinks]]`, embeds,
and formatting all work in them. Comments are stored with the task's note, like
everything else.

## @mentions

Typing `@` in a comment (or a description) and picking a name from the People
register tags that person. Mentions drive two useful Saved Views out of the box
— "Assigned to me" and "Mentions me" — which are just Saved Views using a
`self` filter.

## The People register

A workspace keeps a **People register**: a list of names and aliases, where you
can mark one as **you** (the `isSelf` flag). That flag is what makes the `me` /
`self` keyword in filters resolve to a real person, so filters like
`assignee:me` just work.

Deleting a person opens a **reassign or clear** dialog — you can move their
tasks to someone else, or strip the assignment — mirroring the deletion guard
used across the taxonomy engine.
