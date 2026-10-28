/**
 * Minimal async key-value store. In-memory for now; a Supabase-backed
 * implementation will satisfy the same interface once hosting is set up.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  /** Keys starting with `prefix`. */
  keys(prefix: string): Promise<string[]>;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async keys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}
