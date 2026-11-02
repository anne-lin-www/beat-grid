import { describe, expect, it } from "vitest";
import { asAudioContext, createFakeAudioContext } from "./fake-audio-context";

describe("createFakeAudioContext", () => {
  it("starts suspended at time 0 and advances currentTime", () => {
    const ctx = createFakeAudioContext();
    expect(ctx.currentTime).toBe(0);
    expect(ctx.state).toBe("suspended");
    expect(ctx.sampleRate).toBe(44100);
    ctx.advance(0.5);
    ctx.advance(0.25);
    expect(ctx.currentTime).toBeCloseTo(0.75);
  });

  it("allows currentTime and state to be set directly", () => {
    const ctx = createFakeAudioContext({ sampleRate: 48000 });
    ctx.currentTime = 10;
    ctx.state = "interrupted";
    expect(ctx.currentTime).toBe(10);
    expect(ctx.state).toBe("interrupted");
    expect(ctx.sampleRate).toBe(48000);
  });

  it("resume() sets state to running, records the call and resolves", async () => {
    const ctx = createFakeAudioContext();
    await ctx.resume();
    expect(ctx.state).toBe("running");
    expect(ctx.resumeCalls).toBe(1);
    await ctx.resume();
    expect(ctx.resumeCalls).toBe(2);
  });

  it("exposes a destination node", () => {
    const ctx = createFakeAudioContext();
    expect(ctx.destination.kind).toBe("destination");
  });

  it("records every created node in creation order and filters by kind", () => {
    const ctx = createFakeAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const source = ctx.createBufferSource();
    expect(ctx.nodes).toEqual([osc, gain, filter, source]);
    expect([osc.kind, gain.kind, filter.kind, source.kind]).toEqual([
      "oscillator",
      "gain",
      "biquadFilter",
      "bufferSource",
    ]);
    expect(ctx.nodesOfType("gain")).toEqual([gain]);
    expect(ctx.nodesOfType("oscillator")).toEqual([osc]);
  });

  it("records connect and disconnect calls", () => {
    const ctx = createFakeAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    expect(osc.connect(gain)).toBe(gain);
    gain.connect(ctx.destination);
    expect(osc.connections).toEqual([gain]);
    expect(gain.connections).toEqual([ctx.destination]);
    expect(gain.disconnectCalls).toBe(0);
    gain.disconnect();
    expect(gain.disconnectCalls).toBe(1);
    expect(gain.connections).toEqual([]);
    expect(osc.connections).toEqual([gain]);
  });

  it("records start and stop times on sources", () => {
    const ctx = createFakeAudioContext();
    const osc = ctx.createOscillator();
    const src = ctx.createBufferSource();
    osc.start(1);
    osc.stop(1.5);
    src.start(2);
    src.stop(2.2);
    expect(osc.startCalls).toEqual([1]);
    expect(osc.stopCalls).toEqual([1.5]);
    expect(src.startCalls).toEqual([2]);
    expect(src.stopCalls).toEqual([2.2]);
  });

  it("records AudioParam scheduling calls and exposes value", () => {
    const ctx = createFakeAudioContext();
    const { frequency, detune } = ctx.createOscillator();
    expect(frequency.value).toBe(440);
    expect(detune.value).toBe(0);
    frequency.value = 100;
    expect(frequency.value).toBe(100);
    frequency
      .setValueAtTime(150, 1)
      .exponentialRampToValueAtTime(50, 1.1)
      .linearRampToValueAtTime(60, 1.2)
      .setTargetAtTime(40, 1.3, 0.05)
      .cancelScheduledValues(2);
    expect(frequency.calls).toEqual([
      { method: "setValueAtTime", args: [150, 1] },
      { method: "exponentialRampToValueAtTime", args: [50, 1.1] },
      { method: "linearRampToValueAtTime", args: [60, 1.2] },
      { method: "setTargetAtTime", args: [40, 1.3, 0.05] },
      { method: "cancelScheduledValues", args: [2] },
    ]);
  });

  it("gives each node kind its params with realistic defaults", () => {
    const ctx = createFakeAudioContext();
    expect(ctx.createGain().gain.value).toBe(1);
    const filter = ctx.createBiquadFilter();
    expect(filter.frequency.value).toBe(350);
    expect(filter.Q.value).toBe(1);
    expect(filter.gain.value).toBe(0);
    expect(filter.type).toBe("lowpass");
    expect(ctx.createOscillator().type).toBe("sine");
    const src = ctx.createBufferSource();
    expect(src.buffer).toBeNull();
    expect(src.loop).toBe(false);
  });

  it("createBuffer returns channel data of the requested size, stable per channel", () => {
    const ctx = createFakeAudioContext();
    const buffer = ctx.createBuffer(2, 100, 22050);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(100);
    expect(buffer.sampleRate).toBe(22050);
    expect(buffer.duration).toBeCloseTo(100 / 22050);
    const left = buffer.getChannelData(0);
    expect(left).toBeInstanceOf(Float32Array);
    expect(left).toHaveLength(100);
    left[0] = 0.5;
    expect(buffer.getChannelData(0)[0]).toBe(0.5);
    expect(buffer.getChannelData(1)[0]).toBe(0);
    expect(() => buffer.getChannelData(2)).toThrow(RangeError);
  });

  it("asAudioContext returns the same object typed as AudioContext", () => {
    const ctx = createFakeAudioContext();
    expect(asAudioContext(ctx)).toBe(ctx);
  });
});
