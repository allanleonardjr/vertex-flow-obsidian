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
