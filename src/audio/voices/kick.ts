/**
 * Kick drum voice — and the TEMPLATE every other voice (snare, hihat, clap)
 * follows. Reviewers check new voices against these conventions:
 *
 * 1. Parameters are plain data: one `<NAME>_PARAMS` constant, `Object.freeze`d,
 *    numbers only, units in the key names (`...Hz`, `...Seconds`, `...Gain`).
 *    A test asserts each value's musically sensible range. No magic numbers
 *    in `trigger()`.
 * 2. Export a frozen `<name>Voice: Voice` object. It holds no state: `trigger()`
 *    creates fresh nodes for every hit and keeps no references to them (no
 *    module-level or closure caches; the only shared resource allowed is the
 *    per-context noise buffer from `noise.ts`).
 * 3. Wiring: sources → (filters) → per-hit envelope gain → `destination`.
 *    Connect only to the `destination` argument (the transport's session gain)
 *    — never to `ctx.destination` or a master node — so `transport.stop()`
 *    can silence everything by disconnecting the session gain.
 * 4. Timing: every schedule is relative to the `time` argument. Never read
 *    `ctx.currentTime` (or any other clock). Each source gets exactly one
 *    `start(time)` and one `stop(time + envelope length + stopMarginSeconds)`
 *    so nodes are released once silent and the envelope tail is never cut.
 * 5. Envelopes: anchor with `setValueAtTime(value, time)` before any ramp.
 *    Start the gain at `silentGain` (0.001) and ramp exponentially to the
 *    peak (a few ms of attack avoids clicks), then
 *    `exponentialRampToValueAtTime(silentGain, ...)`. Exponential ramps must
 *    never target 0 (it throws / is undefined); use 0.001.
 * 6. Peak gain ≤ 1; mixing headroom lives in the master gain, not the voice.
 * 7. Tests (`<name>.test.ts`) use the fake `AudioContext` from
 *    `../testing/fake-audio-context` and assert: node kinds and count, exact
 *    connection graph (nothing else connected), AudioParam call sequences,
 *    `start`/`stop` times, no ramp targeting 0, no
 *    `ctx.currentTime` read, and independence of two consecutive triggers.
 */
import type { Voice } from "./voice";

/** Kick sound parameters: plain, frozen data (seconds, Hz, linear gain). */
export const KICK_PARAMS = Object.freeze({
  startFrequencyHz: 150,
  endFrequencyHz: 50,
  pitchDropSeconds: 0.1,
  attackSeconds: 0.005,
  decaySeconds: 0.5,
  peakGain: 1,
  silentGain: 0.001,
  stopMarginSeconds: 0.05,
});

/** Sine oscillator with an exponential pitch drop through a percussive envelope. */
export const kickVoice: Voice = Object.freeze({
  trigger(ctx: BaseAudioContext, destination: AudioNode, time: number): void {
    const p = KICK_PARAMS;
    const peakTime = time + p.attackSeconds;
    const endTime = peakTime + p.decaySeconds;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.startFrequencyHz, time);
    osc.frequency.exponentialRampToValueAtTime(
      p.endFrequencyHz,
      time + p.pitchDropSeconds,
    );

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(p.silentGain, time);
    envelope.gain.exponentialRampToValueAtTime(p.peakGain, peakTime);
    envelope.gain.exponentialRampToValueAtTime(p.silentGain, endTime);

    osc.connect(envelope);
    envelope.connect(destination);

    osc.start(time);
    osc.stop(endTime + p.stopMarginSeconds);
  },
});
