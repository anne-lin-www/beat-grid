import { describe, expect, expectTypeOf, it } from "vitest";
import type { Voice, VoiceMap } from "./voice";

describe("Voice types", () => {
  it("allows a partial VoiceMap keyed by track id", () => {
    const voice: Voice = { trigger: () => undefined };
    const map: VoiceMap = { kick: voice };
    expect(map.snare).toBeUndefined();
    expectTypeOf(map.kick).toEqualTypeOf<Voice | undefined>();
  });
});
