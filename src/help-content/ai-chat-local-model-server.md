---
title: AI Chat with a local model server
icon: bot
order: 56
---

AI Chat can answer through a **model server running on your own computer**,
like LM Studio, LM Studio Bionic, Ollama, Jan, or a llama.cpp server, instead
of the built-in in-browser models. Bigger local models, and models that
support tool calling, give noticeably better answers.

This option is available in Obsidian on **desktop** only.

## How it works

In this mode the model uses the same read-only tools as the
[MCP server](help://mcp-llm-integration): it can list and count tasks and
projects, run your saved views, read dashboards, look up people and labels,
and search these Help docs. The tools run **inside Vertex Flow itself**, not
over the network, and they work whether or not the MCP server setting is on.

Nothing leaves your machine except requests to the server URL you configure.
The tools are read-only, so the model can't change your tasks.

## Setting it up with LM Studio or Bionic

1. In LM Studio or Bionic, turn on **Local Model API → Local API server**.
2. Download or load a model. Models that support tool calling work best.
3. In Vertex Flow, open **Settings → AI Chat**, make sure **Enable AI Chat** is
   on, and choose **Local model server**.
4. Leave **Server** on **LM Studio / Bionic**. Its address is
   `http://localhost:1234/v1`.
5. Click **Test connection**. You should see "Connected" followed by the
   models the server lists.

The CORS setting in LM Studio doesn't matter for Vertex Flow. LM Studio's
headless `llmster` daemon works the same way as the app.

## Other servers

The **Server** menu fills in the usual address for each server:

- **Ollama**: `http://localhost:11434/v1`
- **Jan**: `http://localhost:1337/v1`
- **llama.cpp server**: `http://localhost:8080/v1`
- **Custom**: type any OpenAI-compatible address in **Base URL**. It usually
  ends in `/v1`.

If your server requires a key (for example llama.cpp started with
`--api-key`), enter it under **API key**. The key is stored on this device
only, never in your synced plugin settings.

## Choosing a model

The chat header has a **model** menu listing everything your server offers.
Use the refresh button next to it after loading a new model in your server
app. Your choice is remembered; if that model disappears from the server,
the chat uses the first model it lists.

Some servers load a model the first time it's asked for, so the first reply
after a while can take noticeably longer. That's normal.

## Reasoning

Next to the model menu is a **Reasoning** menu with five levels: **Default**,
**Off**, **Low**, **Medium**, and **High**. Low, Medium and High ask the model
to reason more before it answers; Off asks it to skip reasoning; Default
sends nothing and leaves it entirely to the server and model.

Your choice is saved **per model** - switching models in the menu next to it
shows that model's own choice, since only some models reason at all and a
single setting for every model would be wrong for the rest.

Support varies by server and model:

- Some models can't turn reasoning off at all, even when Off is selected.
- Some servers ignore the setting outright.
- Some servers reject it. When that happens, the chat automatically retries
  the answer without it and shows a small note: "This server didn't accept
  the reasoning setting, so it used its default."

To check whether a choice actually took effect, watch the reasoning box while
the answer streams, or open **Steps** afterward - both show whether the model
reasoned at all. If a level isn't working the way you expect, the most
reliable fix is changing the model's own reasoning setting in the server app
itself (for example, the model's settings in LM Studio or Bionic).

Older versions of LM Studio only return reasoning in a separate field when
that's turned on under **App Settings → Developer**. If it's off there, the
model's reasoning still arrives, just inline in the answer between `<think>`
tags - Vertex Flow separates it into the reasoning box either way.

## The chat's own workspace

The chat starts on the workspace you had open, and the header shows which
one it's using. You can change it in two ways:

- Pick another workspace from the **workspace** menu in the chat header.
- Ask, for example "switch to my Personal workspace".

Either way only the chat moves. Your sidebar and the rest of the pane stay on
the workspace they were showing. For a one-off question about another
workspace ("how many tasks are open in Personal?") the model can look there
without switching.

## Seeing what the model did

Under each answer, **Used:** lists the tools the model called to produce it.
Click it to see every call in order; a call that failed is marked "(error)".

When the model lists tasks or projects, they appear under the answer as
clickable rows. Click one to open it. **Load more** shows the rest of a long
list.

Stop ends an answer immediately, even while the model is still calling tools.

## Following along while it works

While an answer is on its way, a status line under the animated dots says
what's happening:

- **Waiting for the model** with a seconds counter: the server is reading your
  question and the conversation so far. The counter shows elapsed time rather
  than a percentage because the OpenAI-compatible endpoint Vertex Flow uses
  doesn't report prompt-processing progress.
- **Thinking** with a counter: the model is reasoning before it answers.
- **Running list_tasks…** (or another tool), then a short result such as
  **list_tasks: 42 results**.
- **Writing answer…** once the answer itself starts to appear.

**Thinking models** also stream their reasoning into a small box under the
status line. Click its **Thinking** header to collapse it; it stays collapsed
for the rest of that answer. Reasoning only appears if the model produces it.
In LM Studio or Bionic you may need to turn on the server setting that returns
reasoning separately from the answer. Models that write their reasoning inline
between `<think>` tags are handled too: that text goes to the reasoning box,
never into the answer.

## Steps

Once an answer is finished, **Steps** under it (collapsed at first) lists
everything that went into it, with timings:

- each **model round**: how long it took, how long it waited before the first
  word, and its **Reasoning** (click to expand), if there was any;
- each **tool call**: the tool's name, a short summary of what it was asked
  for, and what it returned.

A step cut short by Stop is marked "stopped". Reasoning and Steps are shown
only to you: they're never sent back to the model, never copied with Copy, and
never saved to disk.

## Troubleshooting

**"Nothing is answering at…"**
The server isn't running at that address. Turn on the local API server in LM
Studio or Bionic (Local Model API → Local API server), start Ollama, Jan or
llama.cpp, or check that the port in **Base URL** matches the server's.

**"The server answered but has no /chat/completions here."**
The address reaches a server, but not its OpenAI-compatible API. The base URL
usually ends in `/v1`.

**"The server rejected the request."**
The server needs an API key, or the key is wrong. Check **API key** in
Settings.

**"The server is running but lists no models."**
Download or load a model in your server app, then use Retry in the chat.

**The model answers without looking anything up, or makes things up.**
Try a model that supports tool calling. Smaller models sometimes skip tools.

**"Stopped after 8 tool rounds."**
The model kept calling tools without settling on an answer. Ask a more
specific question.

## Prefer no setup?

The built-in models still work with nothing to install: choose
**Built-in (in-browser)** in Settings → AI Chat. Switching between the two
starts a new conversation.
