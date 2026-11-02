const NOISE_DURATION_SECONDS = 1;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** White-noise buffer (mono, 1 s), created once per context and cached. */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached !== undefined) {
    return cached;
  }
  const length = Math.round(ctx.sampleRate * NOISE_DURATION_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.random() * 2 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}
