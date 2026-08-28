import { buildDonut, colourFor, formatShare } from "./chartMath"
import type { Slice } from "./chartMath"

import styles from "./Charts.module.css"

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
    <div className={styles.donutWrap}>
      <div className={styles.donutFigure}>
        <svg
          className={styles.donut}
          viewBox={`0 0 ${String(VIEW_BOX)} ${String(VIEW_BOX)}`}
          role="img"
          aria-label={`${centreLabel}: ${arcs
            .map((arc) => `${arc.label} ${formatShare(arc.share)}`)
            .join(", ")}`}
        >
          {arcs.map((arc, index) => (
            <path key={arc.key} className={styles.arc} d={arc.path} fill={colourFor(index)} />
          ))}
        </svg>
        <div className={styles.donutCentre}>
          <span>
            <span className={styles.donutCentreLabel}>{centreLabel}</span>
            <br />
            <span className={styles.donutCentreValue}>{centreValue}</span>
          </span>
        </div>
      </div>

      <ul className={styles.legend}>
        {arcs.map((arc, index) => (
          <li key={arc.key} className={styles.legendRow}>
            <span
              className={styles.legendSwatch}
              style={{ background: colourFor(index) }}
              aria-hidden="true"
            />
            <span className={styles.legendLabel}>{arc.label}</span>
            <span className={styles.legendValue}>
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
