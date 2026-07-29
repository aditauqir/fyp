# PERFORMANCE-FIXES — `fix/performance-fixes`

> **Okay — you switched from the search/menus / caption / prior agent onto this branch.**
> Read this file **first**, then `HANDOFF.md`, `ARCHITECTURE.md`, and skim `youtube-mobile-background.user.js` before editing.
>
> **Target device:** Orion Browser on **iPhone** (WebKit + install-from-file WebExtension). Desktop Chrome is not the acceptance surface.
>
> Source of truth remains `youtube-mobile-background.user.js` → `./rebuild-extension.sh`. Do **not** hand-edit generated `page.js`.

---

## Agent contract (read before any work)

1. You are on branch **`fix/performance-fixes`**, based on latest `origin/main` (shipped **2.2.3** at branch creation).
2. This branch’s job is **CPU / energy / timer performance** on Orion iOS YouTube — not search UI, not caption redesign, not transport-strip invention.
3. After finishing a change: rebuild, note status below, and **ask the user** whether to continue on this branch, a separate branch, or stop.
4. Do **not** revive `FIX-BRANCH.md` search experiments (S1–S5) without explicit user approval.

### Phrases that mean “read the handoffs first”

If the user (or another agent summary) says any of:

- “okay I switched from X / Y / Z agent”
- “read the files”
- “fresh on performance”
- “continue performance fixes”

…then read, in order:

1. **`PERFORMANCE-FIXES.md`** (this file)
2. **`HANDOFF.md`**
3. **`ARCHITECTURE.md`**
4. Relevant slices of **`youtube-mobile-background.user.js`** (timers, playback recovery, page inject)
5. Optionally **`FIX-BRANCH.md`** only to avoid regressing search — do not continue that checklist here

---

## Goal

Port the idea behind **[YouTube CPU Tamer by AnimationFrame](https://greasyfork.org/en/scripts/431573-youtube-cpu-tamer-by-animationframe)** (CY Fung, MIT) into this extension’s **page-world** runtime so Orion iPhone burns less CPU/energy while watching YouTube.

### What that upstream script does (vendor summary)

- Overrides `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`.
- Schedules/coalesces work with `requestAnimationFrame` so busy YouTube timers align with the render cycle.
- Throttles harder when the tab is backgrounded (rAF pauses when the document is hidden).
- **Requires GPU / graphics acceleration** (WebGL probe); skips if unavailable.
- Inspired by kona’s YouTube CPU Tamer; 2024.02.25 rewrite = AnimationFrame timer mechanism.

Upstream notes that matter for us:

| Note | Implication on Orion iPhone |
|------|-----------------------------|
| Overrides native timers | Must run in **page world** (`page.js`), same as our other YouTube patches |
| Needs GPU acceleration | Probe WebGL; if missing, **no-op** — never throw and kill FYP |
| Background tab slows timers | rAF does **not** fire while WebKit considers the page hidden — **dangerous** for FYP background-audio recovery |
| GreasyFork is the real source | We vendor an adapted MIT copy in-repo; do not fetch from random mirrors at runtime |

---

## Orion iPhone constraints (non-negotiable)

| Constraint | Rule |
|------------|------|
| Background audio | FYP `recoverPlayback` / visibility spoof **must** keep working when Orion is backgrounded or locked |
| FYP timers | Extension-owned `setTimeout` / `setInterval` paths use **untamed / pristine** timer APIs, not the CPU-tamer wrappers |
| YouTube timers | Window-level timers YouTube captured/uses get the tamer (energy win) |
| Injection | Install tamer early in page runtime at `document_start`; duplicate-run guard required |
| PiP / Play / inline | Do not change playback gesture, PiP policy, or fullscreen gating while adding the tamer |
| Search / captions / strip | Out of scope unless the user explicitly expands scope |
| Kagi / Orion | Upstream avoids Brave blob-iframe tricks when `kagi` is defined; keep that safe path |

---

## Implementation status

| ID | Work | Status | Notes |
|----|------|--------|-------|
| P0 | Branch + this handoff file | **Done** | `fix/performance-fixes` from `origin/main` |
| P1 | Vendor-adapted CPU Tamer in page runtime | **Done** | `installYoutubeCpuTamer` in userscript; MIT attribution; soft-skip if no WebGL |
| P2 | Keep FYP critical timers on pristine APIs | **Done** | IIFE-local `setTimeout`/`setInterval`/`clear*`/`rAF` bound before window patch |
| P3 | Version bump + `./rebuild-extension.sh` | **Done** | `2.2.4` / `2.2.4_release.zip` |
| P4 | Orion iPhone verification | Pending | User installs zip; check Play, background audio, battery/CPU feel |
| P5 | Compact search + watch stack + theme (2.2.7) | **Done** | Forced simple search rows; video→title→buttons; light/dark strip |
| P6 | Watch gap + toolbar jitter (2.2.8) | **Done** | 16:9 player shells; stable strip placement; no order-4 gap |
| P7 | Horizontal overflow lock (2.2.9) | **Done** | Clip overflow on app shells; cap wide containers to 100% |

---

## Design (how we inject it)

```text
content.js (isolated) → injects page.js (page world)
page.js early boot:
  1. Capture / obtain pristine timer fns for FYP
  2. Async cleanContext (iframe) + installCpuTamer → patch window.* for YouTube
  3. Rest of FYP uses pristine timers only
```

**Do not** run the upstream userscript as a second Tampermonkey install alongside the extension — double timer wrapping is undefined behavior. Remove any standalone CPU Tamer userscript when testing the extension build.

---

## Verification (Orion iPhone)

1. Uninstall old FYP → install new Chrome zip → hard-refresh YouTube.
2. Play a video inline (one tap); no PiP; fullscreen control still works.
3. Lock phone / switch apps: audio must continue (WebKit permitting).
4. Unlock: play/pause strip + Now Playing still agree.
5. Subjective: less heat / energy impact vs previous build while a video plays on-screen.
6. If WebGL unavailable: extension still loads; tamer skipped; no console-fatal.

---

## Do / don’t

**Do**

- Prefer small patches in `youtube-mobile-background.user.js` + rebuild.
- Preserve MIT attribution for CY Fung’s timer logic.
- Fail soft (skip tamer) rather than break playback.

**Don’t**

- Hand-edit `chrome-extension/page.js` or `firefox-extension/page.js`.
- Route FYP background recovery through rAF-gated timers.
- Change search, comments, captions, or transport buttons under this banner.
- Fetch the GreasyFork script at runtime inside the extension.

---

## Next agent: first actions

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md`.
2. Confirm `git branch` is `fix/performance-fixes` and status table above.
3. Implement or finish P1/P2 only; rebuild; update this status table.
4. Ask:

> Continue performance work on **this branch** (`fix/performance-fixes`), a **separate branch**, or **stop**?
