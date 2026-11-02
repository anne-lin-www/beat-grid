import type { TrackId } from "../../core/tracks";

/** A drum sound. Every implementation is interchangeable behind this method. */
export interface Voice {
  trigger(ctx: BaseAudioContext, destination: AudioNode, time: number): void;
}

/** Voices by track; tracks without a registered voice are skipped by the transport. */
export type VoiceMap = Partial<Readonly<Record<TrackId, Voice>>>;
