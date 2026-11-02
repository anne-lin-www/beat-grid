import { describe, expect, it, vi } from "vitest";
import {
  asAudioContext,
  createFakeAudioContext,
} from "../testing/fake-audio-context";
import { getNoiseBuffer } from "./noise";

describe("getNoiseBuffer", () => {
  it("creates a mono, one second white-noise buffer with samples in [-1, 1]", () => {
    const ctx = createFakeAudioContext({ sampleRate: 8000 });
    const buffer = getNoiseBuffer(asAudioContext(ctx));

    expect(buffer.numberOfChannels).toBe(1);
    expect(buffer.length).toBe(8000);
    const samples = buffer.getChannelData(0);
    expect(samples.every((s) => s >= -1 && s <= 1)).toBe(true);
    expect(samples.some((s) => s !== 0)).toBe(true);
  });

  it("returns the same buffer on a second call for the same context", () => {
    const ctx = asAudioContext(createFakeAudioContext());
    expect(getNoiseBuffer(ctx)).toBe(getNoiseBuffer(ctx));
  });

  it("creates the buffer only once per context", () => {
    const fake = createFakeAudioContext();
    const create = vi.spyOn(fake, "createBuffer");
    const ctx = asAudioContext(fake);
    getNoiseBuffer(ctx);
    getNoiseBuffer(ctx);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives different contexts different buffers", () => {
    const a = asAudioContext(createFakeAudioContext());
    const b = asAudioContext(createFakeAudioContext());
    expect(getNoiseBuffer(a)).not.toBe(getNoiseBuffer(b));
  });
});
