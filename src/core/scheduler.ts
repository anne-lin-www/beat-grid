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

export function collectDueSteps(
  state: SchedulerState,
  input: { now: number; lookahead: number; bpm: number; pattern: Pattern },
): { state: SchedulerState; due: ScheduledStep[] } {
  const { now, lookahead, bpm, pattern } = input;
  const stepDuration = stepDurationSeconds(bpm);
  const horizon = now + lookahead;
  const due: ScheduledStep[] = [];
  let { nextStep, nextStepTime } = state;

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
