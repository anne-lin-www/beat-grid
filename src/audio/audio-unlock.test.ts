import { describe, expect, it, vi } from "vitest";
import { createAudioUnlock } from "./audio-unlock";
import {
  asAudioContext,
  createFakeAudioContext,
  type FakeAudioContext,
} from "./testing/fake-audio-context";

function setup() {
  const fakes: FakeAudioContext[] = [];
  const createContext = vi.fn(() => {
    const fake = createFakeAudioContext();
    fakes.push(fake);
    return asAudioContext(fake);
  });
  const visibilityTarget = new EventTarget();
  const addEventListenerSpy = vi.spyOn(visibilityTarget, "addEventListener");
  const unlock = createAudioUnlock({ createContext, visibilityTarget });
  return {
    fakes,
    createContext,
    visibilityTarget,
    addEventListenerSpy,
    unlock,
  };
}

describe("createAudioUnlock", () => {
  it("does not create an AudioContext until ensureAudioContext is called", () => {
    const { createContext } = setup();
    expect(createContext).not.toHaveBeenCalled();
  });

  it("creates, resumes and plays a silent buffer synchronously, before the first await", () => {
    const { fakes, createContext, unlock } = setup();

    void unlock.ensureAudioContext();

    // No await yet: everything below must already have happened.
    expect(createContext).toHaveBeenCalledTimes(1);
    const fake = fakes[0];
    expect(fake?.resumeCalls).toBe(1);
    const [source] = fake?.nodesOfType("bufferSource") ?? [];
    expect(source?.startCalls).toEqual([0]);
    expect(source?.buffer?.length).toBe(1);
    expect(source?.connections).toEqual([fake?.destination]);
  });

  it("resolves with the created context", async () => {
    const { fakes, unlock } = setup();
    const ctx = await unlock.ensureAudioContext();
    expect(ctx).toBe(fakes[0]);
  });

  it("returns the same context on repeated calls without creating another", async () => {
    const { fakes, createContext, unlock } = setup();
    const first = unlock.ensureAudioContext();
    const second = unlock.ensureAudioContext();
    expect(await first).toBe(await second);
    expect(await unlock.ensureAudioContext()).toBe(fakes[0]);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("does not resume or replay the silent buffer when already running", async () => {
    const { fakes, unlock } = setup();
    await unlock.ensureAudioContext();
    await unlock.ensureAudioContext();
    expect(fakes[0]?.resumeCalls).toBe(1);
    expect(fakes[0]?.nodesOfType("bufferSource")).toHaveLength(1);
  });
});
