// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "../audio/transport";
import { mountM1, type M1Deps } from "./m1-app";

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

interface Harness {
  readonly root: HTMLElement;
  readonly ensureAudioContext: ReturnType<typeof vi.fn>;
  readonly createTransport: ReturnType<typeof vi.fn>;
  readonly transport: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  readonly button: HTMLButtonElement;
}

function setup(ensure?: () => Promise<AudioContext>): Harness {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  const ctx = {} as AudioContext;
  const transport = { start: vi.fn(), stop: vi.fn() };
  const ensureAudioContext = vi.fn(ensure ?? (() => Promise.resolve(ctx)));
  const createTransport = vi.fn(() => transport as Transport);
  const deps: M1Deps = { ensureAudioContext, createTransport };
  mountM1(root, deps);
  const button = root.querySelector("button") as HTMLButtonElement;
  return { root, ensureAudioContext, createTransport, transport, button };
}

describe("mountM1", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a Play button that is not pressed and creates no audio yet", () => {
    const h = setup();
    expect(h.button.textContent).toBe("Play");
    expect(h.button.getAttribute("aria-pressed")).toBe("false");
    expect(h.ensureAudioContext).not.toHaveBeenCalled();
  });

  it("calls ensureAudioContext synchronously inside the click handler", () => {
    const h = setup();
    h.button.click();
    expect(h.ensureAudioContext).toHaveBeenCalledTimes(1);
  });

  it("starts the transport after unlock and shows Stop", async () => {
    const h = setup();
    h.button.click();
    await flush();
    expect(h.transport.start).toHaveBeenCalledTimes(1);
    expect(h.button.textContent).toBe("Stop");
    expect(h.button.getAttribute("aria-pressed")).toBe("true");
  });

  it("stops on the second click and returns to Play", async () => {
    const h = setup();
    h.button.click();
    await flush();
    h.button.click();
    await flush();
    expect(h.transport.stop).toHaveBeenCalledTimes(1);
    expect(h.button.textContent).toBe("Play");
    expect(h.button.getAttribute("aria-pressed")).toBe("false");
  });

  it("creates the transport once per context", async () => {
    const h = setup();
    h.button.click();
    await flush();
    h.button.click();
    await flush();
    h.button.click();
    await flush();
    expect(h.createTransport).toHaveBeenCalledTimes(1);
    expect(h.transport.start).toHaveBeenCalledTimes(2);
  });

  it("ignores clicks while unlocking (rapid double click)", async () => {
    const h = setup();
    h.button.click();
    h.button.click();
    await flush();
    expect(h.ensureAudioContext).toHaveBeenCalledTimes(1);
    expect(h.transport.start).toHaveBeenCalledTimes(1);
    expect(h.transport.stop).not.toHaveBeenCalled();
  });

  it("shows an error and does not start when unlock rejects, then recovers", async () => {
    let shouldFail = true;
    const h = setup(() =>
      shouldFail
        ? Promise.reject(new Error("no audio"))
        : Promise.resolve({} as AudioContext),
    );
    h.button.click();
    await flush();
    const alert = h.root.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toContain("no audio");
    expect(h.transport.start).not.toHaveBeenCalled();
    expect(h.button.textContent).toBe("Play");

    shouldFail = false;
    h.button.click();
    await flush();
    expect(h.transport.start).toHaveBeenCalledTimes(1);
    expect(alert.hidden).toBe(true);
  });

  it("listens only to click on the button", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById("app") as HTMLElement;
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    mountM1(root, {
      ensureAudioContext: () => Promise.resolve({} as AudioContext),
      createTransport: () => ({ start: vi.fn(), stop: vi.fn() }),
    });
    const types = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();
    expect(types).toEqual(["click"]);
  });
});
