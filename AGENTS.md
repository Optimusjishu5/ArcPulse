# ArcPulse

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

ArcPulse is a read-only Arc Mainnet (chain 5042) intelligence platform: live blocks/txs, native vs ERC-20 USDC flows, whale tracker, wallet and contract lookups, indexed historical analytics. No custom smart contract.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, Rabby), Coinbase Wallet, WalletConnect (needs VITE_WALLETCONNECT_PROJECT_ID)
- Chain: Arc Mainnet only (Chain ID 5042), defined in `src/config.ts` from `@/onchain-facts`
- Token: USDC, ERC-20 view 6 decimals, native gas view 18 decimals. Always shown separately, never summed.
- Backend: Bun server in `server/` (API, RPC pool with chain-id verification and failover, SQLite indexer). `bun run server` on port 3001; Vite proxies `/api`.
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/pages/` - Overview, Whales, WalletPage, Tokens, Contracts, TxPage, Status
- `server/rpc.ts` - provider pool; `server/indexer.ts` - 250-block idempotent batches, newest first; `server/queries.ts` - analytics; `server/live.ts`, `wallet.ts`, `contract.ts` - live reads
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run server
bun run dev
```

## Decisions

- Native USDC transfers are the 18-decimal Transfer events from the system emitter; ERC-20 transfers come from the USDC contract. A single tx can emit both.
- Rows are stored for transfers >= INDEX_MIN_TRANSFER_USDC; every transfer is counted in the batch aggregates.
- No mock data: API failures hide data instead of showing cached values.
- No contract deployed. Mainnet deployment of any future contract needs a separate review.
