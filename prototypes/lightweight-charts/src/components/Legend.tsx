import type { RenderableSeries } from '../lib/types'

type LegendProps = {
  series: RenderableSeries[]
  hiddenSeriesIds: string[]
  highlightedSeriesId: string | null
  onToggle: (seriesId: string) => void
  onHighlight: (seriesId: string | null) => void
}

export default function Legend(props: LegendProps) {
  const hidden = new Set(props.hiddenSeriesIds)

  return (
    <aside className="prototype-card">
      <h2>Legend</h2>
      <p className="prototype-meta">Toggle visibility and hover to focus a product series.</p>
      <div className="legend-list">
        {props.series.map((series) => {
          const isHidden = hidden.has(series.id)
          const isHighlighted = props.highlightedSeriesId === series.id
          return (
            <button
              key={series.id}
              className={`legend-item${isHidden ? ' is-hidden' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
              type="button"
              onClick={() => props.onToggle(series.id)}
              onMouseEnter={() => props.onHighlight(series.id)}
              onMouseLeave={() => props.onHighlight(null)}
              onFocus={() => props.onHighlight(series.id)}
              onBlur={() => props.onHighlight(null)}
            >
              <span>
                <span className="legend-swatch" style={{ backgroundColor: series.color }} />
                {series.lender}
              </span>
              <strong>{series.productName}</strong>
              <span className="prototype-meta">{series.meta.map((item) => `${item.label}: ${item.value}`).join(' · ')}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
