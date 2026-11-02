import { describe, expect, it, vi } from "vitest";
import { createAudioUnlock } from "./audio-unlock";
import {
  asAudioContext,
  createFakeAudioContext,
  type FakeAudioContext,
} from "./testing/fake-audio-context";

/** Plan §3: unlock must never bind these; listed only for a negative assertion. */
const FORBIDDEN_UNLOCK_EVENTS = ["pointerdown", "touchstart", "touchend"];

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

  it.each(["suspended", "interrupted"] as const)(
    "calls resume() again synchronously when the context is %s on a later call",
    async (state) => {
      const { fakes, unlock } = setup();
      await unlock.ensureAudioContext();
      const fake = fakes[0];
      if (fake === undefined) throw new Error("context not created");
      fake.state = state;

      const pending = unlock.ensureAudioContext();

      expect(fake.resumeCalls).toBe(2);
      expect(fake.nodesOfType("bufferSource")).toHaveLength(2);
      expect(await pending).toBe(fake);
      expect(fake.state).toBe("running");
    },
  );

  it("re-resumes on the next call after a visibilitychange, even if state reads running", async () => {
    const { fakes, visibilityTarget, unlock } = setup();
    await unlock.ensureAudioContext();
    const fake = fakes[0];

    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    expect(fake?.resumeCalls).toBe(1); // nothing happens outside a click

    void unlock.ensureAudioContext();
    expect(fake?.resumeCalls).toBe(2);
    expect(fake?.nodesOfType("bufferSource")).toHaveLength(2);

    await unlock.ensureAudioContext();
    expect(fake?.resumeCalls).toBe(2); // the mark is consumed once
  });

  it("listens only for visibilitychange, once, and never for touch or pointer events", async () => {
    const { addEventListenerSpy, unlock } = setup();
    await unlock.ensureAudioContext();
    await unlock.ensureAudioContext();

    const eventTypes = addEventListenerSpy.mock.calls.map(([type]) => type);
    expect(eventTypes).toEqual(["visibilitychange"]);
    for (const forbidden of FORBIDDEN_UNLOCK_EVENTS) {
      expect(eventTypes).not.toContain(forbidden);
    }
  });
});
