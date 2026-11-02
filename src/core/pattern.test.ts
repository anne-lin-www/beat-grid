import { describe, expect, it } from "vitest";
import {
  activeTracksAt,
  clearPattern,
  createEmptyPattern,
  toggleStep,
} from "./pattern";
import { STEP_COUNT, TRACK_IDS } from "./tracks";

describe("createEmptyPattern", () => {
  it("has every step of every track off", () => {
    const pattern = createEmptyPattern();
    for (const track of TRACK_IDS) {
      expect(pattern[track]).toHaveLength(STEP_COUNT);
      expect(pattern[track].every((isOn) => !isOn)).toBe(true);
    }
  });

  it("returns a fresh object each call", () => {
    expect(createEmptyPattern()).not.toBe(createEmptyPattern());
  });
});

describe("toggleStep", () => {
  it("turns an off step on", () => {
    const next = toggleStep(createEmptyPattern(), "snare", 4);
    expect(next.snare[4]).toBe(true);
  });

  it("restores the original content when toggled twice", () => {
    const original = createEmptyPattern();
    const twice = toggleStep(toggleStep(original, "hihat", 7), "hihat", 7);
    expect(twice).toEqual(original);
  });

  it("only changes the requested cell", () => {
    const next = toggleStep(createEmptyPattern(), "kick", 0);
    expect(next.kick.filter(Boolean)).toHaveLength(1);
    expect(next.snare.some(Boolean)).toBe(false);
    expect(next.hihat.some(Boolean)).toBe(false);
    expect(next.clap.some(Boolean)).toBe(false);
  });

  it("does not mutate the original pattern", () => {
    const original = createEmptyPattern();
    const originalKick = original.kick;
    const snapshot = structuredClone(original);
    const next = toggleStep(original, "kick", 3);
    expect(original).toEqual(snapshot);
    expect(original.kick).toBe(originalKick);
    expect(next).not.toBe(original);
    expect(next.kick).not.toBe(original.kick);
  });

  it("shares the untouched tracks with the original", () => {
    const original = createEmptyPattern();
    const next = toggleStep(original, "kick", 3);
    expect(next.snare).toBe(original.snare);
  });

  it.each([-1, STEP_COUNT, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns the same pattern for invalid step %s",
    (step) => {
      const original = createEmptyPattern();
      expect(toggleStep(original, "kick", step)).toBe(original);
    },
  );

  it("accepts the first and last valid steps", () => {
    const first = toggleStep(createEmptyPattern(), "clap", 0);
    const last = toggleStep(createEmptyPattern(), "clap", STEP_COUNT - 1);
    expect(first.clap[0]).toBe(true);
    expect(last.clap[STEP_COUNT - 1]).toBe(true);
  });
});

describe("clearPattern", () => {
  it("equals an empty pattern", () => {
    expect(clearPattern()).toEqual(createEmptyPattern());
  });
});

describe("activeTracksAt", () => {
  it("returns an empty list when nothing is on at that step", () => {
    expect(activeTracksAt(createEmptyPattern(), 5)).toEqual([]);
  });

  it("returns tracks in TRACK_IDS order regardless of toggle order", () => {
    let pattern = createEmptyPattern();
    pattern = toggleStep(pattern, "clap", 2);
    pattern = toggleStep(pattern, "kick", 2);
    pattern = toggleStep(pattern, "hihat", 2);
    expect(activeTracksAt(pattern, 2)).toEqual(["kick", "hihat", "clap"]);
  });

  it("ignores tracks that are on at other steps only", () => {
    const pattern = toggleStep(createEmptyPattern(), "snare", 9);
    expect(activeTracksAt(pattern, 8)).toEqual([]);
    expect(activeTracksAt(pattern, 9)).toEqual(["snare"]);
  });
});
