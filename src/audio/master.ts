export const MASTER_GAIN = 0.8;

/** Master output stage: gain node connected to the context destination. */
export function createMaster(ctx: BaseAudioContext): GainNode {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  return master;
}
