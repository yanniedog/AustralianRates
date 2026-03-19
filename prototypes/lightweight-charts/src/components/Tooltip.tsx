import { formatDate, formatRate } from '../lib/chartHelpers'
import type { ChartEvent } from '../lib/types'

type TooltipRow = {
  id: string
  lender: string
  productName: string
  color: string
  rate: number
  meta: Array<{ label: string; value: string }>
}

type TooltipProps = {
  visible: boolean
  left: number
  top: number
  date: string | null
  rows: TooltipRow[]
  events: ChartEvent[]
}

export default function Tooltip(props: TooltipProps) {
  if (!props.visible || !props.date || (props.rows.length === 0 && props.events.length === 0)) {
    return null
  }

  return (
    <aside className="prototype-tooltip" style={{ left: props.left, top: props.top }}>
      <p className="prototype-tooltip-date">{formatDate(props.date)}</p>
      <div className="prototype-tooltip-series">
        {props.rows.map((row) => (
          <section className="prototype-tooltip-row" key={row.id}>
            <strong>
              <span className="legend-swatch" style={{ backgroundColor: row.color }} />
              {row.lender}
            </strong>
            <span>{row.productName}</span>
            <span className="prototype-tooltip-rate">{formatRate(row.rate)}</span>
            <div className="prototype-tooltip-meta">
              {row.meta.map((item) => (
                <span key={`${row.id}:${item.label}`}>
                  {item.label}: {item.value}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
      {props.events.length > 0 ? (
        <div className="prototype-tooltip-events">
          {props.events.map((event, index) => (
            <section className="prototype-tooltip-row" key={`${event.type}:${event.date}:${index}`}>
              <strong>{event.type === 'RBA' ? 'RBA event' : 'Lender repricing'}</strong>
              <span>{event.label}</span>
            </section>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
