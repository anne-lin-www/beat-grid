// Composition root. TEMPORARY M1 wiring (kick only); T3.6 replaces it.
import "../ui/styles.css";
import { ensureAudioContext } from "../audio/audio-unlock";
import { createMaster } from "../audio/master";
import { createTransport } from "../audio/transport";
import { kickVoice } from "../audio/voices/kick";
import { createEmptyPattern, toggleStep } from "../core/pattern";
import { DEFAULT_BPM } from "../core/tempo";
import { mountM1 } from "./m1-app";

const KICK_STEPS = [0, 4, 8, 12] as const;
const pattern = KICK_STEPS.reduce(
  (current, step) => toggleStep(current, "kick", step),
  createEmptyPattern(),
);

const root = document.getElementById("app");
if (root !== null) {
  mountM1(root, {
    ensureAudioContext,
    createTransport: (ctx) =>
      createTransport({
        ctx,
        master: createMaster(ctx),
        voices: { kick: kickVoice },
        getState: () => ({ pattern, bpm: DEFAULT_BPM }),
        onScheduled: () => {},
      }),
  });
}
