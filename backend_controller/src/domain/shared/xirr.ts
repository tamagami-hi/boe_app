export interface DatedFlow {
  readonly date: string
  readonly amountPaise: bigint
}

interface TimedAmount {
  readonly years: number
  readonly amount: number
}

const MILLISECONDS_PER_DAY = 86_400_000
const DAYS_PER_YEAR = 365
const BASIS_POINTS_PER_UNIT = 10_000
const MAX_ITERATIONS = 200
const LOG_RATE_TOLERANCE = 1e-12
const LOG_RATE_FLOOR = Math.log(1e-6)
const LOG_RATE_CEILING = Math.log(1e6)

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLISECONDS_PER_DAY)

export const netFlowsByDate = (flows: readonly DatedFlow[]): readonly DatedFlow[] => {
  const totals = new Map<string, bigint>()
  for (const flow of flows) totals.set(flow.date, (totals.get(flow.date) ?? 0n) + flow.amountPaise)
  return [...totals.entries()]
    .filter(([, amountPaise]) => amountPaise !== 0n)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([date, amountPaise]) => ({ date, amountPaise }))
}

const presentValueSign = (flows: readonly TimedAmount[], logRate: number): number => {
  const discounted = flows.map((flow) => ({ exponent: -logRate * flow.years, amount: flow.amount }))
  const peak = Math.max(...discounted.map((flow) => flow.exponent))
  const total = discounted.reduce((sum, flow) => sum + flow.amount * Math.exp(flow.exponent - peak), 0)
  return Math.sign(total)
}

const bisectLogRate = (flows: readonly TimedAmount[]): number | null => {
  let low = LOG_RATE_FLOOR
  let high = LOG_RATE_CEILING
  const lowSign = presentValueSign(flows, low)
  const highSign = presentValueSign(flows, high)
  if (lowSign === 0) return low
  if (highSign === 0) return high
  if (lowSign === highSign) return null
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2
    if (high - low <= LOG_RATE_TOLERANCE || middle === low || middle === high) return middle
    const middleSign = presentValueSign(flows, middle)
    if (middleSign === 0) return middle
    if (middleSign === lowSign) low = middle
    else high = middle
  }
  return null
}

const toBasisPoints = (rate: number): bigint | null => {
  const scaled = rate * BASIS_POINTS_PER_UNIT
  if (!Number.isFinite(scaled)) return null
  return BigInt(Math.sign(scaled) * Math.round(Math.abs(scaled)))
}

export const annualisedReturnBasisPoints = (flows: readonly DatedFlow[]): bigint | null => {
  const netted = netFlowsByDate(flows)
  const first = netted[0]
  if (first === undefined) return null
  if (!netted.some((flow) => flow.amountPaise < 0n) || !netted.some((flow) => flow.amountPaise > 0n)) return null
  const timed = netted.map((flow) => ({
    years: daysBetween(first.date, flow.date) / DAYS_PER_YEAR,
    amount: Number(flow.amountPaise),
  }))
  const logRate = bisectLogRate(timed)
  return logRate === null ? null : toBasisPoints(Math.expm1(logRate))
}
