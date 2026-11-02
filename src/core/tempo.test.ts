import { describe, expect, it } from "vitest";
import {
  clampBpm,
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  stepDurationSeconds,
} from "./tempo";

describe("tempo constants", () => {
  it("defines the BPM range and default", () => {
    expect(MIN_BPM).toBe(60);
    expect(MAX_BPM).toBe(200);
    expect(DEFAULT_BPM).toBe(120);
  });
});

describe("clampBpm", () => {
  it.each([
    [59, 60],
    [60, 60],
    [201, 200],
    [200, 200],
    [120, 120],
    [120.6, 121],
    [120.4, 120],
    [-5, 60],
  ])("maps %s to %s", (input, expected) => {
    expect(clampBpm(input)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "falls back to the default for non-finite %s",
    (input) => {
      expect(clampBpm(input)).toBe(120);
    },
  );
});

describe("stepDurationSeconds", () => {
  it("is a sixteenth note at the given tempo", () => {
    expect(stepDurationSeconds(120)).toBe(0.125);
    expect(stepDurationSeconds(60)).toBe(0.25);
  });
});
