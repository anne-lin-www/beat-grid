import { describe, expect, it } from "vitest";
import { toggleStep } from "./pattern";
import { initialState, reducer } from "./sequencer-state";
import { DEFAULT_BPM } from "./tempo";

describe("initialState", () => {
  it("starts with an empty pattern, the default BPM and stopped", () => {
    const state = initialState();
    expect(state.bpm).toBe(DEFAULT_BPM);
    expect(state.isPlaying).toBe(false);
    for (const steps of Object.values(state.pattern)) {
      expect(steps).toHaveLength(16);
      expect(steps.every((isOn) => !isOn)).toBe(true);
    }
  });
});

describe("reducer", () => {
  it("toggleStep turns a step on without mutating the previous state", () => {
    const before = initialState();
    const after = reducer(before, {
      type: "toggleStep",
      track: "snare",
      step: 4,
    });
    expect(after.pattern.snare[4]).toBe(true);
    expect(before.pattern.snare[4]).toBe(false);
    expect(after.bpm).toBe(before.bpm);
    expect(after.isPlaying).toBe(before.isPlaying);
  });

  it("toggleStep out of range returns the same state object", () => {
    const state = initialState();
    expect(
      reducer(state, { type: "toggleStep", track: "kick", step: 16 }),
    ).toBe(state);
  });

  it("clearAll empties the pattern and keeps bpm and isPlaying", () => {
    const base = initialState();
    const state = {
      ...base,
      pattern: toggleStep(base.pattern, "kick", 0),
      bpm: 90,
      isPlaying: true,
    };
    const after = reducer(state, { type: "clearAll" });
    expect(after.pattern.kick[0]).toBe(false);
    expect(after.bpm).toBe(90);
    expect(after.isPlaying).toBe(true);
    expect(state.pattern.kick[0]).toBe(true);
  });

  it("setBpm stores the value clamped through clampBpm", () => {
    const state = initialState();
    expect(reducer(state, { type: "setBpm", bpm: 140 }).bpm).toBe(140);
    expect(reducer(state, { type: "setBpm", bpm: 500 }).bpm).toBe(200);
    expect(reducer(state, { type: "setBpm", bpm: 10 }).bpm).toBe(60);
    expect(reducer(state, { type: "setBpm", bpm: Number.NaN }).bpm).toBe(
      DEFAULT_BPM,
    );
  });

  it("setBpm to the current (clamped) value returns the same state object", () => {
    const state = initialState();
    expect(reducer(state, { type: "setBpm", bpm: DEFAULT_BPM })).toBe(state);
    expect(reducer(state, { type: "setBpm", bpm: DEFAULT_BPM + 0.2 })).toBe(
      state,
    );
  });

  it("play sets isPlaying; repeated play returns the same state object", () => {
    const stopped = initialState();
    const playing = reducer(stopped, { type: "play" });
    expect(playing.isPlaying).toBe(true);
    expect(stopped.isPlaying).toBe(false);
    expect(reducer(playing, { type: "play" })).toBe(playing);
  });

  it("stop clears isPlaying; repeated stop returns the same state object", () => {
    const stopped = initialState();
    const playing = reducer(stopped, { type: "play" });
    const after = reducer(playing, { type: "stop" });
    expect(after.isPlaying).toBe(false);
    expect(reducer(after, { type: "stop" })).toBe(after);
    expect(reducer(stopped, { type: "stop" })).toBe(stopped);
  });
});
