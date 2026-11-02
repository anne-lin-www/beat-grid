import { describe, expect, it } from "vitest";
import {
  asAudioContext,
  createFakeAudioContext,
  type FakeAudioContext,
  type FakeGainNode,
} from "../testing/fake-audio-context";
import { KICK_PARAMS, kickVoice } from "./kick";

const T = 2.5;
const P = KICK_PARAMS;
const ENVELOPE_END = T + P.attackSeconds + P.decaySeconds;

/** Fake ctx plus a stand-in session gain to use as the trigger destination. */
function setup(): { fake: FakeAudioContext; destination: FakeGainNode } {
  const fake = createFakeAudioContext();
  const destination = fake.createGain();
  fake.nodes.length = 0; // only count nodes the voice creates
  return { fake, destination };
}

function trigger(
  fake: FakeAudioContext,
  destination: FakeGainNode,
  time: number,
): void {
  kickVoice.trigger(
    asAudioContext(fake),
    destination as unknown as AudioNode,
    time,
  );
}

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

describe("kickVoice.trigger", () => {
  it("creates exactly one sine oscillator and one gain node", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);

    expect(fake.nodes.map((n) => n.kind)).toEqual(["oscillator", "gain"]);
    expect(fake.nodesOfType("oscillator")[0]?.type).toBe("sine");
  });

  it("connects oscillator -> gain -> destination and nothing else", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);
    const [osc] = fake.nodesOfType("oscillator");
    const [gain] = fake.nodesOfType("gain");

    expect(osc?.connections).toEqual([gain]);
    expect(gain?.connections).toEqual([destination]);
    expect(fake.destination.connections).toEqual([]);
    expect(destination.connections).toEqual([]);
  });

  it("schedules an exponential pitch drop starting at the trigger time", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);

    expect(fake.nodesOfType("oscillator")[0]?.frequency.calls).toEqual([
      { method: "setValueAtTime", args: [P.startFrequencyHz, T] },
      {
        method: "exponentialRampToValueAtTime",
        args: [P.endFrequencyHz, T + P.pitchDropSeconds],
      },
    ]);
  });

  it("schedules a fast attack then an exponential decay to 0.001", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);

    expect(fake.nodesOfType("gain")[0]?.gain.calls).toEqual([
      { method: "setValueAtTime", args: [P.silentGain, T] },
      {
        method: "exponentialRampToValueAtTime",
        args: [P.peakGain, T + P.attackSeconds],
      },
      {
        method: "exponentialRampToValueAtTime",
        args: [0.001, ENVELOPE_END],
      },
    ]);
  });

  it("never ramps any param to 0 (exponential ramps need a positive target)", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);
    const params = [
      fake.nodesOfType("oscillator")[0]?.frequency,
      fake.nodesOfType("gain")[0]?.gain,
    ];

    for (const param of params) {
      for (const call of param?.calls ?? []) {
        expect(call.args[0]).toBeGreaterThan(0);
      }
    }
  });

  it("starts at the trigger time and stops a small margin after the envelope", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, T);
    const [osc] = fake.nodesOfType("oscillator");

    expect(osc?.startCalls).toEqual([T]);
    expect(osc?.stopCalls).toHaveLength(1);
    expect(osc?.stopCalls[0]).toBeCloseTo(ENVELOPE_END + P.stopMarginSeconds);
    expect(osc?.stopCalls[0]).toBeGreaterThan(ENVELOPE_END);
  });

  it("uses only the time argument, never ctx.currentTime", () => {
    const { fake, destination } = setup();
    Object.defineProperty(fake, "currentTime", {
      get: () => {
        throw new Error("voice must not read ctx.currentTime");
      },
    });

    expect(() => trigger(fake, destination, T)).not.toThrow();
  });

  it("creates independent nodes on each trigger (no shared state)", () => {
    const { fake, destination } = setup();
    trigger(fake, destination, 1);
    trigger(fake, destination, 3);
    const oscs = fake.nodesOfType("oscillator");
    const gains = fake.nodesOfType("gain");

    expect(oscs).toHaveLength(2);
    expect(gains).toHaveLength(2);
    expect(oscs[0]).not.toBe(oscs[1]);
    expect(gains[0]).not.toBe(gains[1]);
    expect(oscs[0]?.connections).toEqual([gains[0]]);
    expect(oscs[1]?.connections).toEqual([gains[1]]);
    expect(oscs[0]?.startCalls).toEqual([1]);
    expect(oscs[1]?.startCalls).toEqual([3]);
    expect(gains[0]?.gain.calls[0]?.args).toEqual([P.silentGain, 1]);
    expect(gains[1]?.gain.calls[0]?.args).toEqual([P.silentGain, 3]);
  });

  it("does not mutate the voice object", () => {
    const { fake, destination } = setup();
    const keysBefore = Object.keys(kickVoice);
    trigger(fake, destination, T);

    expect(Object.keys(kickVoice)).toEqual(keysBefore);
    expect(Object.isFrozen(kickVoice)).toBe(true);
  });
});
