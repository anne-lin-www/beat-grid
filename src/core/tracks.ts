export const STEP_COUNT = 16;
export const TRACK_IDS = ["kick", "snare", "hihat", "clap"] as const;
export type TrackId = (typeof TRACK_IDS)[number];
