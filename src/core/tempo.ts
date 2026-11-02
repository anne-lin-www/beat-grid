export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 120;

const STEPS_PER_BEAT = 4;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return DEFAULT_BPM;
  }
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function stepDurationSeconds(bpm: number): number {
  return 60 / bpm / STEPS_PER_BEAT;
}
