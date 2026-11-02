import { describe, expect, it } from "vitest";
import { createEmptyPattern, toggleStep } from "./pattern";
import {
  collectDueSteps,
  LOOKAHEAD_SECONDS,
  startScheduler,
  type SchedulerState,
} from "./scheduler";

const EMPTY = createEmptyPattern();

function input(now: number, bpm = 120, lookahead = LOOKAHEAD_SECONDS) {
  return { now, lookahead, bpm, pattern: EMPTY };
}

describe("LOOKAHEAD_SECONDS", () => {
  it("is 0.1 s", () => {
    expect(LOOKAHEAD_SECONDS).toBe(0.1);
  });
});

describe("startScheduler", () => {
  it("starts at step 0 at the given time", () => {
    expect(startScheduler(1.5)).toEqual({ nextStep: 0, nextStepTime: 1.5 });
  });
});

describe("collectDueSteps", () => {
  it("collects every step in [now, now + lookahead) at 120 BPM", () => {
    // d = 0.125: steps at 0, 0.125, 0.25 fall in [0, 0.3)
    const result = collectDueSteps(startScheduler(0), input(0, 120, 0.3));

    expect(result.due.map(({ step, time }) => ({ step, time }))).toEqual([
      { step: 0, time: 0 },
      { step: 1, time: 0.125 },
      { step: 2, time: 0.25 },
    ]);
    expect(result.state).toEqual({ nextStep: 3, nextStepTime: 0.375 });
  });
});
