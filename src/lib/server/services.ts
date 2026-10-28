import "server-only";
import { memoryStore, type KeyValueStore } from "../cache";
import { ImportService } from "../catalog/importService";
import { createClaudePrereqResolver } from "../catalog/llm/prereqLlm";
import { CatalogStore } from "../catalog/store";

/**
 * Process-wide services for route handlers. Only the data (the in-memory
 * key-value store) lives on globalThis, so imports survive dev hot reloads;
 * the services themselves are rebuilt when this module reloads, so code
 * changes take effect without restarting. Data still resets on server
 * restart until the Supabase-backed store replaces it.
 */
const g = globalThis as unknown as { __kv?: KeyValueStore };

interface Services {
  store: CatalogStore;
  importer: ImportService;
}

let cached: Services | undefined;

export function services(): Services {
  if (!cached) {
    const kv = (g.__kv ??= memoryStore());
    const store = new CatalogStore(kv);
    // The LLM prerequisite fallback is used only when an API key is configured.
    const resolver = process.env.ANTHROPIC_API_KEY ? createClaudePrereqResolver({ cache: kv }) : undefined;
    cached = { store, importer: new ImportService(store, resolver) };
  }
  return cached;
}
