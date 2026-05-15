# PlotMesh

> **A visual canvas where humans and AI co-create.**
> Stitch human intuition and AI reasoning into a single graph of nodes.

🌐 **Languages**: [中文](README.md) · [English](README.en.md)

[![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)]()
[![React Flow](https://img.shields.io/badge/React%20Flow-v12-FF0072)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## ✨ Why PlotMesh

Human–AI collaboration shouldn't be trapped inside a chat box. PlotMesh lets you build AI workflows the way you'd sketch a mind map: **collect raw material → think it through → call the model → post-process → ship the result** — all visible on one infinite canvas.

## 🎯 Design principles

- **The canvas is the thought.** Every node is a step; every edge is a flow of information.
- **Humans decide *what*, AI handles *how*.**
- **Reusability matters.** Any subgraph can be packaged as a "preset" and dropped back in next time.
- **End-to-end, no copy-paste.** Files in → AI processing → real `.docx` / `.xlsx` / `.pdf` / `.png` out.
- **Injection-resistant.** File contents are wrapped in `<documents>` tags; user prompts are wrapped in `<instructions>` — wording inside files cannot hijack the model.

## 🧩 Node palette (7 types)

| Icon | Node | What it does |
|------|------|------|
| ✏️ | Text Prompt | Your task statement. Auto-numbered; multiples concatenate in order. |
| 📁 | File Upload | Upload & parse docx/xlsx/pdf/txt (CJK filenames OK). **Source-only**: it has no input port — it doesn't consume upstream data. |
| 🤖 | LLM | Calls DeepSeek / GPT / Claude / GLM / Hunyuan. Auto-classifies upstream input as *reference material* vs *instruction* to prevent prompt injection. |
| 🔤 | Text Transform | 9 transforms: case, trim, replace, JSON extract, count, etc. |
| 🔀 | Condition | Route by keyword/regex. **Two outputs**: top = match, bottom = no match. |
| 📤 | Output | Export to **real** txt/md/docx/xlsx/pdf/png files. |
| 📦 | Group | Auto-frames selected nodes; save as a reusable preset. |

## 🎨 Toolbar

| Button | Action |
|------|------|
| ▶️ Run | Execute all nodes in topological order |
| 📋 Log | Inspect every step |
| ↶ Undo / ↷ Redo | Cmd+Z / Cmd+Shift+Z, full history |
| 🔑 API Config | Visual editor for model API keys, persisted to `.env` |
| 📦 Save preset | Bundle selected nodes; on name conflict choose *Overwrite / Rename / Cancel* |
| ⬇️ Export / ⬆️ Import | Whole workflow ↔ JSON |
| 🌙 Dark / ☀️ Light | Theme toggle, preference persisted |

## 🚀 Quick start

### Requirements
- Node.js ≥ 18
- npm (or pnpm / yarn)

### Install & run

```bash
# 1. Clone
git clone https://github.com/Nanolinb/PlotMesh.git
cd PlotMesh

# 2. Backend
cd server
cp .env.example .env        # then edit .env to fill in your LLM API keys
npm install
npm start                   # listens on http://localhost:3001

# 3. Frontend (new terminal)
cd client
npm install
npm run dev                 # opens http://localhost:5173
```

### Configure API keys

Either of:

1. **Server-side (recommended)**: edit `server/.env` and fill in any of DeepSeek / GPT / Claude / GLM / Hunyuan. Restart the backend.
2. **Frontend**: click **🔑 API Config** in the toolbar, enter the key, save — it's written to `server/.env`.

> You don't need all five providers. The LLM node only lists the ones that have a key.

### Your first workflow

1. Drag ✏️ **Text Prompt** from the left, double-click and type "Explain quantum entanglement in three sentences."
2. Drag 🤖 **LLM**, pick a model.
3. Drag 📤 **Output**, format = Markdown.
4. Wire them: prompt → LLM → output.
5. Hit ▶️ **Run**.
6. Click ⬇️ on the output node to download a `.md` file.

### File + prompt: do it like this

```
[ Prompt ] ─┐
            ├─→ [ LLM ] → [ Output ]    ✅ Parallel — the right way
[ File   ] ─┘
```

The File Upload node **has no input port** — its output is auto-wrapped in `<documents>` as reference material, while prompts are wrapped in `<instructions>`. So even if the file contains "please double every number", the model won't act on it.

## 📦 Sharing it with others — deployment paths

### Path A · Local handoff (10 min)
Invite collaborators to the GitHub repo and let them follow the Quick Start. **Good for**: 1–3 technical users; **downside**: each person needs Node + their own API key.

### Path B · Hosted (recommended, half a day)
- **Frontend** → Vercel / Netlify / Cloudflare Pages: `cd client && npm run build`, push `dist/`, get HTTPS URL.
- **Backend** → Railway / Render / Fly.io: deploy from GitHub, attach a persistent volume for `uploads/`, set API keys as env vars.
- Use `VITE_API_BASE` in the frontend to point at the public backend URL.

**Good for**: friends/coworkers visiting one URL, you pay for API. **Budget**: frontend free + backend ~$5/mo + LLM usage (DeepSeek is dirt cheap).

### Path C · Productize (1–2 weeks)
Add user auth (Clerk / Supabase Auth) + workflow persistence in a DB + per-user quota / billing. Only worth doing once Path B has confirmed someone actually wants it.

## 🏗 Architecture

- **Frontend**: Vite + React 18 + TypeScript + [React Flow](https://reactflow.dev/) v12 + [Zustand](https://github.com/pmndrs/zustand)
- **Backend**: Node.js + Express (LLM gateway + file upload)
- **LLM bridging**: five providers unified behind `/api/llm/chat`
- **Real-format export**: [docx](https://github.com/dolanmiu/docx) / [xlsx](https://github.com/SheetJS/sheetjs) / [jspdf](https://github.com/parallax/jsPDF)
- **Storage**: browser localStorage (workflows / presets / theme) + server `uploads/` dir
- **Prompt-injection defense**: the executor classifies upstream inputs by source — file chunks are wrapped in `<documents>`, instruction chunks in `<instructions>`, plus a guard line in the system prompt.

## 📁 Layout

```
PlotMesh/
├── client/            # React frontend
│   └── src/
│       ├── components/
│       │   ├── nodes/    # 7 node components
│       │   └── Canvas.tsx
│       ├── store/        # Zustand store
│       ├── types/
│       └── utils/
│           └── exporters.ts    # real-format file exporters
├── server/            # Express backend
│   └── src/
│       └── routes/
│           ├── llm.js      # LLM proxy & config
│           └── upload.js   # file upload (CJK filename safe)
└── README.md
```

## 🛣 Roadmap

- [x] File-upload prompt isolation
- [x] Preset save: overwrite / rename / cancel dialog
- [ ] Node context menu (duplicate / align)
- [ ] Prompt template library
- [ ] LLM streaming output
- [ ] Realtime multi-user editing (WebSocket + soft lock)
- [ ] Canvas version history
- [ ] Third-party plugins / custom node types
- [ ] Workflow marketplace

## 🤝 Contributing

Issues and PRs welcome. Please open an issue describing your idea before sending a PR so we stay aligned on direction.

## 📜 License

MIT © 2026
