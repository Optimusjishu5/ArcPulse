/** Live Arc Mainnet reads: network health, blocks, transactions, receipts, gas. Nothing here is cached beyond ~1s. */
import { Amount, parseAmount, usdcToGasToken } from '../src/onchain-money'
import {
  addressToTopic, blockTimestamps, decodeTransfer, getBlocks, headInfo, isAddress, tokenMeta,
  type RpcBlock, type RpcReceipt, type RpcTx,
} from './chain'
import { ARC } from './env'
import { hexToBigInt, hexToNumber, memo, rpc, rpcBatch, RpcError, toHex } from './rpc'

const SEL_TRANSFER = '0xa9059cbb'
const SEL_TRANSFER_FROM = '0x23b872dd'

export type TxType = 'creation' | 'native-transfer' | 'usdc-transfer' | 'contract-call' | 'plain'

export function classifyTx(tx: RpcTx) {
  const input = tx.input ?? '0x'
  const hasValue = hexToBigInt(tx.value) > 0n
  const toUsdc = tx.to?.toLowerCase() === ARC.usdc
  let type: TxType = 'plain'
  let usdc: { to: string; raw: string } | null = null
  if (tx.to === null) type = 'creation'
  else if (toUsdc && input.startsWith(SEL_TRANSFER) && input.length >= 138) {
    type = 'usdc-transfer'
    usdc = { to: `0x${input.slice(34, 74)}`, raw: BigInt(`0x${input.slice(74, 138)}`).toString() }
  } else if (toUsdc && input.startsWith(SEL_TRANSFER_FROM) && input.length >= 202) {
    type = 'usdc-transfer'
    usdc = { to: `0x${input.slice(98, 138)}`, raw: BigInt(`0x${input.slice(138, 202)}`).toString() }
  } else if (input.length > 2) type = 'contract-call'
  else if (hasValue) type = 'native-transfer'
  return { type, selector: input.length >= 10 ? input.slice(0, 10) : null, usdc }
}

const feeOf = (receipt: RpcReceipt | null): string | null =>
  receipt?.effectiveGasPrice ? (hexToBigInt(receipt.gasUsed) * hexToBigInt(receipt.effectiveGasPrice)).toString() : null

export async function networkSnapshot() {
  const head = await headInfo()
  const nums = Array.from({ length: 50 }, (_, i) => head.number - 49 + i)
  const [blocks, fees] = await Promise.all([
    getBlocks(nums, false),
    rpcBatch([
      { method: 'eth_gasPrice', params: [] },
      { method: 'eth_maxPriorityFeePerGas', params: [] },
    ]),
  ])
  const first = blocks[0] as RpcBlock
  const last = blocks[blocks.length - 1] as RpcBlock
  const span = Math.max(1, hexToNumber(last.timestamp) - hexToNumber(first.timestamp))
  const txs = blocks.reduce((n, b) => n + b.transactions.length, 0)
  const used = blocks.reduce((n, b) => n + hexToNumber(b.gasUsed), 0)
  const limit = blocks.reduce((n, b) => n + hexToNumber(b.gasLimit), 0)
  const gasPrice = hexToBigInt(fees[0]?.result)
  return {
    head: { number: head.number, hash: head.hash, timestamp: head.timestamp },
    sampleBlocks: blocks.length,
    sampleSeconds: span,
    blockTimeSeconds: span / (blocks.length - 1),
    txPerSecond: txs / span,
    gasUtilization: limit > 0 ? used / limit : 0,
    baseFeeGwei: Number(hexToBigInt(last.baseFeePerGas)) / 1e9,
    gasPriceWei: gasPrice.toString(),
    priorityFeeWei: hexToBigInt(fees[1]?.result).toString(),
    /** Cost of a 21,000 gas transfer in 18-decimal native USDC. */
    transferCostNativeRaw: (gasPrice * 21000n).toString(),
    nativeDecimals: ARC.nativeDecimals,
  }
}

export async function latestBlocks(limit = 12) {
  const head = await headInfo()
  const nums = Array.from({ length: limit }, (_, i) => head.number - i)
  const blocks = await getBlocks(nums, false)
  return blocks.map((b) => ({
    number: hexToNumber(b.number),
    hash: b.hash,
    timestamp: hexToNumber(b.timestamp),
    txCount: b.transactions.length,
    gasUsed: hexToNumber(b.gasUsed),
    gasLimit: hexToNumber(b.gasLimit),
    miner: b.miner,
  }))
}

export async function latestTxs(limit = 25) {
  const head = await headInfo()
  const out: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < 40 && out.length < limit; offset += 4) {
    const nums = Array.from({ length: 4 }, (_, i) => head.number - offset - i)
    const [blocks, receipts] = await Promise.all([
      getBlocks(nums, true),
      rpcBatch(nums.map((n) => ({ method: 'eth_getBlockReceipts', params: [toHex(n)] }))),
    ])
    blocks.forEach((b, bi) => {
      const rc = (receipts[bi]?.result ?? null) as RpcReceipt[] | null
      const ts = hexToNumber(b.timestamp)
      for (const t of [...b.transactions].reverse()) {
        const tx = t as RpcTx
        const receipt = rc?.[hexToNumber(tx.transactionIndex)] ?? null
        const c = classifyTx(tx)
        out.push({
          hash: tx.hash, block: hexToNumber(tx.blockNumber), timestamp: ts, from: tx.from, to: tx.to,
          type: c.type, selector: c.selector, usdcTransfer: c.usdc,
          nativeValueRaw: hexToBigInt(tx.value).toString(),
          status: receipt ? (receipt.status === '0x1' ? 'success' : 'failed') : 'unknown',
          feeNativeRaw: feeOf(receipt),
        })
      }
    })
  }
  return out.slice(0, limit)
}

export async function txDetail(hash: string) {
  const [txRes, rcRes] = await rpcBatch([
    { method: 'eth_getTransactionByHash', params: [hash] },
    { method: 'eth_getTransactionReceipt', params: [hash] },
  ])
  const tx = (txRes?.result ?? null) as RpcTx | null
  if (!tx) return null
  const receipt = (rcRes?.result ?? null) as RpcReceipt | null
  const head = await headInfo()
  const blockNumber = tx.blockNumber ? hexToNumber(tx.blockNumber) : null
  const ts = blockNumber !== null ? (await blockTimestamps([blockNumber])).get(blockNumber) ?? null : null
  const decoded = (receipt?.logs ?? []).flatMap((l) => {
    const d = decodeTransfer(l)
    return d ? [d] : []
  })
  const metas = await tokenMeta(decoded.filter((d) => d.kind === 'erc20' && d.token !== ARC.usdc).map((d) => d.token))
  const c = classifyTx(tx)
  return {
    hash: tx.hash,
    status: receipt ? (receipt.status === '0x1' ? 'success' : 'failed') : 'pending',
    block: blockNumber,
    timestamp: ts,
    confirmations: blockNumber !== null ? Math.max(0, head.number - blockNumber) : 0,
    from: tx.from,
    to: tx.to,
    contractCreated: receipt?.contractAddress ?? null,
    type: c.type,
    selector: c.selector,
    usdcTransfer: c.usdc,
    nativeValueRaw: hexToBigInt(tx.value).toString(),
    gasLimit: hexToNumber(tx.gas),
    gasUsed: receipt ? hexToNumber(receipt.gasUsed) : null,
    feeNativeRaw: feeOf(receipt),
    nonce: hexToNumber(tx.nonce),
    logCount: receipt?.logs.length ?? 0,
    transfers: decoded.map((d) => {
      const meta = metas.get(d.token)
      const isUsdc = d.kind === 'erc20' && d.token === ARC.usdc
      return {
        kind: d.kind === 'native' ? 'native' : isUsdc ? 'usdc-erc20' : 'token',
        token: d.kind === 'native' ? null : d.token,
        symbol: d.kind === 'native' ? 'USDC' : isUsdc ? 'USDC' : meta?.symbol ?? null,
        decimals: d.kind === 'native' ? ARC.nativeDecimals : isUsdc ? ARC.usdcDecimals : meta?.decimals ?? null,
        from: d.from, to: d.to, raw: d.raw.toString(), logIndex: d.logIndex,
      }
    }),
  }
}

export interface GasEstimateInput {
  kind: 'native' | 'usdc'
  from: string
  to: string
  amount: string
}

/** eth_estimateGas for a native USDC transfer or an ERC-20 USDC transfer, priced at the current gas price. */
export async function estimateTransfer(input: GasEstimateInput) {
  if (!isAddress(input.from) || !isAddress(input.to)) throw new RpcError('from and to must be valid addresses', 'node')
  const amount = parseAmount(ARC.chainId, input.amount || '0')
  const tx =
    input.kind === 'native'
      ? { from: input.from, to: input.to, value: toHex(usdcToGasToken(ARC.chainId, amount).raw) }
      : {
          from: input.from,
          to: ARC.usdc,
          data: `${SEL_TRANSFER}${addressToTopic(input.to).slice(2)}${amount.raw.toString(16).padStart(64, '0')}`,
        }
  const [gas, price] = await rpcBatch([
    { method: 'eth_estimateGas', params: [tx] },
    { method: 'eth_gasPrice', params: [] },
  ])
  if (gas?.error) throw new RpcError(`Estimation failed: ${gas.error.message}`, 'node', gas.error.code)
  const gasUnits = hexToBigInt(gas?.result)
  const gasPrice = hexToBigInt(price?.result)
  return {
    kind: input.kind,
    gasUnits: gasUnits.toString(),
    gasPriceWei: gasPrice.toString(),
    costNativeRaw: (gasUnits * gasPrice).toString(),
    nativeDecimals: ARC.nativeDecimals,
    amountUsdc: Amount.fromRaw(amount.raw, ARC.usdcDecimals).toString(),
  }
}

export const chainIdProbe = () => memo('chainid', 5000, () => rpc<string>('eth_chainId'))
