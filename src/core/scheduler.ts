import { activeTracksAt, type Pattern } from "./pattern";
import { stepDurationSeconds } from "./tempo";
import { STEP_COUNT, type TrackId } from "./tracks";

export const LOOKAHEAD_SECONDS = 0.1;

export interface SchedulerState {
  readonly nextStep: number;
  readonly nextStepTime: number;
}

export interface ScheduledStep {
  readonly step: number;
  readonly time: number;
  readonly tracks: readonly TrackId[];
}

export function startScheduler(startTime: number): SchedulerState {
  return { nextStep: 0, nextStepTime: startTime };
}

/**
 * Tolerance, in steps, applied before `ceil` when re-aligning.
 *
 * `(now - nextStepTime) / d` is often an integer plus IEEE-754 rounding
 * error (e.g. `(1.1 - 0.6) / 0.125 === 4.000000000000001`). A naive `ceil`
 * would skip one step too many and drop the step that is due exactly at
 * `now`. Subtracting a tiny tolerance first resolves such cases to the
 * smaller `k`, so the re-aligned step may sit up to `1e-6 × d` (< 0.2 µs,
 * far below one audio sample) before `now`; it is then collected like any
 * slightly-late step. Genuine lateness past an integer by more than the
 * tolerance still rounds up.
 */
const REALIGN_TOLERANCE_STEPS = 1e-6;

/**
 * PLAN §3 re-alignment: when `nextStepTime < now - lookahead`, skip
 * `k = ceil((now - nextStepTime) / d)` steps (k ≥ 1) without emitting them,
 * keeping the step/time grid phase.
 */
function realign(
  state: SchedulerState,
  now: number,
  lookahead: number,
  stepDuration: number,
): SchedulerState {
  if (state.nextStepTime >= now - lookahead) {
    return state;
  }
  const lateSteps = (now - state.nextStepTime) / stepDuration;
  const skipped = Math.max(1, Math.ceil(lateSteps - REALIGN_TOLERANCE_STEPS));
  return {
    nextStep: (state.nextStep + skipped) % STEP_COUNT,
    nextStepTime: state.nextStepTime + skipped * stepDuration,
  };
}

export function collectDueSteps(
  state: SchedulerState,
  input: { now: number; lookahead: number; bpm: number; pattern: Pattern },
): { state: SchedulerState; due: ScheduledStep[] } {
  const { now, lookahead, bpm, pattern } = input;
  const stepDuration = stepDurationSeconds(bpm);
  const horizon = now + lookahead;
  const due: ScheduledStep[] = [];
  let { nextStep, nextStepTime } = realign(state, now, lookahead, stepDuration);

  while (nextStepTime < horizon) {
    due.push({
      step: nextStep,
      time: nextStepTime,
      tracks: activeTracksAt(pattern, nextStep),
    });
    nextStep = (nextStep + 1) % STEP_COUNT;
    nextStepTime += stepDuration;
  }

  return { state: { nextStep, nextStepTime }, due };
}
