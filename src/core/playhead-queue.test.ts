import { describe, expect, it } from "vitest";
import {
  clearQueue,
  currentStepAt,
  enqueue,
  type PlayheadQueue,
} from "./playhead-queue";

const queue: PlayheadQueue = [
  { step: 0, time: 1.0 },
  { step: 1, time: 1.125 },
  { step: 2, time: 1.25 },
];

describe("enqueue", () => {
  it("appends items without mutating the input", () => {
    const base: PlayheadQueue = [{ step: 0, time: 1 }];
    const snapshot = structuredClone(base);
    const result = enqueue(base, [{ step: 1, time: 2 }]);
    expect(result).toEqual([
      { step: 0, time: 1 },
      { step: 1, time: 2 },
    ]);
    expect(base).toEqual(snapshot);
    expect(result).not.toBe(base);
  });
});

describe("currentStepAt", () => {
  it("returns null step and the same queue when now is before the first item", () => {
    const result = currentStepAt(queue, 0.5);
    expect(result.step).toBeNull();
    expect(result.queue).toEqual(queue);
  });

  it("returns null for an empty queue", () => {
    expect(currentStepAt([], 1)).toEqual({ step: null, queue: [] });
  });

  it("returns the item at exactly now", () => {
    expect(currentStepAt(queue, 1.0).step).toBe(0);
  });

  it("returns the earlier item between two items and drops strictly older ones", () => {
    const result = currentStepAt(queue, 1.2);
    expect(result.step).toBe(1);
    expect(result.queue).toEqual([
      { step: 1, time: 1.125 },
      { step: 2, time: 1.25 },
    ]);
  });

  it("keeps the current item so later calls still resolve", () => {
    const first = currentStepAt(queue, 1.2);
    expect(currentStepAt(first.queue, 1.2).step).toBe(1);
  });

  it("returns the last item when now is past all items", () => {
    const result = currentStepAt(queue, 9);
    expect(result.step).toBe(2);
    expect(result.queue).toEqual([{ step: 2, time: 1.25 }]);
  });

  it("does not mutate the input queue", () => {
    const snapshot = structuredClone(queue);
    currentStepAt(queue, 1.2);
    expect(queue).toEqual(snapshot);
  });
});

describe("clearQueue", () => {
  it("returns an empty queue so currentStepAt yields null", () => {
    const cleared = clearQueue();
    expect(cleared).toEqual([]);
    expect(currentStepAt(cleared, 5).step).toBeNull();
  });
});
