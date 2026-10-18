/**
 * In-memory, session-scoped caching.
 *
 * Everything cached here lives in JavaScript memory for the life of the page:
 * nothing is written to disk, cookies, or any remote store, and reloading the
 * hub starts from empty. That keeps repeated interactions — switching
 * repositories, narrowing the date range, sorting — free of network traffic
 * without persisting Azure DevOps data anywhere.
 */

import { CACHE_TTL_MS } from '../config/constants.js';

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export interface MemoryCacheOptions {
  readonly ttlMs?: number;
  /** Injected for tests. */
  readonly now?: () => number;
}

/** Small TTL map. Expired entries are dropped lazily on read. */
export class MemoryCache<V> {
  private readonly entries = new Map<string, CacheEntry<V>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
