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
  let isListeningForVisibility = false;
  // Set by visibilitychange: after an iOS background interruption the context
  // may report "running" yet be silent, so the next click resumes regardless.
  let shouldResume = false;

  const markForResume = (): void => {
    shouldResume = true;
  };

  /** Returns a usable context, creating one if there is none or it was closed. */
  const obtainContext = (): AudioContext => {
    if (context === null || context.state === "closed") {
      // Assigned only after createContext() returns, so a throw leaves no
      // half-created state behind and the next click simply retries.
      context = deps.createContext();
      shouldResume = true;
    }
    if (!isListeningForVisibility) {
      deps.visibilityTarget.addEventListener("visibilitychange", markForResume);
      isListeningForVisibility = true;
    }
    return context;
  };

  /** Everything here runs synchronously, inside the caller's click gesture. */
  const unlockSynchronously = (): Promise<AudioContext> => {
    const ctx = obtainContext();
    if (ctx.state === "running" && !shouldResume) {
      return Promise.resolve(ctx);
    }
    shouldResume = false;
    const resumed = ctx.resume();
    playSilentBuffer(ctx);
    return resumed.then(
      () => ctx,
      (error: unknown) => {
        // The unlock did not take; make sure the next click tries again.
        shouldResume = true;
        throw error;
      },
    );
  };

  const ensureAudioContext = (): Promise<AudioContext> => {
    try {
      return unlockSynchronously();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  };

  return { ensureAudioContext };
}
