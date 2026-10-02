# Changelog

Important changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semver](https://semver.org/).

> **Division of labor with Release notes**: each release's notes are **auto-generated from commits** ("Added / Fixed") and are the exact record of that release; this file is a **manually curated history** that merges related changes and adds context. Both share the same source — everyday commits only need to follow the commit-message convention.

> Chinese original: [CHANGELOG.md](CHANGELOG.md). **English is provided for convenience; the Chinese text is authoritative.**

---

## [0.1.34] — 2026-10-02

### Added

- **Reasoning and execution now form one line**: a single round is one disclosure — collapsed it is a single row (`Finished · N tools · Ns`); expanded, the reasoning row and the tool rows sit on the same line, with the reasoning body indented behind a thin left rule. The run card lost its border and fill so it lines up with the reasoning row
- **Adaptive scroll container**: content shorter than the cap keeps its natural height (no empty gap); only taller content scrolls inside the card. Wired into the write-confirmation card, the question card, the update notes and the run-process body
- **Two new skills**: "De-AI · narrative architecture" (structure before wording, three calibration rules, two-stage protocol, deletion over addition) and "Information gap & conflict ladder" (set / use / reveal / renew, a 2–4 step conflict ladder, the three elements of a scene card); the existing "De-AI flavor" skill gained the three calibration rules and the two-stage protocol. Self-written skills 25 → 27
- **Clickable language switch in the docs**: both READMEs now link both sides of the language switch

### Fixed

- **Question card colours and type size**: the white button bar and the mismatched header icon block are unified with the card body; type dropped one step and both buttons are smaller
- **The two boxes on the write-confirmation card**: the plain block (collapsed) and the bordered block (expanded) are both gone
- **Write-confirmation card now shows "before"**: the collapsed state only rendered the new text; it now shows labelled before / after
- **Write-confirmation buttons are smaller**: matching the two buttons on the question card
- **Six sets of pure-white surfaces** (bottom tab bar, the four resource entries, the ⋯ dropdown on all three screens, the category panel, empty-state chips, the composer) brought down to the page background
- **"Clear current project index" moved**: out of "Advanced → Backup & restore" into "Knowledge → Index", next to "Rebuild current project index"

---

## [0.1.33] — 2026-10-02

### Added

- **Question card restyled**: background now matches the run card (light green-grey), width trimmed to 88% so it follows the message, tighter option radius, header collapsed to one line
- **Reasoning folded into the timeline**: the reasoning block is now a row on the same timeline as the execution events instead of a separate card; one reply shows "reasoning + run finished" according to the actual rounds
- **Write-confirmation card trimmed**: same palette as the other cards in the chat, 88% wide, capped height with a scrollable middle section (header and buttons stay put)
- **Two new skills**: "Serial pacing quota & anti-resolution" (three gears, A/B/C quota ceiling, anti-resolution brake, three-line pre-write check) and "Chapter beat-sheet writing" (list beats → expand one by one → stitch); plus additions to Outline building, Beta reader and Long-form continuity audit

### Fixed

- Update dialog lost its contents after tapping "Update now": the changelog stays visible and the download progress moved to its own line
- Divider lines between run-card event rows
- The question card could not be scrolled when its content overflowed
- Free-model cards still truncated their note after expanding (the line limit is lifted when expanded)
- A failed send only showed a message and never reached the diagnostics report: the message and the raw error are now recorded
- Cards inside the chat are no longer large blocks of pure white

---

## [0.1.32] — 2026-10-01

### Added

- **Confirmation and questions inline in the chat**: write confirmation and tool questions now appear as cards inside the conversation (in the same place as the live timeline); the bottom-sheet form is gone
- **Chapter title moved to the top of the writing screen**: volume name / chapter name / word count / "Edit" sit directly under the header, so the order is "chapter title → style → prose" and the text area starts with the prose itself; "Project contents" moved into the "⋯ menu"
- **Unified sheet behaviour**: bottom sheets now slide in (previously faded), carry a drag handle, use a common 28dp top radius, and scroll internally when content overflows

### Fixed

- **Live tool execution was never shown**: `onTrace` was an empty implementation, so the live trace stayed null — tool-execution events now appear in order on the live timeline
- The run process is folded into the timeline instead of being drawn as a separate card (the red error outline goes with it)
- **Write-confirmation line stats**: long chapters always showed "+0 / −0" when the edit fell beyond the first 600 characters — before/after were only compared within that prefix; the same truncation also made undo replace the whole chapter with those 600 characters
- After a failed send the input box stays empty; the original text remains in the conversation and resend uses "Retry" under that message
- Removed the session bar on the assistant screen that duplicated "Manage conversations"
- The shelf plank image carried 140px of transparent pixels on its right edge, making the two sides uneven (re-cropped to the opaque bounding box)
- Opening shelf sorting left the shelf menu open, stacking two white panels
- The empty-state text on a new conversation was mirrored (Android's inverted list flips both axes; only Y had been compensated)
- Left/right padding for the "New conversation" button in the manage-conversations sheet and for style-version cards on the style library list
- The "switch project" icon on the assistant screen now matches the writing screen
- Free-model cards share one height: title limited to one line, note to two

---

## [0.1.31] — 2026-10-01

### Added

- **True streaming for reasoning and prose**: all three protocols (OpenAI-compatible / Gemini / Anthropic) now stream — reasoning and text appear as they are generated rather than arriving in one block at the end; endpoints that reject streaming (some relays) fall back to non-streaming automatically. An idle timeout replaces the whole-request timeout, so a response that is still transferring is not cut off
- **Live timeline in the assistant**: "working · Ns elapsed" while the request runs, reasoning text scrolling in live, and tool-execution events listed in order on the same timeline; finished run cards show "took Ns"
- **Chapter version history (time machine)**: before a save overwrites a chapter, the outgoing revision is kept (last 30 per chapter). "⋯ → Version history" in the writing screen lets you read any revision in full and restore it; **the current text is archived first**
- **World-info trigger conditions**: entries gain resident / trigger probability / scan depth / secondary keywords; all of them are preserved when importing a SillyTavern world info file (previously only the primary keys survived)
- **Prose written to chapters**: the system prompt now requires the assistant to write prose into a chapter; write confirmation still applies

### Fixed

- The assistant message list now uses the industry-standard inverted list (newest first, position preserved): opening, switching and sending reliably land on the newest content, and expanding a run card no longer jumps the view
- Editing only a world-info entry's text no longer wipes its trigger keywords (it did before)
- Keywords separated by Chinese punctuation (e.g. "甲，乙") in a SillyTavern world info file now split into two keywords instead of one
- Diagnostics breadcrumb timestamps now use local time (they were UTC, 8 hours behind the phone's clock)
- Every tool call (success or failure) is recorded in the breadcrumb trail, so a full call sequence is visible when diagnosing
- Removed the divider line under assistant message bubbles
- Distillation completion text now depends on progress: once the whole book is covered it suggests starting over
- The "installed" state on the Optional content page is now a prominent badge
- Spacing and preview line height inside the write-confirmation card

---

## [0.1.30] — 2026-10-01

### Added

- **Free model catalog 5 → 12**: added Agnes AI (indefinitely free, official endpoint), ModelScope (2000 calls/day), iFlytek Spark Lite (long-term free), SiliconFlow DeepSeek-R1-Distill (reasoning), Groq (GPT-OSS-120B), Cloudflare Workers AI (with account-ID placeholder guidance); every free-tier claim verified online
- **SillyTavern world info import**: the world info page accepts SillyTavern World Info JSON, preserving content, enabled state and trigger keywords (key[])
- **SillyTavern character card import**: the characters page accepts V1/V2/V3 JSON cards and PNG cards with embedded data; personality / scenario / first message fold into the character description
- **World info trigger keywords**: entries gain editable keywords; during writing and chat the writing assistant prioritizes reading matching entries

### Fixed

- The assistant correctly jumps to the newest content after opening / switching conversations and after sending (previously stuck on the oldest); expanding a run card no longer causes jumps
- The shelf plank now spans edge to edge instead of stopping at the page margins
- The Optional content page now shows the previously missing Chinese Novelist skill pack and WenKai font pack download cards
- Spacing between blocks inside the distillation details sheet
- The assistant run card background changed from pure white to a light green-gray; failure red border unchanged
- Five copy strings no longer reference the renamed settings group

---

## [0.1.29] — 2026-10-01

### Added

- **Distillation & request forensics**: every failed attempt and each distillation stage records its classification (connection reset / timeout abort / server error), duration, batch index and sample size into the diagnostics report
- The oh-story content pack moved under Settings → Knowledge → Optional content

### Fixed

- Opening or switching an assistant chat now jumps to the latest message
- Removed the duplicate "Retry" button inside the execution card (the copy / retry row under the message remains)
- Bookshelf rewritten the way shelf apps do it: the plank texture is the row's background layer (full width, bottom anchored) with fixed-width book cells bottom-aligned on it — fixes the lone-book giant cover and the plank/books disconnect
- Restored the missing "Optional content" settings entry

---

## [0.1.28] — 2026-10-01

### Added

- **New "Optional content" settings entry** (Knowledge group): every on-demand download in one place — local embedding / rerank models, the Lorn style Skill, a third-party skill pack, and a body-text font pack; nothing is required for writing
- **Body font pack (LXGW WenKai GB Lite)**: OFL-1.1 open-source Chinese font; download it and pick "文楷" under Editor → Body font (SHA-256 verified, China mirrors), fixing devices where Kai fell back to the default font
- **Third-party skill pack (Chinese Novelist, MIT)**: a staged workflow for writing complete Chinese long-form fiction (Q&A positioning / planning / drafting / validation), installed from a pinned commit, toggleable and removable
- Style distillation now shows a **progress bar with percentage** (sampling / analysis / synthesis / saving)
- Downloads no longer misreport: downloading one item only marks that item as busy

### Fixed

- Bookshelf depth redone: the plank renders at the texture's native aspect ratio (no more vertical stretching) with books seated behind it; book shadows are a small soft shade on the right; removed the accidental cover border
- Update dialogs no longer stack (removed a leftover legacy alert); Advanced no longer dumps the full release notes
- Assistant: your own messages align right and size to content; execution / reasoning / error cards adapt to content (no full-width, no squeezed vertical text); expanding a card no longer jumps to the latest message
- "Raw error details" width follows its content
- Agents / skills / rules / tool-permission cards drop the harsh white background
- Style-library Word (.docx) import fixed (database whitelist was missing docx)
- Collapsed groups become a compact list without large empty gaps
- The ⋯ menu is now an anchored dropdown under its button and narrower (shelf / writing / assistant); meaningless right-side hints removed
- Shelf sorting no longer offers "by title"

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
