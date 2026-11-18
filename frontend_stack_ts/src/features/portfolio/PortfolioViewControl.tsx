import { Link, useSearchParams } from "react-router-dom"

import { Tabs } from "~/ui/primitives/Toggle"
import type { TabItem } from "~/ui/primitives/Toggle"

import { VIEW_CONTROLS, VIEW_LINK, VIEW_LINK_FULL, VIEW_LINK_SHORT, VIEW_LINKS, VIEW_TABS } from "./portfolio.recipe"

export type PortfolioView = "positions" | "breakdown"

export const PORTFOLIO_VIEW_TABS_ID = "portfolio-view"

const VIEW_PARAM = "view"

const VIEW_TAB_ITEMS: readonly TabItem<PortfolioView>[] = [
  { value: "positions", label: "Positions" },
  { value: "breakdown", label: "Breakdown" },
]

export const usePortfolioView = (): Readonly<{ view: PortfolioView; selectView: (next: PortfolioView) => void }> => {
  const [params, setParams] = useSearchParams()
  const view: PortfolioView = params.get(VIEW_PARAM) === "breakdown" ? "breakdown" : "positions"
  const selectView = (next: PortfolioView): void => {
    if (next === view) return
    const updated = new URLSearchParams(params)
    if (next === "breakdown") updated.set(VIEW_PARAM, next)
    else updated.delete(VIEW_PARAM)
    setParams(updated, { replace: true })
  }
  return { view, selectView }
}

type ViewLinkProps = Readonly<{ to: string; label: string; shortLabel: string }>

const ViewLink = ({ to, label, shortLabel }: ViewLinkProps): React.ReactElement => (
  <Link to={to} aria-label={label} className={VIEW_LINK}>
    <span className={VIEW_LINK_SHORT}>{shortLabel}</span>
    <span className={VIEW_LINK_FULL}>{label}</span>
  </Link>
)

export type PortfolioViewControlProps = Readonly<{
  showsSipPlans: boolean
  view: PortfolioView
  onSelectView: (next: PortfolioView) => void
}>

export const PortfolioViewControl = ({
  showsSipPlans,
  view,
  onSelectView,
}: PortfolioViewControlProps): React.ReactElement => (
  <div className={VIEW_CONTROLS}>
    <div className={VIEW_TABS}>
      <Tabs id={PORTFOLIO_VIEW_TABS_ID} label="Portfolio view" value={view} items={VIEW_TAB_ITEMS} onChange={onSelectView} />
    </div>
    <span className={VIEW_LINKS}>
      <ViewLink to="/portfolio/value-updates" label="Value updates" shortLabel="Updates" />
      {showsSipPlans ? <ViewLink to="/sips" label="SIP plans" shortLabel="SIPs" /> : null}
    </span>
  </div>
)
