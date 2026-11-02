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
