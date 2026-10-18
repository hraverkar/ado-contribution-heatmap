/**
 * Bounded-parallelism helpers.
 *
 * Repository scans fan out across many repositories at once, but Azure DevOps
 * throttles aggressive callers, so every fan-out goes through a fixed-size
 * worker pool rather than `Promise.all` over the whole list.
 */

export interface ConcurrencyOptions<T> {
  /** Maximum tasks in flight. Values below 1 are treated as 1. */
  readonly limit: number;
  /** Invoked after each task settles, with the number completed so far. */
  readonly onProgress?: (completed: number, total: number, item: T) => void;
  /** When set, remaining tasks are skipped once the signal aborts. */
  readonly signal?: AbortSignal;
}

/**
 * Runs `worker` over `items` with at most `limit` concurrent executions,
 * returning results in input order.
 *
 * A rejected worker rejects the whole call; callers that want partial results
 * should catch inside `worker` and return a result object instead.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: ConcurrencyOptions<T>,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) {
    return results;
  }

  const limit = Math.max(1, Math.min(Math.trunc(options.limit) || 1, total));
  let nextIndex = 0;
  let completed = 0;

  const runWorker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) {
        return;
      }
      const item = items[index] as T;
      results[index] = await worker(item, index);
      completed += 1;
      options.onProgress?.(completed, total, item);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

/** Promise-based delay that rejects if the signal aborts first. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
