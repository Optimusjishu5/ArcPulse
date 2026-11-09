# ArcPulse

Blockchain intelligence for Arc Mainnet (chain ID 5042): live blocks and transactions, native and ERC-20 USDC flows, a whale tracker, wallet and contract lookups, and historical analytics from its own block indexer. It is read-only and uses no custom smart contract.

Built with [Arc Studio](https://studio.arc.io)

## What it shows

- Dashboard with live network health, KPI cards with sparklines, a USDC transfer flow chart, transaction mix, connection status, 24H, 7D, 30D and 90D filters and CSV export
- Whale tracker with configurable thresholds, separate native and ERC-20 transfers, filters and pagination
- Wallet search with separate native (18 decimals) and ERC-20 (6 decimals) USDC balances, token holdings, transfer history and activity chart
- Token and contract explorer with Sourcify verification status and explorer links
- Light, dark and system themes, remembered per browser
- Status page with RPC provider checks, indexer progress and missing production configuration
- Wallet connection for MetaMask, Rabby, Coinbase Wallet and WalletConnect wallets (WalletConnect needs a project id)

No prices, market caps or holder counts are shown because no verified source for them is configured.

## Tech stack

React 18, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit. Backend: Bun with a SQLite index database.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run server   # API + indexer on port 3001
bun run dev      # frontend on port 5173, proxies /api to the server
```

Production:

```bash
bun run build
bun run start    # serves the built app, the API and the indexer from one process
```

Checks: `bun run check` (lint and typecheck).

## Environment variables

All optional unless noted. Never commit values.

| Name | Purpose |
| --- | --- |
| `ARC_MAINNET_RPC_URL` | Dedicated Arc Mainnet RPC endpoint. Strongly recommended for production |
| `ARC_MAINNET_RPC_FALLBACK_URL` | Second Arc Mainnet provider, used when the primary fails. Every provider must return chain ID `0x13b2` or it is refused |
| `RPC_URL_Arc` | Alternative name for the primary endpoint |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Provisioned by Arc Studio in its sandbox. Optional outside Arc Studio |
| `PORT` | Server port (default 3001) |
| `DATABASE_PATH` | SQLite file location (default `data/arcpulse.db`). Use a persistent volume in production |
| `ARCPULSE_ADMIN_TOKEN` | Bearer token for `/api/admin/*`. Admin endpoints are disabled when unset |
| `ERROR_WEBHOOK_URL` | Receives server and browser error reports as JSON |
| `API_RATE_LIMIT_PER_MINUTE` | Per-IP request budget (default 240) |
| `INDEXER_ENABLED` | Set to `false` to run the API without indexing |
| `INDEX_HISTORY_DAYS` | Days of history to keep and backfill (default 90) |
| `INDEX_BACKFILL_CONCURRENCY`, `INDEX_BACKFILL_DELAY_MS` | Backfill speed controls |
| `INDEX_MIN_TRANSFER_USDC` | Transfers at or above this amount are stored individually for the whale tracker (default 1000) |
| `LIVE_STALE_AFTER_SECONDS` | Head age after which data is marked stale (default 20) |
| `VITE_API_BASE_URL` | Address of the ArcPulse server when the interface is hosted separately (for example on a static host). Empty means same origin |
| `ARCPULSE_ALLOWED_ORIGIN` | Comma-separated site origins allowed to call the API from another domain |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project id from cloud.walletconnect.com. WalletConnect is hidden without it |

## Production notes

- Historical charts fill as the indexer backfills from newest to oldest. The Status page shows exact coverage for each window; a 90-day window takes hours to complete on a rate-limited endpoint and is much faster with a dedicated RPC.
- Run one server process per database file.
- Admin: `POST /api/admin/reindex?from=<block>&to=<block>` with `Authorization: Bearer <token>` reprocesses a block range.
