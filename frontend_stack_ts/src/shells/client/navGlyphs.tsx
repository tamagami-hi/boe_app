export type GlyphProps = Readonly<{ className?: string | undefined }>

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.15,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

export const HomeGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <path d="M4 10.4 12 4l8 6.4V19a1.4 1.4 0 0 1-1.4 1.4h-3.2v-6h-6.8v6H5.4A1.4 1.4 0 0 1 4 19Z" />
  </svg>
)

export const FundsGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <path d="M4 19.2h16" />
    <path d="M6.6 19.2V11" />
    <path d="M11.4 19.2V6.4" />
    <path d="M16.2 19.2v-5.6" />
    <path d="M20.4 4.6 16.2 8.4l-4.8-3.2-4.8 5" />
  </svg>
)

export const PortfolioGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="7.6" />
    <path d="M12 4.4v7.6l6 3.6" />
  </svg>
)

export const ActivityGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <path d="M3.4 13.2h4l2.2-5.4 3 9.6 2.4-5.6h5.6" />
  </svg>
)

export const ProfileGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="9" r="3.4" />
    <path d="M5.4 20a6.8 6.8 0 0 1 13.2 0" />
  </svg>
)

export const BellGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <path d="M9.2 18.4a2.8 2.8 0 0 0 5.6 0" />
    <path d="M6.4 15.6V10a5.6 5.6 0 0 1 11.2 0v5.6l1.4 2.2H5Z" />
  </svg>
)

export const BackGlyph = ({ className }: GlyphProps): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" {...stroke}>
    <path d="M14.4 5.6 8 12l6.4 6.4" />
  </svg>
)

export const NAV_GLYPHS: Readonly<Record<string, (props: GlyphProps) => React.ReactElement>> = {
  dashboard: HomeGlyph,
  funds: FundsGlyph,
  portfolio: PortfolioGlyph,
  activity: ActivityGlyph,
  profile: ProfileGlyph,
}
