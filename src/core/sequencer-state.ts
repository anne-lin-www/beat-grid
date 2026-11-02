import {
  clearPattern,
  createEmptyPattern,
  toggleStep,
  type Pattern,
} from "./pattern";
import { clampBpm, DEFAULT_BPM } from "./tempo";
import type { TrackId } from "./tracks";

export interface AppState {
  readonly pattern: Pattern;
  readonly bpm: number;
  readonly isPlaying: boolean;
}

export type Action =
  | {
      readonly type: "toggleStep";
      readonly track: TrackId;
      readonly step: number;
    }
  | { readonly type: "clearAll" }
  | { readonly type: "setBpm"; readonly bpm: number }
  | { readonly type: "play" }
  | { readonly type: "stop" };

export function initialState(): AppState {
  return {
    pattern: createEmptyPattern(),
    bpm: DEFAULT_BPM,
    isPlaying: false,
  };
}

// No default branch: the return type makes tsc reject a non-exhaustive switch.
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "toggleStep": {
      const pattern = toggleStep(state.pattern, action.track, action.step);
      return pattern === state.pattern ? state : { ...state, pattern };
    }
    case "clearAll":
      return { ...state, pattern: clearPattern() };
    case "setBpm": {
      const bpm = clampBpm(action.bpm);
      return bpm === state.bpm ? state : { ...state, bpm };
    }
    case "play":
      return state.isPlaying ? state : { ...state, isPlaying: true };
    case "stop":
      return state.isPlaying ? { ...state, isPlaying: false } : state;
  }
}
