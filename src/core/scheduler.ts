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

function realign(
  state: SchedulerState,
  now: number,
  lookahead: number,
  stepDuration: number,
): SchedulerState {
  if (state.nextStepTime >= now - lookahead) {
    return state;
  }
  const skipped = Math.ceil((now - state.nextStepTime) / stepDuration);
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
