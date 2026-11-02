import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPattern, toggleStep, type Pattern } from "../core/pattern";
import { STEP_COUNT, type TrackId } from "../core/tracks";
import {
  asAudioContext,
  createFakeAudioContext,
  type FakeAudioContext,
  type FakeGainNode,
} from "./testing/fake-audio-context";
import {
  START_DELAY_SECONDS,
  TICK_INTERVAL_MS,
  createTransport,
  type Transport,
} from "./transport";
import type { Voice, VoiceMap } from "./voices/voice";

interface TriggerCall {
  readonly destination: AudioNode;
  readonly time: number;
}

interface SpyVoice extends Voice {
  readonly calls: TriggerCall[];
}

function createSpyVoice(): SpyVoice {
  const calls: TriggerCall[] = [];
  return {
    calls,
    trigger: (_ctx, destination, time) => {
      calls.push({ destination, time });
    },
  };
}

function patternWith(track: TrackId, steps: readonly number[]): Pattern {
  return steps.reduce<Pattern>(
    (pattern, step) => toggleStep(pattern, track, step),
    createEmptyPattern(),
  );
}

const ALL_STEPS = Array.from({ length: STEP_COUNT }, (_, step) => step);

interface Harness {
  readonly fake: FakeAudioContext;
  readonly master: FakeGainNode;
  readonly transport: Transport;
  readonly state: { pattern: Pattern; bpm: number };
  readonly scheduled: (readonly { step: number; time: number }[])[];
  /** Advance the audio clock and the fake timers together. */
  advance(ms: number): void;
  sessionGains(): FakeGainNode[];
}

function setup(
  options: {
    voices?: VoiceMap;
    pattern?: Pattern;
    bpm?: number;
    onScheduled?: (steps: readonly { step: number; time: number }[]) => void;
  } = {},
): Harness {
  const fake = createFakeAudioContext();
  const master = fake.createGain();
  const state = {
    pattern: options.pattern ?? patternWith("kick", ALL_STEPS),
    bpm: options.bpm ?? 120,
  };
  const scheduled: (readonly { step: number; time: number }[])[] = [];
  const transport = createTransport({
    ctx: asAudioContext(fake),
    master: master as unknown as AudioNode,
    voices: options.voices ?? { kick: createSpyVoice() },
    getState: () => state,
    onScheduled: (steps) => {
      scheduled.push(steps);
      options.onScheduled?.(steps);
    },
  });
  return {
    fake,
    master,
    transport,
    state,
    scheduled,
    advance: (ms) => {
      // Step in timer-sized slices so every tick sees a moving clock.
      let remaining = ms;
      while (remaining > 0) {
        const slice = Math.min(TICK_INTERVAL_MS, remaining);
        fake.advance(slice / 1000);
        vi.advanceTimersByTime(slice);
        remaining -= slice;
      }
    },
    sessionGains: () =>
      fake.nodesOfType("gain").filter((node) => node !== master),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTransport", () => {
  it("does nothing until start() is called", () => {
    const kick = createSpyVoice();
    const h = setup({ voices: { kick } });

    h.advance(1000);

    expect(vi.getTimerCount()).toBe(0);
    expect(kick.calls).toEqual([]);
    expect(h.sessionGains()).toEqual([]);
  });

  describe("start()", () => {
    it("creates a session gain connected to master", () => {
      const h = setup();

      h.transport.start();

      const [session] = h.sessionGains();
      expect(h.sessionGains()).toHaveLength(1);
      expect(session?.connections).toEqual([h.master]);
    });

    it("schedules step 0 at currentTime + START_DELAY_SECONDS on the first tick", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick }, pattern: patternWith("kick", [0]) });
      h.fake.currentTime = 3;

      h.transport.start();

      expect(kick.calls.map((c) => c.time)).toEqual([3 + START_DELAY_SECONDS]);
      expect(h.scheduled).toEqual([
        [{ step: 0, time: 3 + START_DELAY_SECONDS }],
      ]);
    });

    it("connects voices to the session gain, not to master", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick } });

      h.transport.start();

      const [session] = h.sessionGains();
      expect(kick.calls.length).toBeGreaterThan(0);
      for (const call of kick.calls) {
        expect(call.destination).toBe(session);
      }
    });

    it("keeps exactly one pending timer while playing", () => {
      const h = setup();

      h.transport.start();
      expect(vi.getTimerCount()).toBe(1);

      h.advance(500);
      expect(vi.getTimerCount()).toBe(1);
    });

    it("is a no-op while already playing (no second timer or session gain)", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick } });

      h.transport.start();
      const callsAfterFirstStart = kick.calls.length;
      h.transport.start();
      h.transport.start();

      expect(vi.getTimerCount()).toBe(1);
      expect(h.sessionGains()).toHaveLength(1);
      expect(kick.calls).toHaveLength(callsAfterFirstStart);
    });

    it("triggers each step exactly once, at exact grid times, over many ticks", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick }, bpm: 120 });

      h.transport.start();
      h.advance(2000);

      // 120 BPM → 0.125 s per 16th. Clock is at 2.0 s; horizon 2.1 s.
      const times = kick.calls.map((c) => c.time);
      const expected = Array.from(
        { length: times.length },
        (_, i) => START_DELAY_SECONDS + i * 0.125,
      );
      expect(times.length).toBe(17); // steps at 0.05 … 2.05
      times.forEach((t, i) => expect(t).toBeCloseTo(expected[i] ?? NaN, 9));
    });

    it("wraps from step 15 back to step 0", () => {
      const h = setup({ bpm: 120 });

      h.transport.start();
      h.advance(2000);

      const steps = h.scheduled.flat().map((s) => s.step);
      expect(steps).toEqual([...ALL_STEPS, 0]);
    });
  });

  describe("tick", () => {
    it("triggers only the tracks active at each step", () => {
      const kick = createSpyVoice();
      const snare = createSpyVoice();
      const pattern = toggleStep(patternWith("kick", [0, 2]), "snare", 1);
      const h = setup({ voices: { kick, snare }, pattern });

      h.transport.start();
      h.advance(300); // steps 0..2 due (step 2 at 0.3 s)

      expect(kick.calls.map((c) => c.time)).toEqual([0.05, 0.3]);
      expect(snare.calls.map((c) => c.time)).toEqual([0.175]);
    });

    it("skips tracks without a registered voice without throwing", () => {
      const kick = createSpyVoice();
      const pattern = ALL_STEPS.reduce(
        (p, step) => toggleStep(toggleStep(p, "clap", step), "hihat", step),
        patternWith("kick", [0]),
      );
      const h = setup({ voices: { kick }, pattern });

      expect(() => {
        h.transport.start();
        h.advance(500);
      }).not.toThrow();
      expect(kick.calls).toHaveLength(1);
      expect(h.scheduled.flat().length).toBeGreaterThan(1);
    });

    it("reports every scheduled step (even silent ones) as { step, time }", () => {
      const h = setup({ pattern: createEmptyPattern() });

      h.transport.start();

      expect(h.scheduled).toEqual([[{ step: 0, time: START_DELAY_SECONDS }]]);
      expect(Object.keys(h.scheduled[0]?.[0] ?? {})).toEqual(["step", "time"]);
    });

    it("does not call onScheduled when no step is due", () => {
      const h = setup();

      h.transport.start(); // step 0 due
      h.advance(TICK_INTERVAL_MS); // now 0.025, horizon 0.125 < 0.175

      expect(h.scheduled).toHaveLength(1);
    });

    it("reads BPM fresh so a change applies from the next tick", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick }, bpm: 120 });

      h.transport.start(); // step 0 @ 0.05; next step 1 @ 0.175 (old d)
      h.state.bpm = 60; // d = 0.25 s
      h.advance(500); // clock 0.5, horizon 0.6

      // Step 1 keeps its already-computed time; the new duration applies after it.
      expect(kick.calls.map((c) => c.time)).toEqual([0.05, 0.175, 0.425]);
    });

    it("reads the pattern fresh on every tick", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick }, pattern: createEmptyPattern() });

      h.transport.start();
      h.state.pattern = patternWith("kick", [1]);
      h.advance(100);

      expect(kick.calls.map((c) => c.time)).toEqual([0.175]);
    });

    it("re-aligns after a throttled tab instead of bursting missed steps", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick }, bpm: 120 });

      h.transport.start(); // step 0 @ 0.05
      // Tab throttled: the audio clock runs 10 s ahead before the next wake-up.
      h.fake.advance(10);
      vi.advanceTimersByTime(TICK_INTERVAL_MS);

      // now = 10.0, horizon 10.1: k = 79 steps skipped, only step 0 @ 10.05 is due.
      expect(kick.calls.map((c) => c.time)).toEqual([0.05, 10.05]);
      expect(h.scheduled.at(-1)).toEqual([{ step: 0, time: 10.05 }]);
    });
  });

  describe("stop()", () => {
    it("clears the timer", () => {
      const h = setup();
      h.transport.start();

      h.transport.stop();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("disconnects the session gain", () => {
      const h = setup();
      h.transport.start();
      const [session] = h.sessionGains();

      h.transport.stop();

      expect(session?.disconnectCalls).toBe(1);
      expect(session?.connections).toEqual([]);
    });

    it("triggers no voice and reports nothing once stopped", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick } });
      h.transport.start();
      h.advance(300);
      const voiceCalls = kick.calls.length;
      const reports = h.scheduled.length;

      h.transport.stop();
      h.advance(2000);

      expect(kick.calls).toHaveLength(voiceCalls);
      expect(h.scheduled).toHaveLength(reports);
    });

    it("is a no-op when not playing", () => {
      const h = setup();

      expect(() => h.transport.stop()).not.toThrow();
      h.transport.start();
      h.transport.stop();
      h.transport.stop();

      expect(h.sessionGains()[0]?.disconnectCalls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("lets the next start() begin at step 0 on a fresh session gain", () => {
      const kick = createSpyVoice();
      const h = setup({ voices: { kick } });
      h.transport.start();
      h.advance(600);
      h.transport.stop();
      h.fake.currentTime = 5;

      h.transport.start();

      const sessions = h.sessionGains();
      expect(sessions).toHaveLength(2);
      const [first, second] = sessions;
      expect(second).not.toBe(first);
      expect(second?.connections).toEqual([h.master]);
      expect(h.scheduled.at(-1)).toEqual([
        { step: 0, time: 5 + START_DELAY_SECONDS },
      ]);
      expect(kick.calls.at(-1)?.destination).toBe(second);
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe("robustness", () => {
    it("keeps the loop and other voices running when a voice throws", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const snare = createSpyVoice();
      const broken: Voice = {
        trigger: () => {
          throw new Error("boom");
        },
      };
      const pattern = ALL_STEPS.reduce(
        (p, step) => toggleStep(p, "snare", step),
        patternWith("kick", ALL_STEPS),
      );
      const h = setup({ voices: { kick: broken, snare }, pattern });

      expect(() => {
        h.transport.start();
        h.advance(500);
      }).not.toThrow();

      // Steps at 0.05 … 0.55 (horizon 0.6): 5 steps, none lost or repeated.
      expect(snare.calls.map((c) => c.time)).toEqual([
        0.05, 0.175, 0.3, 0.425, 0.55,
      ]);
      expect(h.scheduled.flat()).toHaveLength(5);
      expect(vi.getTimerCount()).toBe(1);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it("does not reschedule when stop() is called from inside a tick", () => {
      const ref: { transport?: Transport } = {};
      const h = setup({
        onScheduled: () => ref.transport?.stop(),
      });
      ref.transport = h.transport;

      h.transport.start();

      expect(vi.getTimerCount()).toBe(0);
      expect(h.sessionGains()[0]?.disconnectCalls).toBe(1);
    });

    it("keeps a single timer when stop() and start() run inside a tick", () => {
      const ref: { transport?: Transport } = {};
      let restarts = 0;
      const h = setup({
        onScheduled: () => {
          if (restarts < 1) {
            restarts += 1;
            ref.transport?.stop();
            ref.transport?.start();
          }
        },
      });
      ref.transport = h.transport;

      h.transport.start();

      expect(vi.getTimerCount()).toBe(1);
      expect(h.sessionGains()).toHaveLength(2);
    });
  });
});
