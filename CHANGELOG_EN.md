# Changelog

Important changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semver](https://semver.org/).

> **Division of labor with Release notes**: each release's notes are **auto-generated from commits** ("Added / Fixed") and are the exact record of that release; this file is a **manually curated history** that merges related changes and adds context. Both share the same source — everyday commits only need to follow the commit-message convention.

> Chinese original: [CHANGELOG.md](CHANGELOG.md). **English is provided for convenience; the Chinese text is authoritative.**

---

## [0.1.27] — 2026-10-01

### Added

- **Bookshelf categories**: "⋯ menu → Category management" — create / rename / delete categories (deleting moves its books back to uncategorized), with per-category book counts; long-press a book for "Move to category…"
- **Bookshelf category filter**: the header shows the current group (tap for a full multi-row picker), plus a chip row under the quick actions for fast switching; selecting a group shows only its books, "All" flattens the shelf; the choice is remembered
- **Shelf sorting**: recently updated / created / title / word count — applied within groups and to the flat shelf
- **Book shadow & plank as textures**: more realistic depth and lighting

### Fixed

- Update dialogs no longer stack: removed a leftover legacy alert that appeared alongside the new card
- The Advanced page no longer dumps the full release notes
- User message bubbles align to the right (previously stuck mid-left); the timestamp and edit button follow
- Assistant execution / reasoning / error cards are narrowed instead of full-width
- Agents / skills / tool permissions collapse into a compact grouped list with separators
- **Style library Word (.docx) imports now succeed**: the database whitelist was missing docx
- Removed the accidental border around book covers

### Changed

- The shelf ⋯ menu is now an anchored dropdown under the button; category management and sorting became real features, replacing the "show categories on shelf" toggle

---

## [0.1.26] — 2026-10-01

### Added

- **Bookshelf local import**: bring TXT / Markdown / Word (.docx) / EPUB files in as projects — split by volume / chapter headings (recognizes 「第X卷」/「第X章」/ prologue / epilogue markers; one chapter when no markers; oversized chapters auto-split), opened right after importing
- **Bookshelf header becomes 「＋ New」 and a 「⋯ menu」**: the menu holds the shelf style (grid / list) and local import; category management / show categories on shelf / shelf sorting are placeholders (not yet available)
- **Selectable mascot**: Settings → Basics → Mascot, six options (cat / fox / paper crane / shiba / dragon / ink-drop), tinted by the theme
- **Processing time per reply**: the reasoning block header shows elapsed seconds
- **English README and CHANGELOG** (bilingual navigation)

### Fixed

- Bookshelf depth: cover outline and shadows strengthened; plank recolored to a light warm gray with a drop shadow
- Update dialog: shows the release notes; buttons are Now Later / View details (opens the GitHub Release) / Update now
- User bubbles size to their content; the Edit button is gray and shows the send time
- Agents / skills / tool permissions grouped, collapsed by default; search matches names and descriptions only
- Style-library imports: picker MIME list aligned with attachments; size check no longer misfires; failures carry a stage label and are logged
- Write-confirmation dialog: changes collapsed by default (summary + 3-line preview + expand), height-capped with internal scrolling

---

## [0.1.24] — 2026-10-01

### Added

- **Built-in writing skills grow to 39** (16 from the upstream pack + 23 self-written by Storyloom, ~27k characters): added outline building, expand & compress, interactive-fiction branching, simulated reader & retention diagnostics, blurbs & pitch copy, audio-drama scripts, scene & atmosphere description, writing research, theme design, series & cross-book foreshadowing, fanfiction, poetry & lyrics, golden-finger & power-system design; earlier additions: screenplay scenes, worldbuilding & consistency, scene pacing & imagery, genre conventions & reader expectations, satisfying-payoff & face-slap design, voice consistency, long-form continuity audit, dialogue polish, de-AI-flavor
- **Skills / agents / tool permissions grouped**: skills in 6 categories (characters / dialogue & style / genres & settings / review & polish / conventions & continuity / plot & structure), agents split primary / sub, permissions grouped by target (6 groups); skills and permissions lists gain search boxes
- **Skills open to full instructions**: tap a skill for a scrollable sheet; built-in skills can be **duplicated into an editable custom copy**; list and sheet explain "locked = bundled or online-updated, not editable"
- **Style-library imports no longer depend on the filename**: when the extension is missing, format is identified by MIME and file content (zip signature + `word/document.xml` / `META-INF/container.xml`); errors echo the real filename and type; attachments get the same fallback

### Fixed

- **Bookshelf grid becomes "books standing on a plank"**: removed the extra fake plank and inner cover frame; titles and volume / chapter / word counts moved **below the plank**; the plank gains thickness, books touch it with a contact shadow; covers get larger radii and a light spine; cover text no longer truncates, stats no longer wrap
- **Assistant input merged into one layer**: fixes the nested "box inside a box"; attachment and send buttons are visible again as `[＋] input [send]`
- **Only one "Edit" on user messages**: previously the old and new buttons rendered together
- **Extension presets merge on both content-pack read paths**: previously, once the pack was stored locally, the copy without extensions was served — making "de-AI-flavor" and the long / short / screenplay agents disappear from settings
- Added the create-project / create-volume / create-chapter tools to the permissions catalog (previously 37 real tools vs. 34 listed)

---

## [0.1.23] — 2026-09-30

### Added

- **Automatic update check on launch**: silent check, card popup on a new version (auto-closes after 10 s, "Later" or "Update now" — downloads and installs in-app)
- **Diagnostics gain "recent navigation trail"**: stored separately from errors and doesn't count against the error cap; trail records down to page level

### Fixed

- **Assistant input**: removed the nested box-in-box, now a single capsule (attach / input / send) with a smaller send button
- **Bookshelf grid**: plank became a single layered board, generated covers gained an arc highlight and deeper contact shadows
- Removed the redundant model-switch button on the models page; restored the model picker on the assistant's book row
- Long-press conversation settings and model-capabilities spacing — the previous fix was insufficient, re-adjusted
- User message "Edit" moved out of the bubble (below it)
- Mascot now **long-press (350 ms) to drag** to avoid scroll conflicts; suggestion chips shrunk into a row
- Unnamed scratch container is only created **once you start typing**

---

## [0.1.22] — 2026-09-30

### Added

- **Bookshelf form**: each row of books stands on a shared plank with spine / page details and deeper shadows; covers without images get a generated typographic cover
- **Per-model conversation settings**: long-press a model for "this model only / global default"
- **Model capabilities page**: temperature / max tokens / tool calls / image input in one place
- **Three creation tools**: the AI can create projects / volumes / chapters (with write confirmation)
- **Operation trail**: page visits and opened books are logged and exported with diagnostics
- **Cover / avatar downsampling on save** (covers 1080 px, avatars 512 px wide)
- **Switch-project icon** added on the assistant and writing pages

### Fixed

- "Add provider" couldn't return to the models page
- Note-export format dialog couldn't be cancelled (Android system dialogs cap at 3 buttons; replaced with a custom one)
- Long-press settings and capabilities layout too cramped
- Mascot toggle misplaced into the chat-font row
- User message "Edit" moved below the bubble

### Changed

- **Settings consolidation**: 13 → 12 entries (removed "General" and "Context"; "Connection" keeps only the timeout; added "Model capabilities"); setting keys unchanged, old settings preserved
- **Models page redesign**: default-model card + plain provider rows + dedupe moved to the header
- The scratch chat container is renamed "Unnamed" and created lazily

---

## [0.1.21] — 2026-09-30

### Added

- **Settings consolidation**: 13 → 10 entries at this stage (removed empty "General / Connection / Context" pages, all settings relocated); data location and reset-defaults moved to "Advanced"; autosave delay and mascot toggle moved to "Editor"
- **Models page redesign**: a single default-model card; plain provider rows (name / endpoint / fetch models / advanced / delete) + radio to switch default; "clean duplicates" in the header
- **Per-model conversation settings**: long-press a stored model for message count / context window / compression toggle, stored as an override with a reset to global
- **Model capabilities page**: per-model temperature / max tokens / tool calls / image input, re-guessed by model name
- **Three-step new-provider wizard**: provider → advanced (skippable) → confirm
- **Connection & advanced page**: request timeout + provider advanced settings entry
- Per-model runtime overrides for history limit / compression
- **Write confirmation cards**: badge + red/green line stats + reject / accept
- **In-input model switcher**: labeled model dropdown under the input, attachment count shown

---

## [0.1.19] — 2026-09-29

### Added

- **Package name changed to `com.meekoriela.storyloom`**, aligned with the account name (was `com.meeko529.storyloom`). ⚠️ A package-name change is a new install identity: **no direct overwrite** — back up → uninstall → install → restore (signing unchanged, so installation itself is unaffected)
- **EPUB export**: e-book format with per-volume / chapter table of contents and optional cover; chapter / volume / whole-book ranges supported
- **Note export**: export all notes of the project as Markdown, organized book → volume → chapter (orphans grouped under "Other", nothing lost)
- **Bookshelf dual view**: switch between **cover-wall grid / list**; covers without images get a generated color cover (title-derived color + initial watermark) with volume / chapter / word stats
- **Conversation directory panel**: full-width "new conversation" button, per-conversation **rename**, message counts; creation asks for confirmation
- **Mascot**: a cat in the assistant's input corner, tinted by the theme
- **Crash & error log merged into diagnostics**: local JS exceptions exportable from "Advanced → Diagnostics"; the settings page shows a count and supports clearing
- **Attachments support Word (.docx)**: send Word files to the assistant, or import .docx into the style library for distillation
- **UI upgrade**: larger radii (4/8 → 8/12/16), layered card shadows

### Fixed

- **Second cover change did nothing**: the old code wrote to a fixed path, so the image component hit its cache; now each save uses a unique filename
- **Writing-page footer floated mid-screen**: keyboard avoidance by height occasionally used a stale keyboard height, shrinking the editor; switched to padding-based avoidance

### Changed

- Diagnostics gained an "error log" section; **a crash with an empty log = a native-layer problem (e.g. OOM)** — a diagnostic clue

---

## [0.1.18] — 2026-09-29

### Added

- **Plain-text (TXT) export**: no markup, title and volume names on their own lines
- **File attachments**: send txt / md / json etc. to the assistant, or save them as project notes
- **Visible reasoning**: collapsible block when the model returns its thinking
- **Context usage meter**: estimated percentage in the title bar with a breakdown; configurable context window per model
- **Project covers & character avatars**: upload a 3:4 cover; characters get avatars
- **Project action panel**: long-press / three-dot opens rename & description, volume / chapter / word stats, upload / replace / remove cover, delete project
- **Editor fonts split**: separate font & size for writing vs. chat
- **Form examples**: one-tap examples for agents / skills / rules
- **Model capability labels**: "supports tools" / "supports images" with name-based guesses
- **Unsigned iOS build workflow** (manual trigger; unverified on device)

### Fixed

- Restored missing borders on multiline inputs (system prompt, skill instructions, rules, character settings, world-info notes, note content)
- Fixed the app still showing "update available" after upgrading, displaying the previous release's notes
- Update notes now render inside the "App version" section

### Changed

- Backups include covers and avatars; settings home shows names only, explanations moved to sub-page tops
- Commit convention upgraded: one thing per commit, written from the user's perspective — the direct source of Release notes

---

## [0.1.17] — 2026-09-29

### Added

- **AI writes are confirmed first**: before writing chapters / notes / settings you see before-and-after, accept or reject as a group, with single-level undo
- **Free-model section**: a dedicated page with five free models as cards — get a key and enable in one tap
- **Custom content packs**: export your rules / skills / agents as JSON, import packs from others
- **Examples**: the agent form gained a one-tap example

### Changed

- Settings entries grew from 12 to 13 (a new "Free models" category); only non-obvious items kept inline explanations

---

## [0.1.16] — 2026-09-28

### Added

- **One-tap backup / restore** under "Settings → Advanced": everything packed as a zip for cloud drives or PC, restored wholesale on a new phone (excluding API keys)
- **In-app updates**: check, download (with a mainland mirror fallback) and install without visiting GitHub
- **Diagnostics export**: app version, device info and non-sensitive settings for bug reports — no API keys or manuscripts
- **Built-in creation presets**: long-form / short-form / screenplay agents and the "de-AI-flavor" skill, ready on install
- **Settings grouping**: 12 entries across Basics / Connection & Models / Creation System / Knowledge / System, each with a one-line note
- **Free-tier markers**: provider presets sorted with free tiers first (Zhipu / SiliconFlow / OpenRouter / Qwen)
- **Zero-download first launch**: the base agent / skill content pack (478 KB) is bundled
- **Optional downloads**: embedding / reranking models, the Lorn style skill and the oh-story pack became optional with per-item download entries
- **Mainland mirrors for local models**: automatic fallback when the primary source fails
- **Editor settings category**: body size (11–28), three fonts with live preview
- **Provider quick-fill**: Zhipu / DeepSeek / Qwen / SiliconFlow / Kimi / custom relay
- **App icon**: redrawn as a quill with adaptive and monochrome variants plus a splash screen

### Fixed

- "Current version" on the Advanced page showed 0.1.0 (the version number was only injected into `build.gradle`, not `app.json`)
- Editor font / size changes didn't apply on return (now reloaded when the page regains focus)
- The physical back button on Settings exited the app (now returns to the settings home)
- The "Author style" entry was a dead page; it now opens the style library directly
- Rules / skills / agents had no delete confirmation
- Index number inputs couldn't be cleared and re-typed (defaults instantly overwrote them)
- The "rebuild index" button's progress state bled across settings pages
- Save failures left the UI inconsistent with storage
- Rules / skills / agents could only be deleted and re-created; now editable in place

### Changed

- Tool permissions switched from tap-cycling to three explicit buttons, plus bulk allow / ask / deny
- General / connection / context / index settings gained one-tap reset to defaults
- Settings copy unified to formal wording; numeric fields annotated with ranges
- **Builds use a fixed signing certificate**: previously CI generated a fresh debug certificate each build, breaking overwrite installs and tripping security checks
- Build artifacts publish automatically to Releases

---

## [0.1.0] — 2026-09-27

First release.

### Added

- **Provider advanced settings**: custom headers, custom auth header name & prefix, function-calling off, `max_tokens` parameter rename — for Chinese vendors, relays and self-hosted gateways
- CI pipeline: cloud builds publish the APK to Releases

### Changed

- Display name `OpenFicM` → `Storyloom`
- Package name set to `com.meekoriela.storyloom`
- In-app update checks target this repository

---

## Notes

- Upstream OpenFicM is versioned `0.8.0`; this project numbers independently from `0.1.0`
- Every release APK is signed with the **same fixed certificate**, so updates overwrite-install directly
- The signing certificate SHA-256 fingerprint is printed in each Release's notes
