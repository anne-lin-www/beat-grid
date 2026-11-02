import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("rejects (rather than throwing) when creation fails, and retries creation on the next call", async () => {
    const { fakes, createContext, addEventListenerSpy, unlock } = setup();
    const error = new Error("AudioContext not allowed");
    createContext.mockImplementationOnce(() => {
      throw error;
    });

    await expect(unlock.ensureAudioContext()).rejects.toBe(error);
    expect(addEventListenerSpy).not.toHaveBeenCalled();

    const ctx = await unlock.ensureAudioContext();
    expect(ctx).toBe(fakes[0]);
    expect(createContext).toHaveBeenCalledTimes(2);
  });

  it("rejects when resume() rejects, keeps the context and resumes again on the next call", async () => {
    const fake = createFakeAudioContext();
    const error = new Error("resume refused");
    const resume = fake.resume;
    fake.resume = vi.fn(() => Promise.reject(error));
    const createContext = vi.fn(() => asAudioContext(fake));
    const unlock = createAudioUnlock({
      createContext,
      visibilityTarget: new EventTarget(),
    });

    await expect(unlock.ensureAudioContext()).rejects.toBe(error);

    fake.resume = resume;
    expect(await unlock.ensureAudioContext()).toBe(fake);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fake.resumeCalls).toBe(1);
  });

  it("rejects when the silent buffer cannot be played", async () => {
    const fake = createFakeAudioContext();
    const error = new Error("no buffer");
    fake.createBuffer = () => {
      throw error;
    };
    const unlock = createAudioUnlock({
      createContext: () => asAudioContext(fake),
      visibilityTarget: new EventTarget(),
    });

    await expect(unlock.ensureAudioContext()).rejects.toBe(error);
  });

  it("replaces a closed context with a new one, without re-adding the listener", async () => {
    const { fakes, createContext, addEventListenerSpy, unlock } = setup();
    await unlock.ensureAudioContext();
    const first = fakes[0];
    if (first === undefined) throw new Error("context not created");
    first.state = "closed";

    const second = await unlock.ensureAudioContext();

    expect(second).toBe(fakes[1]);
    expect(second).not.toBe(first);
    expect(createContext).toHaveBeenCalledTimes(2);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the re-resume mark when a resume after visibilitychange rejects", async () => {
    const { fakes, visibilityTarget, unlock } = setup();
    await unlock.ensureAudioContext();
    const fake = fakes[0];
    if (fake === undefined) throw new Error("context not created");
    const resume = fake.resume;
    fake.resume = vi.fn(() => Promise.reject(new Error("interrupted")));

    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    await expect(unlock.ensureAudioContext()).rejects.toThrow("interrupted");

    fake.resume = resume;
    expect(fake.state).toBe("running");
    await unlock.ensureAudioContext();
    expect(fake.resumeCalls).toBe(2);
  });
});

function stubBrowser(constructorName: "AudioContext" | "webkitAudioContext") {
  const fake = createFakeAudioContext();
  const AudioContextStub = vi.fn(function () {
    return asAudioContext(fake);
  });
  const documentStub = new EventTarget();
  const addEventListenerSpy = vi.spyOn(documentStub, "addEventListener");
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  vi.stubGlobal(constructorName, AudioContextStub);
  vi.stubGlobal("document", documentStub);
  return { fake, AudioContextStub, documentStub, addEventListenerSpy };
}

async function importFresh() {
  return import("./audio-unlock");
}

describe("default ensureAudioContext", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not construct an AudioContext or touch document at import time", async () => {
    const { AudioContextStub, addEventListenerSpy } =
      stubBrowser("AudioContext");
    await importFresh();
    expect(AudioContextStub).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it("creates the context with the global AudioContext and returns the same one each time", async () => {
    const { fake, AudioContextStub } = stubBrowser("AudioContext");
    const { ensureAudioContext } = await importFresh();

    expect(await ensureAudioContext()).toBe(fake);
    expect(await ensureAudioContext()).toBe(fake);
    expect(AudioContextStub).toHaveBeenCalledTimes(1);
    expect(fake.resumeCalls).toBe(1);
  });

  it("falls back to webkitAudioContext on older Safari", async () => {
    const { fake, AudioContextStub } = stubBrowser("webkitAudioContext");
    const { ensureAudioContext } = await importFresh();

    expect(await ensureAudioContext()).toBe(fake);
    expect(AudioContextStub).toHaveBeenCalledTimes(1);
  });

  it("binds only visibilitychange on document, never touch or pointer events", async () => {
    const { addEventListenerSpy } = stubBrowser("AudioContext");
    const { ensureAudioContext } = await importFresh();
    await ensureAudioContext();

    const eventTypes = addEventListenerSpy.mock.calls.map(([type]) => type);
    expect(eventTypes).toEqual(["visibilitychange"]);
    for (const forbidden of FORBIDDEN_UNLOCK_EVENTS) {
      expect(eventTypes).not.toContain(forbidden);
    }
  });

  it("rejects when the Web Audio API is unavailable", async () => {
    stubBrowser("AudioContext");
    vi.stubGlobal("AudioContext", undefined);
    const { ensureAudioContext } = await importFresh();

    await expect(ensureAudioContext()).rejects.toThrow(/Web Audio API/);
  });
});
