import { buildDonut, colourFor, formatShare } from "./chartMath"
import type { Slice } from "./chartMath"

import { DONUT_ARC, DONUT_CENTRE, DONUT_CENTRE_VALUE, DONUT_FIGURE, DONUT_SVG, DONUT_WRAP, LEGEND_LABEL, LEGEND_ROOT, LEGEND_ROW, LEGEND_SWATCH, LEGEND_VALUE } from "~/ui/recipes/chart"
import { STAT_LABEL } from "~/ui/recipes/datalist"

const VIEW_BOX = 100
const THICKNESS = 17

export type DonutChartProps = Readonly<{
  slices: readonly Slice[]
  centreLabel: string
  centreValue: string
  legendUnit?: (slice: Slice, share: number) => string
}>

export const DonutChart = ({
  slices,
  centreLabel,
  centreValue,
  legendUnit,
}: DonutChartProps): React.ReactElement | null => {
  const arcs = buildDonut(slices, VIEW_BOX, THICKNESS)
  if (arcs.length === 0) return null

  return (
    <div className={DONUT_WRAP}>
      <div className={DONUT_FIGURE}>
        <svg
          className={DONUT_SVG}
          viewBox={`0 0 ${String(VIEW_BOX)} ${String(VIEW_BOX)}`}
          role="img"
          aria-label={`${centreLabel}: ${arcs
            .map((arc) => `${arc.label} ${formatShare(arc.share)}`)
            .join(", ")}`}
        >
          {arcs.map((arc, index) => (
            <path key={arc.key} className={DONUT_ARC} d={arc.path} fill={colourFor(index)} />
          ))}
        </svg>
        <div className={DONUT_CENTRE}>
          <span>
            <span className={STAT_LABEL}>{centreLabel}</span>
            <br />
            <span className={DONUT_CENTRE_VALUE}>{centreValue}</span>
          </span>
        </div>
      </div>

      <ul className={LEGEND_ROOT}>
        {arcs.map((arc, index) => (
          <li key={arc.key} className={LEGEND_ROW}>
            <span
              className={LEGEND_SWATCH}
              style={{ background: colourFor(index) }}
              aria-hidden="true"
            />
            <span className={LEGEND_LABEL}>{arc.label}</span>
            <span className={LEGEND_VALUE}>
              {legendUnit === undefined
                ? formatShare(arc.share)
                : legendUnit({ key: arc.key, label: arc.label, value: arc.value }, arc.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
