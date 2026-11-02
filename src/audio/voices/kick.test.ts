import { describe, expect, it } from "vitest";
import { KICK_PARAMS } from "./kick";

describe("KICK_PARAMS", () => {
  it("sweeps pitch down from ~150 Hz to ~50 Hz in about 0.1 s", () => {
    expect(KICK_PARAMS.startFrequencyHz).toBeGreaterThanOrEqual(120);
    expect(KICK_PARAMS.startFrequencyHz).toBeLessThanOrEqual(180);
    expect(KICK_PARAMS.endFrequencyHz).toBeGreaterThanOrEqual(40);
    expect(KICK_PARAMS.endFrequencyHz).toBeLessThanOrEqual(60);
    expect(KICK_PARAMS.endFrequencyHz).toBeLessThan(
      KICK_PARAMS.startFrequencyHz,
    );
    expect(KICK_PARAMS.pitchDropSeconds).toBeGreaterThanOrEqual(0.05);
    expect(KICK_PARAMS.pitchDropSeconds).toBeLessThanOrEqual(0.15);
  });

  it("has a click-free fast attack and a ~0.5 s decay", () => {
    expect(KICK_PARAMS.attackSeconds).toBeGreaterThan(0);
    expect(KICK_PARAMS.attackSeconds).toBeLessThanOrEqual(0.01);
    expect(KICK_PARAMS.decaySeconds).toBeGreaterThanOrEqual(0.3);
    expect(KICK_PARAMS.decaySeconds).toBeLessThanOrEqual(0.7);
  });

  it("peaks at or below unity and ends at 0.001, never 0", () => {
    expect(KICK_PARAMS.peakGain).toBeGreaterThan(0);
    expect(KICK_PARAMS.peakGain).toBeLessThanOrEqual(1);
    expect(KICK_PARAMS.silentGain).toBe(0.001);
  });

  it("stops the oscillator a small margin after the envelope ends", () => {
    expect(KICK_PARAMS.stopMarginSeconds).toBeGreaterThan(0);
    expect(KICK_PARAMS.stopMarginSeconds).toBeLessThanOrEqual(0.1);
  });

  it("is frozen plain data", () => {
    expect(Object.isFrozen(KICK_PARAMS)).toBe(true);
    expect(Object.values(KICK_PARAMS).every((v) => typeof v === "number")).toBe(
      true,
    );
  });
});
