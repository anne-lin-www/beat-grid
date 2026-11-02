import { STEP_COUNT, TRACK_IDS, type TrackId } from "./tracks";

export type Steps = readonly boolean[];
export type Pattern = Readonly<Record<TrackId, Steps>>;

function createEmptySteps(): Steps {
  return Array.from({ length: STEP_COUNT }, () => false);
}

export function createEmptyPattern(): Pattern {
  return {
    kick: createEmptySteps(),
    snare: createEmptySteps(),
    hihat: createEmptySteps(),
    clap: createEmptySteps(),
  };
}

function isValidStep(step: number): boolean {
  return Number.isInteger(step) && step >= 0 && step < STEP_COUNT;
}

export function toggleStep(
  pattern: Pattern,
  track: TrackId,
  step: number,
): Pattern {
  if (!isValidStep(step)) {
    return pattern;
  }
  return {
    ...pattern,
    [track]: pattern[track].map((isOn, index) =>
      index === step ? !isOn : isOn,
    ),
  };
}

export function clearPattern(): Pattern {
  return createEmptyPattern();
}

export function activeTracksAt(pattern: Pattern, step: number): TrackId[] {
  return TRACK_IDS.filter((track) => pattern[track][step] === true);
}
