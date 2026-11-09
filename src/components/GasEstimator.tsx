import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Card, Segmented } from '@/components/ui'
import { ApiError, apiGet } from '@/lib/api'
import { fmtInt, fmtRaw, isAddress } from '@/lib/format'

interface Estimate {
  kind: 'native' | 'usdc'
  gasUnits: string
  gasPriceWei: string
  costNativeRaw: string
  nativeDecimals: number
}

/** eth_estimateGas against Arc Mainnet for a native or ERC-20 USDC transfer. Nothing is signed or sent. */
export function GasEstimator() {
  const { address } = useAccount()
  const [kind, setKind] = useState<'native' | 'usdc'>('usdc')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Estimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sender = from || address || ''
  const valid = isAddress(sender) && isAddress(to) && /^\d+(\.\d{0,6})?$/.test(amount)

  const run = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const q = new URLSearchParams({ kind, from: sender.trim(), to: to.trim(), amount })
      setResult((await apiGet<Estimate>(`/api/gas/estimate?${q}`)).data)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Estimation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Gas estimator" subtitle="Estimated with eth_estimateGas on Arc Mainnet. Nothing is signed or sent.">
      <div className="space-y-3">
        <Segmented label="Transfer type" value={kind} onChange={setKind} options={[{ id: 'usdc', label: 'ERC-20 USDC' }, { id: 'native', label: 'Native USDC' }]} />
        <input className="input mono" placeholder={address ? `From (default: your wallet)` : 'From address'} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From address" />
        <input className="input mono" placeholder="To address" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To address" />
        <input className="input num" inputMode="decimal" placeholder="Amount in USDC" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in USDC" />
        <button className="btn btn-primary w-full" disabled={!valid || busy} onClick={() => void run()}>
          {busy ? 'Estimating…' : 'Estimate gas'}
        </button>
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        {result && (
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-field p-4 text-sm">
            <dt className="text-[var(--subtle)]">Gas units</dt><dd className="num text-right">{fmtInt(Number(result.gasUnits))}</dd>
            <dt className="text-[var(--subtle)]">Gas price</dt><dd className="num text-right">{(Number(result.gasPriceWei) / 1e9).toFixed(3)} Gwei</dd>
            <dt className="text-[var(--subtle)]">Fee (native USDC, 18-dec)</dt><dd className="num text-right">{fmtRaw(result.costNativeRaw, result.nativeDecimals, 6)}</dd>
          </dl>
        )}
      </div>
    </Card>
  )
}
