export type Slice = Readonly<{
  key: string
  label: string
  value: number
}>

export type Arc = Readonly<{
  key: string
  label: string
  value: number
  share: number
  path: string
}>

export const DONUT_PALETTE: readonly string[] = [
  "#8a6428",
  "#c79a53",
  "#4a6b52",
  "#7d8b7f",
  "#2a2522",
  "#b08968",
  "#5d6f7c",
  "#9c8065",
]

const TAU = Math.PI * 2

const pointOn = (radius: number, angle: number, centre: number): readonly [number, number] => [
  centre + radius * Math.cos(angle - Math.PI / 2),
  centre + radius * Math.sin(angle - Math.PI / 2),
]

const arcPath = (
  startAngle: number,
  endAngle: number,
  outerRadius: number,
  innerRadius: number,
  centre: number,
): string => {
  const [outerStartX, outerStartY] = pointOn(outerRadius, startAngle, centre)
  const [outerEndX, outerEndY] = pointOn(outerRadius, endAngle, centre)
  const [innerEndX, innerEndY] = pointOn(innerRadius, endAngle, centre)
  const [innerStartX, innerStartY] = pointOn(innerRadius, startAngle, centre)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

  return [
    `M ${outerStartX.toFixed(3)} ${outerStartY.toFixed(3)}`,
    `A ${String(outerRadius)} ${String(outerRadius)} 0 ${String(largeArc)} 1 ${outerEndX.toFixed(3)} ${outerEndY.toFixed(3)}`,
    `L ${innerEndX.toFixed(3)} ${innerEndY.toFixed(3)}`,
    `A ${String(innerRadius)} ${String(innerRadius)} 0 ${String(largeArc)} 0 ${innerStartX.toFixed(3)} ${innerStartY.toFixed(3)}`,
    "Z",
  ].join(" ")
}

export const buildDonut = (
  slices: readonly Slice[],
  viewBox: number,
  thickness: number,
): readonly Arc[] => {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)
  if (total <= 0) return []

  const centre = viewBox / 2
  const outerRadius = centre - 1
  const innerRadius = Math.max(outerRadius - thickness, 1)

  let cursor = 0
  return slices.flatMap((slice) => {
    const value = Math.max(slice.value, 0)
    if (value === 0) return []
    const share = value / total
    const start = cursor * TAU
    cursor += share
    const end = Math.min(cursor, 1) * TAU
    return [
      {
        key: slice.key,
        label: slice.label,
        value,
        share,
        path: arcPath(start, end, outerRadius, innerRadius, centre),
      },
    ]
  })
}

export const colourFor = (index: number): string =>
  DONUT_PALETTE[index % DONUT_PALETTE.length] ?? "#8a6428"

export const formatShare = (share: number): string => `${(share * 100).toFixed(1)}%`
