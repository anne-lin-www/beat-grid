/**
 * Test-only fake of the Web Audio API. Records created nodes, connections,
 * start/stop calls and AudioParam scheduling. Never import from production code.
 */

export type FakeNodeKind =
  "destination" | "oscillator" | "gain" | "biquadFilter" | "bufferSource";

export type FakeParamMethod =
  | "setValueAtTime"
  | "linearRampToValueAtTime"
  | "exponentialRampToValueAtTime"
  | "setTargetAtTime"
  | "cancelScheduledValues";

export interface FakeParamCall {
  readonly method: FakeParamMethod;
  readonly args: readonly number[];
}

export interface FakeAudioParam {
  value: number;
  readonly calls: FakeParamCall[];
  setValueAtTime(value: number, time: number): FakeAudioParam;
  linearRampToValueAtTime(value: number, time: number): FakeAudioParam;
  exponentialRampToValueAtTime(value: number, time: number): FakeAudioParam;
  setTargetAtTime(
    target: number,
    time: number,
    timeConstant: number,
  ): FakeAudioParam;
  cancelScheduledValues(time: number): FakeAudioParam;
}

export interface FakeAudioNode {
  readonly kind: FakeNodeKind;
  /** Current outgoing connections (cleared by disconnect()). */
  connections: FakeAudioNode[];
  disconnectCalls: number;
  connect<T extends FakeAudioNode>(target: T): T;
  disconnect(): void;
}

export interface FakeSourceNode extends FakeAudioNode {
  readonly startCalls: number[];
  readonly stopCalls: number[];
  start(time?: number): void;
  stop(time?: number): void;
}

export interface FakeOscillatorNode extends FakeSourceNode {
  readonly kind: "oscillator";
  type: OscillatorType;
  readonly frequency: FakeAudioParam;
  readonly detune: FakeAudioParam;
}

export interface FakeGainNode extends FakeAudioNode {
  readonly kind: "gain";
  readonly gain: FakeAudioParam;
}

export interface FakeBiquadFilterNode extends FakeAudioNode {
  readonly kind: "biquadFilter";
  type: BiquadFilterType;
  readonly frequency: FakeAudioParam;
  readonly detune: FakeAudioParam;
  readonly Q: FakeAudioParam;
  readonly gain: FakeAudioParam;
}

export interface FakeBufferSourceNode extends FakeSourceNode {
  readonly kind: "bufferSource";
  buffer: FakeAudioBuffer | null;
  loop: boolean;
  readonly playbackRate: FakeAudioParam;
}

export interface FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export type FakeCreatedNode =
  | FakeOscillatorNode
  | FakeGainNode
  | FakeBiquadFilterNode
  | FakeBufferSourceNode;

export interface FakeAudioContext {
  currentTime: number;
  state: AudioContextState;
  readonly sampleRate: number;
  readonly destination: FakeAudioNode;
  /** Every node created through a create* method, in creation order. */
  readonly nodes: FakeCreatedNode[];
  resumeCalls: number;
  advance(seconds: number): void;
  resume(): Promise<void>;
  nodesOfType<K extends FakeCreatedNode["kind"]>(
    kind: K,
  ): Extract<FakeCreatedNode, { kind: K }>[];
  createOscillator(): FakeOscillatorNode;
  createGain(): FakeGainNode;
  createBiquadFilter(): FakeBiquadFilterNode;
  createBufferSource(): FakeBufferSourceNode;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeAudioBuffer;
}

export interface FakeAudioContextOptions {
  readonly sampleRate?: number;
}

const DEFAULT_SAMPLE_RATE = 44100;

function createParam(initialValue: number): FakeAudioParam {
  const calls: FakeParamCall[] = [];
  const record = (method: FakeParamMethod, args: readonly number[]) => {
    calls.push({ method, args });
    return param;
  };
  const param: FakeAudioParam = {
    value: initialValue,
    calls,
    setValueAtTime: (value, time) => record("setValueAtTime", [value, time]),
    linearRampToValueAtTime: (value, time) =>
      record("linearRampToValueAtTime", [value, time]),
    exponentialRampToValueAtTime: (value, time) =>
      record("exponentialRampToValueAtTime", [value, time]),
    setTargetAtTime: (target, time, timeConstant) =>
      record("setTargetAtTime", [target, time, timeConstant]),
    cancelScheduledValues: (time) => record("cancelScheduledValues", [time]),
  };
  return param;
}

function createNodeBase(kind: FakeNodeKind): FakeAudioNode {
  const node: FakeAudioNode = {
    kind,
    connections: [],
    disconnectCalls: 0,
    connect: (target) => {
      node.connections.push(target);
      return target;
    },
    disconnect: () => {
      node.disconnectCalls += 1;
      node.connections = [];
    },
  };
  return node;
}

function createSourceBase(kind: FakeNodeKind) {
  const startCalls: number[] = [];
  const stopCalls: number[] = [];
  return Object.assign(createNodeBase(kind), {
    startCalls,
    stopCalls,
    start: (time = 0) => {
      startCalls.push(time);
    },
    stop: (time = 0) => {
      stopCalls.push(time);
    },
  });
}

function createFakeBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): FakeAudioBuffer {
  const channels = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(length),
  );
  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel) => {
      const data = channels[channel];
      if (data === undefined) {
        throw new RangeError(`No channel ${channel}`);
      }
      return data;
    },
  };
}

export function createFakeAudioContext(
  options: FakeAudioContextOptions = {},
): FakeAudioContext {
  const nodes: FakeCreatedNode[] = [];
  const track = <T extends FakeCreatedNode>(node: T): T => {
    nodes.push(node);
    return node;
  };

  const ctx: FakeAudioContext = {
    currentTime: 0,
    state: "suspended",
    sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
    destination: createNodeBase("destination"),
    nodes,
    resumeCalls: 0,
    advance: (seconds) => {
      ctx.currentTime += seconds;
    },
    resume: () => {
      ctx.resumeCalls += 1;
      ctx.state = "running";
      return Promise.resolve();
    },
    nodesOfType: <K extends FakeCreatedNode["kind"]>(kind: K) =>
      nodes.filter(
        (node): node is Extract<FakeCreatedNode, { kind: K }> =>
          node.kind === kind,
      ),
    createOscillator: () =>
      track(
        Object.assign(createSourceBase("oscillator"), {
          kind: "oscillator" as const,
          type: "sine" as OscillatorType,
          frequency: createParam(440),
          detune: createParam(0),
        }),
      ),
    createGain: () =>
      track(
        Object.assign(createNodeBase("gain"), {
          kind: "gain" as const,
          gain: createParam(1),
        }),
      ),
    createBiquadFilter: () =>
      track(
        Object.assign(createNodeBase("biquadFilter"), {
          kind: "biquadFilter" as const,
          type: "lowpass" as BiquadFilterType,
          frequency: createParam(350),
          detune: createParam(0),
          Q: createParam(1),
          gain: createParam(0),
        }),
      ),
    createBufferSource: () =>
      track(
        Object.assign(createSourceBase("bufferSource"), {
          kind: "bufferSource" as const,
          buffer: null as FakeAudioBuffer | null,
          loop: false,
          playbackRate: createParam(1),
        }),
      ),
    createBuffer: createFakeBuffer,
  };
  return ctx;
}

/** The single boundary cast: lets code under test receive the fake as a real AudioContext. */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}
