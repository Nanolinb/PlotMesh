# PlotMesh

> **A visual canvas where humans, AI, and teams co-create.**
> Stitch human intuition, AI reasoning, and team collaboration into one graph of nodes.

🌐 **Languages**: [中文](README.md) · [English](README.en.md)　|　📜 [Changelog](CHANGELOG.md)

[![version](https://img.shields.io/badge/version-1.7.0--alpha-6366f1)](CHANGELOG.md)
[![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)]()
[![React Flow](https://img.shields.io/badge/React%20Flow-v12-FF0072)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## ✨ What is it

PlotMesh is a **node-based visual workbench**. You break a task into nodes — gather material, call AI, post-process, visualize, ship — wire them into a flow, hit **Run**, and the whole chain executes in topological order.

It's not just "a chat box turned into a canvas." It's where three things meet:

- **Human–AI collaboration** — humans decide *what*, AI handles *how*; AI can even *grow* new structure on the canvas (AI Builder), which you review before it lands.
- **Multi-user collaboration** — multiple users own their own canvases on one server, share them, reference across canvases (with a two-way handshake contract), and get notified via an inbox.
- **Reusable orchestration** — any subgraph can be packaged as a "preset" and reused across canvases and projects.

> **Dual-mode architecture**: works as a **single-user offline tool** (zero config, open and go) *and* a **networked collaboration mode** (login, multi-user, role management). Same codebase, one switch.

## 🎯 Design principles

- **The canvas is the thought.** Every node is a step; every edge is a flow.
- **Human–AI co-creation.** AI-generated structure always shows a **dry-run preview** first — it never edits your canvas without confirmation.
- **Reusability matters.** Package subgraphs as presets in one click.
- **End-to-end.** Files in → AI processing → real Word/Excel/PDF/image/web out.
- **Injection-resistant.** File contents wrapped in `<documents>`, instructions in `<instructions>` — wording inside files can't hijack the model.

## 🧩 Node palette (20 types · 6 groups)

### 📥 Input
| Icon | Node | What it does |
|------|------|------|
| 📁 | File Upload | Parse docx/xlsx/pdf/txt (CJK filenames OK). **Source-only**, no input port. |
| 🔗 | Web Link | Fetch web page / wiki / online doc / news as input; Tencent Docs URLs auto-route via MCP. |
| 🌐 | Cross-Canvas Input | Receives output written back from **another canvas**; source info is read-only, filled by the server. |

### 📝 Text
| Icon | Node | What it does |
|------|------|------|
| ✏️ | Text Prompt | Your task statement. Auto-numbered; multiples concatenate in order. |
| 🤖 | LLM | DeepSeek/GPT/Claude/GLM/Hunyuan/Kimi/Qwen; auto-classifies *reference* vs *instruction* to block injection; temperature tiers Stable/Balanced/Creative/Wild. |
| 🔤 | Text Transform | 9 transforms: case, trim, replace, JSON extract, count, etc. |
| 🔀 | Condition | Route by keyword/regex. Two outputs (top=match, bottom=no-match). |
| 🔀 | Splitter | Split one string into N segments, one output port each (JSON array / numbered / list / delimiter / regex). |
| 📤 | Output | Export **real** txt/md/docx/xlsx/pdf/png, or pick **web** to open rendered HTML (Markdown→HTML + light/dark). |

### 🎨 Visualization
| Icon | Node | What it does |
|------|------|------|
| 📊 | Extract | Use LLM to turn arbitrary text/image into structured JSON for chart nodes. |
| 🥧 | Pie Chart | Render JSON/table/list into SVG pie (local render, 0 tokens). |
| 📊 | Bar Chart | Bar/column chart, local SVG, vertical or horizontal. |
| 🎨 | Generic Chart | LLM looks at a reference image + data and draws arbitrary SVG. |
| 📊 | Dashboard | Collect N chart nodes into one HTML grid page with custom layout. |

### ⏱ Orchestration & Time
| Icon | Node | What it does |
|------|------|------|
| ⏱ | Timeline | Resizable horizontal timeline with fps + timecode (sec/frame/SMPTE); parses cut points from text, one port each. |
| 🏊 | Swimlane | Horizontal lanes / multi-row project timeline. |
| 📦 | Group | Frame & package nodes as a preset; expanded group has ▶ to run only inside. |

### 🌐 Collaboration (networked mode)
| Icon | Node | What it does |
|------|------|------|
| 🌐 | Cross-Canvas Output | Deliver upstream content to another canvas's input; **cross-user references use a two-way handshake** (accepted before it takes effect; cancellation is audited). |
| 🎨 | Theme | Merge "tone (manager)" × "style (designer)" into an effective theme, broadcast down the wire to child nodes. |

### 🤖 AI-native
| Icon | Node | What it does |
|------|------|------|
| 🤖 | AI Builder | Write a request; AI reads canvas context → proposes a node structure → **dry-run preview** → apply in one click (undoable as one step); guardrails: type whitelist / count cap / injection defense. |

## 🤝 Multi-user collaboration (networked mode)

PlotMesh is an offline tool by default, but turning on **networked mode** unlocks team collaboration:

- **Users**: email+password (bcrypt) with JWT; **the first registrant becomes admin**.
- **Canvas ownership**: each canvas has an owner, shareable to specific members.
- **Reference contract**: A referencing B's output needs B's confirmation in the inbox (`pending → accepted/rejected`); cancellation goes `cancelled` and is permanently audited.
- **Inbox + notifications**: top 🔔 Bell receives reference requests / mentions in real time (SSE).
- **Admin console**: 🔑 API Config → 👥 Members (list/reset password/delete/set role; can't delete the last admin).

> Toggle via `~/.plotmesh/server-config.json` → `auth.required=true`, or env `PLOTMESH_AUTH_REQUIRED=true`.

## 🚀 Getting started

### Requirements
- Node.js ≥ 18 (22+ recommended)

### Local dev

```bash
git clone https://github.com/Nanolinb/PlotMesh.git
cd PlotMesh

cd server && cp .env.example .env   # add your LLM API key(s)
npm install && npm start            # http://localhost:3001

cd ../client
npm install && npm run dev          # http://localhost:5173
```

### Configure API keys
1. **Server (recommended)**: edit `server/.env`, add any one model's key.
2. **Frontend**: toolbar 🔑 API Config (writes to `server/.env`).

> No need to configure all providers — the LLM node only shows configured ones.

### Your first workflow
1. Drag ✏️ **Text Prompt** → "Explain quantum entanglement in 3 sentences"
2. Drag 🤖 **LLM**, pick a model
3. Drag 📤 **Output**, format = Markdown
4. Wire: Prompt → LLM → Output
5. Hit ▶️ **Run**, then download the `.md`

### Files + prompts, the right way

```
[ Prompt ] ─┐
            ├─→ [ LLM ] → [ Output ]    ✅ parallel input, most robust
[ File ]   ─┘
```

File Upload has **no input port**; its output is wrapped in `<documents>` as reference, prompts in `<instructions>`.

## 🐳 Docker (team / NAS)

```bash
docker compose up -d        # server (3001) + client (8080)
docker compose logs -f
```

Visit `http://<host-ip>:8080/`. Data persists in `./data` and `./uploads`.

> Docker enables remote access (token-enforced) by default; for team login add `PLOTMESH_AUTH_REQUIRED=true` to the server env.

### macOS autostart

```bash
bash scripts/install-autostart.sh            # launchd service (boot + crash restart)
bash scripts/install-autostart.sh --status
bash scripts/install-autostart.sh --uninstall
```

## 🏗 Architecture

- **Frontend**: Vite + React 18 + TypeScript + [React Flow](https://reactflow.dev/) v12 + [Zustand](https://github.com/pmndrs/zustand)
- **Backend**: Node.js + Express (LLM gateway + uploads + canvas REST API + auth + SSE)
- **Storage**: browser IndexedDB (drafts/presets/prefs) + server `store.json` (cross-browser sync, three-way merge) + `uploads/`
- **Multi-user**: bcryptjs + JWT; pluggable AuthProvider (builtin email/password first, SSO/LDAP reserved)
- **Execution**: frontend executor + server-side runner **dual engine** (headless run + scheduled jobs)
- **LLM**: 7 providers unified via `/api/llm/chat`
- **Real exports**: [docx](https://github.com/dolanmiu/docx) / [xlsx](https://github.com/SheetJS/sheetjs) / [jspdf](https://github.com/parallax/jsPDF)
- **Injection-resistant**: upstream classified by origin, files in `<documents>`, instructions in `<instructions>`

## 🛣 Roadmap

**Done**
- [x] Prompt isolation / context menu / copy-paste / autosave
- [x] Multi-canvas management + Chrome-style tab bar
- [x] Chart stack (pie/bar/generic/dashboard/extract, local SVG)
- [x] Cross-canvas references + server-side runner dual engine
- [x] Cross-browser sync (three-way merge + soft-delete recycle bin)
- [x] Multi-user foundation (Auth/JWT/dual-mode + ownership + inbox/SSE/Bell)
- [x] Reference contract state machine (two-way handshake + audit)
- [x] Theme node (tone × style merge & broadcast)
- [x] AI Builder (AI generates structure + dry-run preview + one-click apply)
- [x] Admin console (members / reset password / roles)
- [x] Docker deploy + macOS autostart

**In progress / planned (v2.0)**
- [ ] Full AI emit: translucent ghost preview on canvas + explicit Slot ports
- [ ] Aggregation node (export PPT/PDF)
- [ ] Flex Pool three-tier staffing & scheduling panel
- [ ] AI PM: daily digest / stuck detection with @mentions / proactive suggestions
- [ ] Control canvas (project-level dataflow monitoring — see where the team is "stuck")

## 🤝 Contributing

Issues / PRs welcome! Please open an Issue first to align on direction.

## 📜 License

MIT © 2026
