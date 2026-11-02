export type PlayheadItem = { readonly step: number; readonly time: number };
export type PlayheadQueue = readonly PlayheadItem[];

export function enqueue(
  queue: PlayheadQueue,
  items: readonly PlayheadItem[],
): PlayheadQueue {
  return [...queue, ...items];
}

export function currentStepAt(
  queue: PlayheadQueue,
  now: number,
): { step: number | null; queue: PlayheadQueue } {
  let currentIndex = -1;
  queue.forEach((item, index) => {
    if (item.time <= now) currentIndex = index;
  });
  if (currentIndex === -1) return { step: null, queue };
  const current = queue[currentIndex] as PlayheadItem;
  return { step: current.step, queue: queue.slice(currentIndex) };
}

export function clearQueue(): PlayheadQueue {
  return [];
}
