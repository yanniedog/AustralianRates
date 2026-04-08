import { useEffect, useRef } from 'react'
import type { RenderableSeries } from '../lib/types'

type ProductPanelProps = {
  open: boolean
  series: RenderableSeries[]
  hiddenSeriesIds: string[]
  focusSeriesId: string | null
  onDismiss: () => void
  onToggle: (seriesId: string) => void
  onHighlight: (seriesId: string | null) => void
}

function metaInline(meta: Array<{ label: string; value: string }>): string {
  return meta.map((item) => `${item.label}: ${item.value}`).join(' · ')
}

export default function Legend(props: ProductPanelProps) {
  const hidden = new Set(props.hiddenSeriesIds)
  const focusRowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!props.open || !props.focusSeriesId) return
    const row = focusRowRef.current
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [props.open, props.focusSeriesId, props.series])

  if (!props.open || props.series.length === 0) {
    return null
  }

  return (
    <section className="product-panel" aria-label="Products">
      <div className="product-panel-toolbar">
        <span className="product-panel-title">Products</span>
        <button className="product-panel-dismiss" type="button" onClick={() => props.onDismiss()}>
          Close
        </button>
      </div>
      <div className="product-panel-body">
        {props.series.map((series) => {
          const isHidden = hidden.has(series.id)
          const isFocus = props.focusSeriesId === series.id
          return (
            <button
              key={series.id}
              ref={isFocus ? focusRowRef : undefined}
              className={`product-panel-row${isHidden ? ' is-hidden' : ''}${isFocus ? ' is-focus' : ''}`}
              type="button"
              onClick={() => props.onToggle(series.id)}
              onMouseEnter={() => props.onHighlight(series.id)}
              onMouseLeave={() => props.onHighlight(null)}
              onFocus={() => props.onHighlight(series.id)}
              onBlur={() => props.onHighlight(null)}
            >
              <span className="legend-swatch" style={{ backgroundColor: series.color }} aria-hidden />
              <span className="product-panel-lender">{series.lender}</span>
              <span className="product-panel-name">{series.productName}</span>
              <span className="product-panel-meta">{metaInline(series.meta)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
