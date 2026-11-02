import {
  LOOKAHEAD_SECONDS,
  collectDueSteps,
  startScheduler,
  type ScheduledStep,
  type SchedulerState,
} from "../core/scheduler";
import type { AppState } from "../core/sequencer-state";
import type { VoiceMap } from "./voices/voice";

/** How often the timer wakes the scheduler. It never triggers sounds itself. */
export const TICK_INTERVAL_MS = 25;

/**
 * Gap between start() and step 0, so the first note is scheduled in the
 * future (not in the past) even when the first tick runs a little late.
 */
export const START_DELAY_SECONDS = 0.05;

export interface Transport {
  /** Creates a new session GainNode and starts the wake-up loop; no-op while playing. */
  start(): void;
  /** Clears the timer and disconnects the session gain; no-op when not playing. */
  stop(): void;
}

export interface TransportDeps {
  readonly ctx: BaseAudioContext;
  readonly master: AudioNode;
  readonly voices: VoiceMap;
  readonly getState: () => Pick<AppState, "pattern" | "bpm">;
  readonly onScheduled: (
    steps: readonly { step: number; time: number }[],
  ) => void;
}

/** One playback: its own output gain, scheduler position and timer. */
interface Session {
  readonly gain: GainNode;
  scheduler: SchedulerState;
  timerId: ReturnType<typeof setTimeout> | undefined;
}

export function createTransport(deps: TransportDeps): Transport {
  const { ctx, master, voices, getState, onScheduled } = deps;
  let current: Session | undefined;

  const triggerVoices = (session: Session, due: readonly ScheduledStep[]) => {
    for (const { time, tracks } of due) {
      for (const track of tracks) {
        try {
          voices[track]?.trigger(ctx, session.gain, time);
        } catch (error) {
          // One broken voice must not silence the others or kill the loop.
          console.error(`beat-grid: voice "${track}" failed`, error);
        }
      }
    }
  };

  const tick = (session: Session) => {
    session.timerId = undefined;
    try {
      const { pattern, bpm } = getState();
      const result = collectDueSteps(session.scheduler, {
        now: ctx.currentTime,
        lookahead: LOOKAHEAD_SECONDS,
        bpm,
        pattern,
      });
      // Commit before triggering so a throw can never replay these steps.
      session.scheduler = result.state;
      triggerVoices(session, result.due);
      if (result.due.length > 0) {
        onScheduled(result.due.map(({ step, time }) => ({ step, time })));
      }
    } finally {
      // Re-arm only if this session is still the live one: stop() (and a
      // stop()+start()) may have run inside a voice or onScheduled.
      if (current === session) {
        session.timerId = setTimeout(() => tick(session), TICK_INTERVAL_MS);
      }
    }
  };

  return {
    start() {
      if (current !== undefined) {
        return;
      }
      const gain = ctx.createGain();
      gain.connect(master);
      const session: Session = {
        gain,
        scheduler: startScheduler(ctx.currentTime + START_DELAY_SECONDS),
        timerId: undefined,
      };
      current = session;
      tick(session);
    },
    stop() {
      const session = current;
      if (session === undefined) {
        return;
      }
      current = undefined;
      clearTimeout(session.timerId);
      session.timerId = undefined;
      session.gain.disconnect();
    },
  };
}
