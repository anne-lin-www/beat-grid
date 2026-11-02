import { describe, expect, it } from "vitest";
import { STEP_COUNT, TRACK_IDS } from "./tracks";

describe("tracks", () => {
  it("has 16 steps per track", () => {
    expect(STEP_COUNT).toBe(16);
  });

  it("lists the track ids in kick, snare, hihat, clap order", () => {
    expect(TRACK_IDS).toEqual(["kick", "snare", "hihat", "clap"]);
  });

  it("has exactly 4 tracks", () => {
    expect(TRACK_IDS).toHaveLength(4);
  });
});
