/**
 * ArcPulse index database (SQLite via bun:sqlite).
 * One process owns this file: the API server and the indexer run together in server/index.ts.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CONFIG } from './env'

if (CONFIG.databasePath !== ':memory:') mkdirSync(dirname(CONFIG.databasePath), { recursive: true })

export const db = new Database(CONFIG.databasePath, { create: true })
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')

const integrity = db.query('PRAGMA quick_check').get() as { quick_check?: string } | null
if (integrity?.quick_check !== 'ok') {
  throw new Error(
    `Database integrity check failed (${integrity?.quick_check ?? 'unknown'}). Stop and restore ${CONFIG.databasePath} from a backup; ArcPulse will not delete or rebuild it automatically.`,
  )
}

db.exec(`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per fixed block range (id = floor(block / batchBlocks)). Rewriting a row is idempotent.
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  start_block INTEGER NOT NULL,
  end_block INTEGER NOT NULL,
  ts_start INTEGER NOT NULL,
  ts_end INTEGER NOT NULL,
  blocks INTEGER NOT NULL,
  txs INTEGER NOT NULL,
  gas_used REAL NOT NULL,
  gas_limit REAL NOT NULL,
  base_fee_sum REAL NOT NULL,
  creations INTEGER NOT NULL,
  native_count INTEGER NOT NULL,
  native_vol REAL NOT NULL,
  erc20_count INTEGER NOT NULL,
  erc20_vol REAL NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_ts ON batches(ts_start);

-- Transfers at or above the store floor, decoded from Transfer events.
-- kind 'native' = 18-decimal native USDC (system emitter), 'erc20' = 6-decimal USDC contract.
CREATE TABLE IF NOT EXISTS transfers (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('native','erc20')),
  block INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  raw TEXT NOT NULL,
  usdc REAL NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_kind_usdc ON transfers(kind, usdc);
CREATE INDEX IF NOT EXISTS idx_transfers_ts ON transfers(ts);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_addr);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_addr);

CREATE TABLE IF NOT EXISTS contract_activity (
  batch_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  tx_count INTEGER NOT NULL,
  PRIMARY KEY (batch_id, address)
);
CREATE INDEX IF NOT EXISTS idx_activity_addr ON contract_activity(address);

-- Immutable token metadata read from the token contract itself.
CREATE TABLE IF NOT EXISTS token_meta (
  address TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  fetched_at INTEGER NOT NULL
);
`)

export const getMeta = (key: string): string | null => {
  const row = db.query('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | null
  return row?.value ?? null
}

export const setMeta = (key: string, value: string): void => {
  db.query('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
