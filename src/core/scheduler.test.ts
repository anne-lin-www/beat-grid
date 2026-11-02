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

  it("takes one step per 0.1 s lookahead window at 120 BPM", () => {
    const first = collectDueSteps(startScheduler(0), input(0));
    expect(first.due.map((s) => [s.step, s.time])).toEqual([[0, 0]]);
    expect(first.state).toEqual({ nextStep: 1, nextStepTime: 0.125 });

    const second = collectDueSteps(first.state, input(0.05));
    expect(second.due.map((s) => [s.step, s.time])).toEqual([[1, 0.125]]);
  });

  it("returns nothing when the next step is beyond the horizon", () => {
    const state: SchedulerState = { nextStep: 5, nextStepTime: 1 };

    const result = collectDueSteps(state, input(0.9));

    expect(result.due).toEqual([]);
    expect(result.state).toEqual(state);
  });

  it("excludes a step exactly at now + lookahead (half-open window)", () => {
    const state: SchedulerState = { nextStep: 0, nextStepTime: 0.25 };

    const result = collectDueSteps(state, input(0, 120, 0.25));

    expect(result.due).toEqual([]);
  });

  it("attaches the active tracks of each step, in TRACK_IDS order", () => {
    const pattern = toggleStep(
      toggleStep(toggleStep(EMPTY, "clap", 1), "kick", 1),
      "snare",
      0,
    );

    const result = collectDueSteps(startScheduler(0), {
      now: 0,
      lookahead: 0.3,
      bpm: 120,
      pattern,
    });

    expect(result.due.map((s) => s.tracks)).toEqual([
      ["snare"],
      ["kick", "clap"],
      [],
    ]);
  });

  it("wraps from step 15 back to step 0", () => {
    const state: SchedulerState = { nextStep: 14, nextStepTime: 0 };

    const result = collectDueSteps(state, input(0, 120, 0.5));

    expect(result.due.map((s) => s.step)).toEqual([14, 15, 0, 1]);
    expect(result.state.nextStep).toBe(2);
  });

  it("neither repeats nor skips steps across consecutive calls", () => {
    let state = startScheduler(0);
    const steps: number[] = [];
    const times: number[] = [];

    // 25 ms wake-ups for 4.1 s ≈ 33 steps at 120 BPM
    for (let tick = 0; tick <= 164; tick += 1) {
      const result = collectDueSteps(state, input(tick * 0.025));
      steps.push(...result.due.map((s) => s.step));
      times.push(...result.due.map((s) => s.time));
      state = result.state;
    }

    expect(steps).toEqual(
      Array.from({ length: steps.length }, (_, i) => i % 16),
    );
    expect(steps.length).toBe(34); // steps at 0 .. 4.125 (< 4.1 + 0.1)
    times.forEach((time, i) => {
      expect(time).toBeCloseTo(i * 0.125, 9);
    });
  });

  it("applies a BPM change only to steps after those already scheduled", () => {
    const at120 = collectDueSteps(startScheduler(0), input(0));
    expect(at120.state.nextStepTime).toBe(0.125);

    // 60 BPM → d = 0.25; step 1 keeps its 120 BPM time, step 2 uses 0.25
    const at60 = collectDueSteps(at120.state, input(0.1, 60, 0.4));

    expect(at60.due.map((s) => [s.step, s.time])).toEqual([
      [1, 0.125],
      [2, 0.375],
    ]);
    expect(at60.state).toEqual({ nextStep: 3, nextStepTime: 0.625 });
  });

  it("plays a slightly late step normally (now - lookahead <= nextStepTime < now)", () => {
    const state: SchedulerState = { nextStep: 3, nextStepTime: 1.95 };

    const result = collectDueSteps(state, input(2.0));

    expect(result.due.map((s) => [s.step, s.time])).toEqual([
      [3, 1.95],
      [4, 2.075],
    ]);
  });

  it("treats lateness of exactly lookahead as slight, not severe", () => {
    // binary-exact values: nextStepTime === now - lookahead
    const state: SchedulerState = { nextStep: 3, nextStepTime: 1.75 };

    const result = collectDueSteps(state, input(2.0, 120, 0.25));

    expect(result.due.map((s) => [s.step, s.time])).toEqual([
      [3, 1.75],
      [4, 1.875],
      [5, 2.0],
      [6, 2.125],
    ]);
  });

  it("does not mutate its arguments", () => {
    const state: SchedulerState = Object.freeze({
      nextStep: 0,
      nextStepTime: 0,
    });
    const args = Object.freeze(input(0, 120, 0.3));

    expect(() => collectDueSteps(state, args)).not.toThrow();
    expect(state).toEqual({ nextStep: 0, nextStepTime: 0 });
  });
});

describe("collectDueSteps re-alignment after severe lateness", () => {
  it("skips k = ceil((now - nextStepTime) / d) steps (PLAN §9 example)", () => {
    const state: SchedulerState = { nextStep: 3, nextStepTime: 1.0 };

    // 120 BPM, d = 0.125, now = 2.0 → k = 8 → { 11, 2.0 }
    const result = collectDueSteps(state, input(2.0));

    expect(result.due.map((s) => [s.step, s.time])).toEqual([[11, 2.0]]);
    expect(result.state).toEqual({ nextStep: 12, nextStepTime: 2.125 });
  });

  it("re-aligns across the 16-step boundary (nextStep 14, k = 5 → 3)", () => {
    const state: SchedulerState = { nextStep: 14, nextStepTime: 1.0 };

    // (1.5625 - 1.0) / 0.125 = 4.5 → k = 5 → { 3, 1.625 }
    const result = collectDueSteps(state, input(1.5625));

    expect(result.due.map((s) => [s.step, s.time])).toEqual([[3, 1.625]]);
  });

  it("lands on now <= nextStepTime < now + d, keeping the beat grid phase", () => {
    const state: SchedulerState = { nextStep: 0, nextStepTime: 0 };
    const now = 10.03;

    // lookahead 0 isolates the re-aligned state: nothing is collected
    const result = collectDueSteps(state, input(now, 120, 0));

    expect(result.due).toEqual([]);
    expect(result.state.nextStepTime).toBeGreaterThanOrEqual(now);
    expect(result.state.nextStepTime).toBeLessThan(now + 0.125);
    expect(result.state).toEqual({ nextStep: 81 % 16, nextStepTime: 10.125 });
  });

  it("does not emit the skipped steps", () => {
    const pattern = createEmptyPattern();
    const allKicks = Array.from({ length: 16 }, (_, i) => i).reduce(
      (p, step) => toggleStep(p, "kick", step),
      pattern,
    );

    const result = collectDueSteps(
      { nextStep: 0, nextStepTime: 0 },
      { now: 5.0, lookahead: LOOKAHEAD_SECONDS, bpm: 120, pattern: allKicks },
    );

    // k = 40 → step 8 at 5.0; only one step fits in [5.0, 5.1)
    expect(result.due).toEqual([{ step: 8, time: 5.0, tracks: ["kick"] }]);
  });
});

describe("collectDueSteps re-alignment floating-point boundaries", () => {
  it("does not over-skip when (now - nextStepTime) / d is an integer plus rounding error", () => {
    // Mathematically (1.1 - 0.6) / 0.125 = 4, but in IEEE-754 it evaluates
    // to 4.000000000000001; a naive ceil would give k = 5 and drop the
    // step that is due exactly at now.
    expect((1.1 - 0.6) / 0.125).toBeGreaterThan(4);
    const state: SchedulerState = { nextStep: 0, nextStepTime: 0.6 };

    const result = collectDueSteps(state, input(1.1));

    expect(result.due.map((s) => [s.step, s.time])).toEqual([[4, 1.1]]);
  });

  it("still skips the extra step when lateness genuinely exceeds k steps", () => {
    const state: SchedulerState = { nextStep: 0, nextStepTime: 0.6 };

    // (1.13 - 0.6) / 0.125 = 4.24 → k = 5 → step 5 at 1.225
    const result = collectDueSteps(state, input(1.13));

    expect(result.state.nextStep).toBe(6);
    expect(result.due.map((s) => s.step)).toEqual([5]);
  });

  it("always skips at least one step when severely late (k >= 1)", () => {
    // lookahead 0 makes any lateness "severe"; lateness far below the
    // tolerance still re-aligns by exactly one step
    const state: SchedulerState = { nextStep: 7, nextStepTime: 2 - 1e-12 };

    const result = collectDueSteps(state, input(2, 120, 0));

    expect(result.state.nextStep).toBe(8);
    expect(result.state.nextStepTime).toBeCloseTo(2.125, 9);
  });
});

describe("collectDueSteps BPM guard", () => {
  it.each([
    [0, 60],
    [-120, 60],
    [500, 200],
    [Number.NaN, 120],
  ])(
    "clamps bpm %s like clampBpm (→ %s) so it always terminates",
    (bpm, safe) => {
      const result = collectDueSteps(startScheduler(0), input(0, bpm));
      const expected = collectDueSteps(startScheduler(0), input(0, safe));

      expect(result).toEqual(expected);
    },
  );
});
