import { LocalDatabase } from './local-database'

/** Node's `process`, which only exists under the spec runner (the app's types leave it out). */
const cwd = (): string => (globalThis as unknown as { process: { cwd(): string } }).process.cwd()

/**
 * Specs only: the real SQLite build, read from `node_modules` (jsdom has no `/sqlite/`). Each call
 * is a fresh in-memory database with the current schema.
 */
export const openTestDatabase = async (
  snapshot?: Uint8Array<ArrayBuffer>
): Promise<LocalDatabase> =>
  LocalDatabase.open(snapshot, `${cwd()}/node_modules/@sqlite.org/sqlite-wasm/dist/`)
