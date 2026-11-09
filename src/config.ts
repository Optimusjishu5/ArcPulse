/**
 * wagmi configuration: Arc Mainnet (chain 5042) is the only configured chain.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

const facts = requireChain(5042)

if (facts.isTestnet || facts.chainId !== 5042) {
  throw new Error('ArcPulse is configured for Arc Mainnet (chain 5042) only')
}

const rpcUrl = facts.rpcUrls[0]

export const arcMainnet = defineChain({
  id: facts.chainId,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: facts.nativeCurrency.symbol, decimals: facts.nativeCurrency.decimals },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: facts.explorerBase } },
})

registerChain(arcMainnet.id, rpcUrl)

export const walletConnectProjectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || ''

// MetaMask and Rabby are discovered through injected() (EIP-6963); Coinbase Wallet and WalletConnect have their own connectors.
export const config = createConfig({
  chains: [arcMainnet],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'ArcPulse' }),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, metadata: { name: 'ArcPulse', description: 'Arc Mainnet intelligence', url: window.location.origin, icons: [] } })]
      : []),
  ],
  transports: { [arcMainnet.id]: http(rpcUrl) },
})
