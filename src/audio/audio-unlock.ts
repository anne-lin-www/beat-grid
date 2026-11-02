/**
 * Lazy AudioContext creation and mobile (iOS Safari) audio unlock.
 *
 * Callers invoke `ensureAudioContext()` from inside a `click` handler. This
 * module binds no input listeners of its own: unlocking is driven only by the
 * caller's `click` handler (see docs/PLAN.md §3).
 *
 * Invariant: context creation, `resume()` and the silent buffer `start()` all
 * happen synchronously inside `ensureAudioContext()`, before the returned
 * Promise is awaited, so they run within the user-activation gesture.
 */

export interface AudioUnlock {
  ensureAudioContext(): Promise<AudioContext>;
}

/** The part of `document` the unlock needs: a target for `visibilitychange`. */
export interface VisibilityTarget {
  addEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface AudioUnlockDeps {
  readonly createContext: () => AudioContext;
  readonly visibilityTarget: VisibilityTarget;
}

/** One sample of silence: enough to unlock audio output on iOS Safari. */
const SILENT_BUFFER_LENGTH = 1;

function playSilentBuffer(ctx: AudioContext): void {
  const buffer = ctx.createBuffer(1, SILENT_BUFFER_LENGTH, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

export function createAudioUnlock(deps: AudioUnlockDeps): AudioUnlock {
  let context: AudioContext | null = null;
  // Set by visibilitychange: after an iOS background interruption the context
  // may report "running" yet be silent, so the next click resumes regardless.
  let shouldResume = false;

  const markForResume = (): void => {
    shouldResume = true;
  };

  const ensureAudioContext = (): Promise<AudioContext> => {
    if (context === null) {
      context = deps.createContext();
      deps.visibilityTarget.addEventListener("visibilitychange", markForResume);
    } else if (context.state === "running" && !shouldResume) {
      return Promise.resolve(context);
    }
    shouldResume = false;
    const ctx = context;
    const resumed = ctx.resume();
    playSilentBuffer(ctx);
    return resumed.then(() => ctx);
  };

  return { ensureAudioContext };
}
