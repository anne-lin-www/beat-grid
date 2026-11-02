# CLAUDE.md

Guidance for Claude Code (and its subagents) working in this repository.

## Project

**beat-grid** is a browser drum machine / step sequencer MVP.

- Static front-end only: HTML + TypeScript, built with Vite, deployed to GitHub Pages at `/beat-grid/`.
- 16 steps × 4 tracks (kick, snare, hi-hat, clap). Click a cell to toggle it; the current step is highlighted during playback.
- Transport: play/stop, BPM (60–200), clear all.
- All drum sounds are synthesized with the Web Audio API. **No audio files, no third-party services, no runtime dependencies.**
- Must work on mobile: on narrow screens each track wraps into two rows of 8 cells, touch targets are at least 32×32 px, and there is no horizontal scrolling (checked at 320 px width).
- On iOS the `AudioContext` is created/resumed only inside a `click` handler — never `pointerdown`, `touchstart` or `touchend`.

The full design, data structures and task list live in [`docs/PLAN.md`](docs/PLAN.md). Read it before starting a task and tick the task's checkbox when it is done.

## Architecture

Functional core, imperative shell.

```
src/
  core/    Pure functions. No DOM, no Web Audio, no timers, no Date.now().
  audio/   Web Audio shell: AudioContext unlock, synthesized voices, lookahead transport.
  ui/      DOM rendering only. Turns user events into actions; no business logic.
  app/     Composition root (main.ts), store, requestAnimationFrame playhead loop.
```

Dependency rules (enforce in review):

- `core` imports nothing from `audio`, `ui`, or `app`.
- `audio` may import `core` only.
- `ui` may import `core` types only; it receives `dispatch` and state via parameters.
- `app/main.ts` is the only place that wires real browser objects together.
- Time is always passed in as a parameter (`now`, `time`) — never read inside `core`.
- `AudioContext` is injected (parameter or factory) so it can be replaced by a fake in tests.

Key mechanisms:

- **Lookahead scheduler**: a `setTimeout` loop (~25 ms) only _wakes up_ the scheduler; `core/scheduler.ts#collectDueSteps` computes which steps fall in `[now, now + lookahead)` and the voices are triggered at exact `AudioContext` times. Never trigger sounds directly from `setInterval`/`setTimeout`.
- **Re-alignment**: if `nextStepTime < now - lookahead` (e.g. a throttled background tab), the scheduler skips `k = ceil((now - nextStepTime) / stepDuration)` steps without playing them, so `nextStep = (nextStep + k) mod 16` and `now ≤ nextStepTime < now + stepDuration`. Smaller lateness is played normally. See `docs/PLAN.md` §3.
- **Playhead**: scheduled `{ step, time }` pairs go into a queue; a `requestAnimationFrame` loop asks `core/playhead-queue.ts#currentStepAt(queue, ctx.currentTime)` which step to highlight.
- **Stopping**: every playback gets its own session `GainNode` (voices → session gain → master). `transport.stop()` clears the timer and disconnects the session gain so no scheduled notes or tails ring on; the app then clears the playhead queue and sets the highlight to `null`.
- **Audio unlock**: `audio/audio-unlock.ts#ensureAudioContext()` lazily creates/resumes the context and plays a silent buffer on the first `click`. Context creation, `resume()` and the silent buffer start happen synchronously, before the first `await`. It is idempotent. The play handler must `await ensureAudioContext()` before dispatching `play`.

## Commands

Use Node.js 24 (pinned in `.nvmrc` and `package.json#engines`; run `nvm use`). `package-lock.json` is committed — install with `npm ci`, and commit lockfile changes together with the `package.json` change that caused them.

```bash
npm ci                 # install
npm run dev            # local dev server (http://localhost:5173/beat-grid/)
npm test               # Vitest, single run
npm run test:watch     # Vitest watch mode (use during TDD)
npm run test:coverage  # tests + coverage (src/core/** must be 100%)
npm run lint           # ESLint
npm run format         # Prettier write
npm run typecheck      # tsc --noEmit
npm run build          # production build into dist/
npm run check:base     # verify dist/index.html asset paths start with /beat-grid/
npm run preview        # serve dist/ locally
```

A task is **done** only when `npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run check:base` all pass. CI runs the same sequence on every push and pull request, and deploys only from `main`.

## Development rules

### TDD (mandatory for `core/`, `audio/`, `ui/`)

1. **Red** – write one small failing test that describes the next behaviour.
2. **Green** – write the minimum code to make it pass.
3. **Refactor** – clean up with all tests green.
4. Commit. Prefer many small commits (one behaviour each) over a large one.

- Test files sit next to the source: `src/core/pattern.ts` ↔ `src/core/pattern.test.ts`.
- `core/` has a hard 100% coverage threshold (lines, branches, functions, statements), enforced by `@vitest/coverage-v8` locally and in CI.
- Audio code is tested against the fake `AudioContext` in `src/audio/testing/`; never rely on a real audio device in tests.
- Timer-based code uses `vi.useFakeTimers()`.
- UI tests use the `jsdom` environment and query by role/label, not by CSS class where avoidable.
- Do not delete or weaken an existing test to make a change pass.

### SOLID, applied here

- **S** – one module, one reason to change (pattern logic ≠ tempo math ≠ scheduling ≠ rendering).
- **O** – add a new drum sound by adding a new `Voice` implementation and registering it, not by editing a switch inside the transport.
- **L** – every `Voice` is interchangeable behind `trigger(ctx, destination, time)`.
- **I** – keep interfaces small (`Voice`, `Store`, `Clock`); views receive only what they need.
- **D** – high-level modules depend on abstractions (`BaseAudioContext`, a `Clock` with `currentTime`, a `dispatch` function), injected from `app/main.ts`.

### Code style

- TypeScript `strict`. No `any`; use `unknown` and narrow. No non-null `!` unless justified in a comment.
- Data is immutable: `readonly` types, return new objects, never mutate arguments.
- Prefer pure functions and plain objects over classes; use a class only when it owns lifecycle (e.g. timers).
- Formatting is Prettier's; do not hand-format.
- No new runtime dependencies without discussion. Dev dependencies are fine when justified.

### Naming

| Kind                  | Convention                            | Example                              |
| --------------------- | ------------------------------------- | ------------------------------------ |
| Files                 | `kebab-case.ts`                       | `sequencer-state.ts`, `grid-view.ts` |
| Tests                 | `<file>.test.ts`                      | `scheduler.test.ts`                  |
| Types / interfaces    | `PascalCase`, no `I` prefix           | `Pattern`, `SchedulerState`, `Voice` |
| Functions / variables | `camelCase`, verb-first for functions | `toggleStep`, `collectDueSteps`      |
| Constants             | `UPPER_SNAKE_CASE`                    | `STEP_COUNT`, `MIN_BPM`              |
| Booleans              | `is` / `has` / `should` prefix        | `isPlaying`                          |
| Units in names        | suffix when ambiguous                 | `durationSeconds`, `lookaheadMs`     |
| Action types          | `camelCase` string literals           | `"toggleStep"`, `"clearAll"`         |

### Git

- Branch per task or small group of tasks; Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`, `ci:`).
- Reference the task ID from `docs/PLAN.md` in the commit body (e.g. `Task: T1.2`).

## Delegating to subagents by difficulty

Every task in `docs/PLAN.md` is labelled **簡單 (easy)**, **中等 (medium)** or **困難 (hard)** and names an agent. The main session acts as coordinator: it picks the next task, delegates it, and verifies the result.

| Difficulty    | Agent         | Model  | Typical work                                                                                                                                                                                                                                    |
| ------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 困難 / hard   | `architect`   | opus   | Lookahead scheduler & transport, the kick voice as the synthesis template, AudioContext/iOS unlock, cross-module design decisions, final code review                                                                                            |
| 中等 / medium | `implementer` | sonnet | Pure-function modules (pattern, tempo, state, playhead queue), noise/voice interface/master gain, snare/hi-hat/clap voices following the kick template, store, UI grid and controls, CI workflow, milestone M1 wiring, general TDD feature work |
| 簡單 / easy   | `runner`      | haiku  | Scaffolding/config, running test/lint/typecheck/build, fixing formatting/type/lint nits, updating README, reporting results                                                                                                                     |

Rules:

1. **Use the label in `docs/PLAN.md`.** If a task has no label, classify it with the criteria below before delegating.
2. **Classification criteria**
   - _Hard_: timing/concurrency correctness, audio DSP/sound design, browser-specific audio quirks, anything changing module boundaries or public interfaces across layers, or work that is hard to verify with unit tests alone.
   - _Medium_: a new behaviour inside one module with clear inputs/outputs, implemented test-first; UI that follows an existing pattern.
   - _Easy_: mechanical or repetitive work with no design decisions; result is verifiable by a command exiting 0.
3. **Escalate, don't stretch.** If `runner` hits anything beyond a mechanical fix (failing logic test, unclear requirement), it stops and reports; the coordinator re-assigns to `implementer`. If `implementer` needs to change an interface in `core/` used by `audio/`, or touches timing logic, it escalates to `architect`.
4. **Downgrade is allowed** for clearly mechanical sub-steps of a bigger task (e.g. `architect` designs the voice parameters, `runner` reruns the suite).
5. **After every delegated task**, run `runner` (or the commands directly) to confirm lint/typecheck/test:coverage/build/check:base are green before marking the task done.
6. **Review gate**: changes to `core/scheduler.ts`, `audio/transport.ts`, `audio/audio-unlock.ts` and `audio/voices/kick.ts` must be reviewed by `architect` before merge. The other voices (`snare`, `hihat`, `clap`) are written by `implementer` from the kick template and reviewed by `architect` in the final review (T4.4); `snare.ts` and `clap.ts` must be covered there.
7. **Milestone M1** (after T2.4 and T2.8): kick only + scheduler + transport + play button, deployed to GitHub Pages and checked by ear on desktop and iPhone before the other voices and the full UI are built.
8. Give each subagent the task ID, the acceptance criteria from `docs/PLAN.md`, and the files it owns. Subagents report: what changed, test results, and any open questions.
