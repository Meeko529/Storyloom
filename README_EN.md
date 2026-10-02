# Storyloom ✒️

> (๑•̀ㅂ•́)و✧ A novel-writing agent that lives in your pocket — draft three chapters on your commute.

[English](README_EN.md) | [中文](README.md)

An AI writing assistant that runs **entirely on your phone**: outlines, prose, revisions and continuity notes — all on-device.
No computer, no command line. Install and write.

## Why Storyloom?

- 📱 **The whole agent runs on the phone** — not a web wrapper; the writing engine and semantic retrieval run locally
- 🔒 **Your data stays on your phone** — no account, no cloud sync, works offline; remember to back up before uninstalling (￣▽￣)
- 🔌 **Bring your own model** — OpenAI / Gemini / Anthropic protocols; official Zhipu and DeepSeek endpoints work, and so do relays and self-hosted gateways
- 🆓 **Zero cost to start** — connect any provider with a free tier (Zhipu / SiliconFlow / OpenRouter); the app is free, no subscription
- 🧠 **It remembers your book** — local semantic retrieval runs on the phone CPU, so chapter 300 can still find the clue you planted in chapter 3 (・ω<)☆

---

## What is this

Storyloom is an Android app built on top of [**OpenFicM**](https://github.com/tioners/OpenFicM) (by tioners, Apache-2.0). OpenFicM rewrote the desktop tool [OpenFic](https://github.com/syrizelink/OpenFic) in React Native — the agent runtime runs on the phone and all project data stays local.

Storyloom **stands on OpenFicM's shoulders rather than rewriting it**: the UI, local database, on-device agent runtime and local semantic retrieval are inherited upstream; we reworked model integration, first-launch experience, editor & settings, backup & updates, and build & release. Everything we changed and why is [listed below](#differences-from-upstream-openficm) — nothing hidden (｀・ω・´)

> This project is not affiliated with, nor officially endorsed by, the upstream projects. See [docs/上游来源与改动清单.md](docs/上游来源与改动清单.md) (Chinese) for the itemized change log.

---

## Features

**Writing**
- Local bookshelf and project management with volume / chapter structure and preview-first editing (accident-proof); the header "⋯ menu" holds **local import / shelf style (grid / list) / category management / show categories on shelf / shelf sorting**
- **Grid view looks like a real bookshelf**: books stand on a single plank (lit top face + darker front edge), titles and volume / chapter / word counts sit **below the plank**; covers get rounded corners and a light spine, books without a cover get a generated typographic cover (color derived from the title — not a flat color block)
- Autosave with background saving and keyboard avoidance
- **Chapter title pinned at the top**: volume name / chapter name / word count and "Edit" sit directly under the header, so the text area starts with the prose; the "⋯ menu" holds **project contents / export project / new volume / new chapter / version history**
- **Chapter version history**: before a save overwrites a chapter, the outgoing revision is kept (last 30 per chapter); "⋯ → Version history" lets you read any revision and restore it — the current text is archived first
- Export chapter / volume / whole book as Markdown, plain text (TXT) or **EPUB** (shared via the system sheet; no storage permission requested)
- **Categories & groups**: create your own categories ("⋯ menu → Category management"), assign books via long-press; the shelf top filters by the current group (switch via the header or chips, remembered), with four sort orders
- **Local import**: bring TXT / Markdown / Word (.docx) / EPUB files in as projects — split by volume / chapter headings and opened right after importing
- **One-tap backup / restore**: everything packed into a zip you can keep on a cloud drive or PC, restored wholesale on a new phone

**Assistant & agent**
- Sessions are scoped per project; edit any past message and re-run
- Tool permissions in three modes (allow / ask every time / deny), per-tool or in bulk; tools are **grouped by target** (projects & chapters / characters / world info / notes / style & retrieval / interaction) with a search box
- **Write confirmation first**: before the AI writes chapters / notes / settings the confirmation appears as a card inside the conversation, showing before-and-after with red/green line stats — accept or reject as a group, undo after accepting; prose produced by the assistant is written into the corresponding chapter; when the model needs more information it asks as a card in the chat as well
- **Attachments**: send txt / md / json / csv and **Word (.docx)** files to the assistant; save them as project notes for long-term retrieval
- **Conversation directory**: a directory-style panel — a "new conversation" button, per-conversation **rename**, message counts; new conversations ask for confirmation
- **Mascot**: a little figure on the input box corner — six to choose from (cat / fox / paper crane / shiba / dragon / ink-drop), tinted by the theme
- **Reasoning and prose stream in live**: all three protocols stream, so reasoning and text appear as they are generated instead of arriving in one block; while a request runs you see "working · Ns elapsed", with reasoning text and tool-execution events on one live timeline (the run process is the rows of that timeline), and finished run cards show "took Ns". Model reasoning (DeepSeek-R1 family, Zhipu reasoning, Gemini, Claude extended thinking) appears as a collapsible block
- **Context usage**: open it from the "⋯ menu" to see the estimated share, message and character counts, and over-budget / over-window warnings
- Live tool execution, with sub-agent delegation
- A shared budget of 24 model requests per conversation (protects rate-limited relays)
- **Built-in creation presets**: 3 agents (long-form / short-form / screenplay) + **25 built-in writing skills** (de-AI-flavor, dialogue polish, outline building, chapter beat-sheet writing, serial pacing quota & anti-resolution, screenplay scenes, audio drama scripts, long-form continuity audits, scene & atmosphere description, golden-finger design, fanfiction, poetry & lyrics, and more) — spanning long-form, short-form, screenplay and interactive fiction. Custom content can be exported/imported as JSON

**Model integration** (the focus of this project)
- Three protocols: OpenAI-compatible / Google Gemini / Anthropic
- **Free-model section**: a dedicated page with twelve free models — get a key, paste, enable
- **Provider quick-fill**: Zhipu, DeepSeek, Qwen, SiliconFlow, Kimi, OpenRouter — tap to fill the endpoint
- **Provider advanced settings**: custom headers, custom auth header name & prefix, disable tools, swap `max_tokens` for `max_completion_tokens` — for relays and self-hosted gateways
- Separate font & size for writing and chat: body size 11–28, three font choices, live preview

**Materials & retrieval**
- Character library (with avatars), world info, three-level notes (book / volume / chapter); **notes and world info can be exported** (Markdown, hierarchical)
- **World info entries carry trigger conditions**: resident entry / trigger probability / scan depth / secondary keywords, so entries are read by keyword during writing and chat; **SillyTavern world info JSON and character cards can be imported** (JSON or PNG with an embedded card) with trigger conditions preserved
- Full-text search + local semantic retrieval (Chinese embedding + reranking, on-device, offline)
- Dual style system: reference styles (distilled from imported TXT / Markdown / EPUB / Word documents — **identified by MIME and content when the filename lacks an extension**, reusable across projects) + author style (learned from your edits)

**Settings & maintenance**
- 14 settings entries grouped by function: Basics / Connection & Models / Creation System / Knowledge / System; explanations live at the top of each sub-page
- Rules, skills and agents can all be added, edited and deleted, **grouped by category** (skills 6 groups / agents 2 groups / permissions 6 groups) with search; **tap a skill to read its full instructions**, and built-in skills can be duplicated into editable copies
- Optional downloads (advanced content pack, local retrieval models) — **the app works without them**
- **In-app updates**: check and install from the "Advanced" page — no need to visit GitHub
- **One-tap diagnostics export**: app version, device info, non-sensitive settings, **recent errors** and the **recent navigation trail** (which pages you visited) — attach it when reporting (no API keys, no manuscript content)

---

## Differences from upstream OpenFicM

### 1. First launch: from "must download 235 MB" to zero-download

Upstream requires all 5 runtime resources before the app opens, including a **219 MB reranking model** (93% of the total) hosted on an address that is hard to reach from mainland China — and a failed download leaves the user permanently stuck on the launch page.

Changes:

- The base agent / skill content pack (478 KB, 16 skills + 8 agents) is **bundled into the APK**, SHA-256 matching the pinned upstream commit; Storyloom additionally bundles 25 self-written skills without modifying the pack (keeps the checksum intact)
- Resources split into **required / optional**: only the built-in pack is required; Lorn style, oh-story pack, embedding and reranking models are all optional
- The launch page gains "skip and enter the app" — it can never lock you out
- Local models warm up **silently in the background**; a failed warm-up does not block entry
- Downloads gain a mainland mirror (hf-mirror) fallback

### 2. Provider advanced settings

Upstream hardcodes headers and auth, which breaks many Chinese relays and self-hosted gateways (One-API / New-API / various proxies). Five toggles added:

| Toggle | Purpose |
| --- | --- |
| Extra headers | One `Name: Value` per line, for `HTTP-Referer`, `X-Title`, etc. |
| Auth header name | Default `Authorization`; some services use `api-key` |
| Auth prefix | Default `Bearer `; leave empty to send the raw key |
| Don't send tools | For the rare relay without function calling |
| Use `max_completion_tokens` | A few providers only accept that name |

(Implementation trade-offs — why no new DB columns, how defaults fall back — see [docs/上游来源与改动清单.md](docs/上游来源与改动清单.md) §2.1, Chinese.)

### 3. Provider quick-fill

Preset buttons at the top of the provider form (Zhipu / DeepSeek / Qwen / SiliconFlow / Kimi / OpenRouter / custom relay) fill in type, display name and endpoint; you only paste your API key. (Free-tier info lives solely in the "Free models" page — the provider form no longer repeats it.)

### 4. Editor settings as its own page

Upstream squeezes editor settings into "General". Now a dedicated "Editor" category: size (11–28), three fonts (sans / serif / kai), live preview; changes apply when you return to the writing page.

### 5. Settings-page bug fixes

Twelve fixes, four highlights:

- **Irreversible deletes**: deleting rules / skills / agents now asks for confirmation, and they can be edited in place
- **Input overwritten**: clearing an index number field no longer gets instantly replaced by the default
- **State bleed**: the "rebuild index" button's progress state is independent
- **Display vs. reality**: on save failure the input falls back to the value actually in the database

All twelve are in [CHANGELOG.md](CHANGELOG.md) and [docs/上游来源与改动清单.md](docs/上游来源与改动清单.md) §3.4 (Chinese).

### 6. Icon & branding

- App icon redrawn as a **quill** (dark-green background, off-white glyph) with adaptive foreground/background/monochrome and a splash screen — 30 asset files
- Display name: `OpenFicM` → `Storyloom`
- Package name: `com.meekoriela.storyloom` (independent)
- In-app update checks target this repository

### 7. Fixed signing & automatic releases

Upstream's `standalone` variant used a debug certificate, and CI generated a **fresh debug certificate per build** — every version had a different signature (no overwrite installs) and debug certs trip some phones' security checks.

Changed: a **fixed signing certificate** (configured in repo Secrets), so every release can overwrite-install. Build artifacts publish automatically to Releases with notes generated as "Added / Fixed".

### 8. In-app updates & diagnostics

- Check for updates, download (with mainland mirror fallback) and install from the "Advanced" page
- One-tap diagnostics export (version, device, non-sensitive settings, **recent errors**, **recent navigation trail**) via the system share sheet; **no API keys, no manuscripts**

### 9. Backup / restore

- "Advanced → Backup & restore": everything — projects, chapters, notes, agents, skills, settings — packed as a zip
- Restoring picks a file, confirms, overwrites local data; takes effect after restart
- Excludes API keys (kept in system secure storage) and re-downloadable resources

### 10. Settings grouping & built-in creation presets

- 14 entries in five groups (Basics / Connection & Models / Creation System / Knowledge / System); list shows names only, explanations at sub-page tops
- Built-in long-form / short-form / screenplay agents plus **25 self-written skills** (self-written, not translated or copied from external sources), merged with the remote content pack by id — upstream content is never overwritten; **both read paths merge** these extensions
- **Models page**: default-model card + provider rows (fetch models / advanced / delete) + radio to switch default + long-press for per-model conversation settings + "clean duplicates" in the corner
- **Model capabilities page**: temperature / max tokens / tool calls / image input per model
- **Connection page**: request timeout; provider advanced settings live behind each row's button on the Models page
- **New-provider wizard**: provider → advanced (skippable) → confirm

### 11. Ongoing writing & assistant rework

Upstream only offers "chat and copy things over yourself": the AI rewrites directly and mistakes mean digging through history by hand. This project adds three things — **write confirmation** (confirmation cards inline in the conversation, with before/after and red/green line stats, group accept/reject, single-level undo), **creation tools** (the AI can create projects / volumes / chapters, also confirmed first), and a **navigation trail** (page visits and opened books are logged and exported with diagnostics).

Supporting work: the **free-model section** (twelve free models) and **content-pack export/import** on the model side; a **directory-style conversation panel**, **attachments**, **streamed reasoning and prose** in a collapsible block, **write confirmation and tool questions inline in the chat**, and the **context meter** in the ⋯ menu on the assistant side; **chapter version history** (revisions kept before each overwrite, restorable) and the chapter title pinned at the top on the writing side; **project covers & info**, **note & world-info export**, **SillyTavern world info & character card import**, generated covers and grid / list views on the bookshelf side; **update checks** and cover / avatar **downsampling** on the maintenance side.

See the [Features](#features) section for what these look like, and [docs/上游来源与改动清单.md](docs/上游来源与改动清单.md) for the file-by-file log.

---

## Install

> Step-by-step instructions, per-vendor install blocking and troubleshooting: see **[docs/安装与常见问题.md](docs/安装与常见问题.md)** (Chinese).

### 1. Download

Go to **[Releases](../../releases/latest)** and download `Storyloom-Android.apk` (no unzipping needed).

- Requires Android 9.0+, arm64-v8a
- The signing certificate SHA-256 fingerprint is in each Release's notes

### 2. If your phone blocks the install

Chinese Android ROMs warn about non-store APKs — **this is system behavior, not the app**. Tap **Install anyway** (on some phones, "More" first, or wait out a countdown). See the Chinese install guide for per-vendor details.

### 3. Configure a model

The app **ships with no models**; you bring an API key. The easiest path is **Settings → Connection & Models → Free models**: pick one of twelve free models, get a key, enable. Manual setup and the function-calling caveat are in the Chinese guide.

**Nothing is downloaded on first launch**; optional models for semantic retrieval and style distillation are under "Settings → Advanced → Optional content".

---

## iOS

This repo holds no Apple developer account and is not on the App Store. Unlisted iOS apps must be sideloaded and self-signed.

**No iOS build is currently provided.** The repo contains a manually triggered iOS workflow (Actions → Build iOS IPA) that produces an unsigned `.ipa`; it has not been verified on a real device, and Android-only features like in-app updates are not adapted.

Common sideloading tools:

| Tool | Notes |
| --- | --- |
| **AltStore** (most common) | Beginner-friendly; refreshes automatically via a computer on the same network |
| Sideloadly | Windows / macOS, manual re-signing |
| Others | At your own discretion and risk |

> Installation, refresh and expiry depend on your signing method and Apple ID — nothing to do with this project. iOS sideloading results are welcome in Issues.

---

## Repository layout

```
.
├── .github/
│   ├── ISSUE_TEMPLATE/               # Issue templates
│   └── workflows/build-apk.yml       # CI: builds and publishes the APK
├── docs/
│   ├── 安装与常见问题.md              # Install steps & troubleshooting (Chinese)
│   ├── 上游来源与改动清单.md          # Upstream provenance & change log (Chinese)
│   └── screenshots/                  # UI screenshots
├── mobile-rn/                        # The Android app
│   ├── android/                      # Native project (signing & build config)
│   ├── assets/                       # Icons, splash, built-in content pack
│   └── src/                          # App source (TypeScript)
├── CHANGELOG.md                      # Version history (Chinese)
├── CONTRIBUTING.md                   # Contributing guide (Chinese)
├── LICENSE                           # Apache-2.0
└── NOTICE                            # Upstream attribution
```

The upstream `backend` / `frontend` / `desktop` directories are **desktop-only** and are not part of this repository.

---

## Building

### Cloud build (recommended — no Android SDK needed locally)

Triggered automatically on push; can also be run manually from **Actions**. The APK publishes to **Releases** and stays in the run's Artifacts.

### Local build

Node.js 22, JDK 17 and the Android SDK; see [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese) for the full setup and pre-push checklist.

### Signing

Signing comes from four environment variables:

```
STORYLOOM_RELEASE_STORE_FILE        # keystore path (PKCS12)
STORYLOOM_RELEASE_STORE_PASSWORD
STORYLOOM_RELEASE_KEY_ALIAS
STORYLOOM_RELEASE_KEY_PASSWORD
```

With all four present, release signing is used; otherwise it falls back to debug signing (local testing only). CI reads them from GitHub Secrets — **keep the signing key safe**; losing it means no more overwrite-installing updates for the same package name.

---

## FAQ

**Q: Where is my data? Does it go to the cloud? What if I lose it?**
Projects, chapters, characters and chats live in the app's private local database; API keys live in system secure storage — **the only network traffic is calls to the model endpoints you configure**. Use "Settings → Advanced → Backup & restore" to export a zip; uninstalling wipes local data, **back up first** (￣▽￣)

**Q: No old version left on the phone, but install still fails?**
Check the download against the file size on Releases, then follow the install steps above. If it still fails, open an Issue with your phone model, Android version and the full error text — ideally with a diagnostics export.

**Q: iOS / iPad?**
The code is React Native and cross-platform in principle, but only Android builds are produced today; see [iOS](#ios) above.

---

## License & attribution

This project's code is released under the [Apache License 2.0](LICENSE).

- Android implementation, UI and docs from [tioners/OpenFicM](https://github.com/tioners/OpenFicM) (Apache-2.0);
- Product shape and agent system from [syrizelink/OpenFic](https://github.com/syrizelink/OpenFic) (Apache-2.0);
- Writing skills & sub-agents adapted from [worldwonderer/oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode) (MIT);
- Style distillation approach referenced from [lornshrimp/Lorn.NovelWriteSkills](https://github.com/lornshrimp/Lorn.NovelWriteSkills) (no license declared — **its content is not bundled**; users fetch it in-app);
- Local retrieval models are BAAI's `bge-small-zh-v1.5` and `bge-reranker-base` (GGUF quants), downloaded by the user.

Full attribution in [NOTICE](NOTICE).
