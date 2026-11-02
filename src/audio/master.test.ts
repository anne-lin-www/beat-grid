import { describe, expect, it } from "vitest";
import { createMaster, MASTER_GAIN } from "./master";
import {
  asAudioContext,
  createFakeAudioContext,
} from "./testing/fake-audio-context";

describe("createMaster", () => {
  it("returns a gain node with gain 0.8", () => {
    const fake = createFakeAudioContext();
    const master = createMaster(asAudioContext(fake));

    expect(MASTER_GAIN).toBe(0.8);
    expect(fake.nodesOfType("gain")).toHaveLength(1);
    expect(master as unknown).toBe(fake.nodesOfType("gain")[0]);
    expect(fake.nodesOfType("gain")[0]?.gain.value).toBe(0.8);
  });

  it("connects the master gain to the context destination", () => {
    const fake = createFakeAudioContext();
    createMaster(asAudioContext(fake));

    expect(fake.nodesOfType("gain")[0]?.connections).toEqual([
      fake.destination,
    ]);
  });
});
