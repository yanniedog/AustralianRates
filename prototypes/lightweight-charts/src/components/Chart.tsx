import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ColorType, CrosshairMode, LineSeries, LineType, createChart } from 'lightweight-charts'
import { eventsByDate, formatDate, insertWhitespaceGaps } from '../lib/chartHelpers'
import type { ChartEvent, DatasetKey, RenderableSeries } from '../lib/types'
import Tooltip from './Tooltip'

type TooltipState = {
  visible: boolean
  left: number
  top: number
  date: string | null
  rows: Array<{
    id: string
    lender: string
    productName: string
    color: string
    rate: number
    meta: Array<{ label: string; value: string }>
  }>
  events: ChartEvent[]
}

type ChartProps = {
  dataset: DatasetKey
  series: RenderableSeries[]
  events: ChartEvent[]
  hiddenSeriesIds: string[]
  highlightedSeriesId: string | null
}

type EventLine = ChartEvent & { left: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function Chart(props: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<any>(null)
  const seriesRefs = useRef(new Map<string, { api: any; source: RenderableSeries }>())
  const stickyTouchRef = useRef(false)
  const lastSeriesKeyRef = useRef<string>('')
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    left: 0,
    top: 0,
    date: null,
    rows: [],
    events: [],
  })
  const [eventLines, setEventLines] = useState<EventLine[]>([])

  const hiddenSeries = new Set(props.hiddenSeriesIds)
  const groupedEvents = eventsByDate(props.events)

  const updateEventOverlay = useEffectEvent(() => {
    const container = chartContainerRef.current
    const chart = chartRef.current
    if (!container || !chart) return
    const nextLines = props.events
      .map((event) => {
        const left = chart.timeScale().timeToCoordinate(event.date)
        if (!Number.isFinite(left)) return null
        return { ...event, left: Number(left) }
      })
      .filter((event): event is EventLine => event != null && event.left >= 0 && event.left <= container.clientWidth)
    setEventLines(nextLines)
  })

  const updateTooltip = useEffectEvent((param: any) => {
    const container = chartContainerRef.current
    if (!container) return
    const point = param?.point
    const time = typeof param?.time === 'string' ? param.time : null

    if (!point || !time) {
      if (!stickyTouchRef.current) {
        setTooltip((current) => ({ ...current, visible: false }))
      }
      return
    }

    const rows = props.series
      .map((series) => {
        const handle = seriesRefs.current.get(series.id)
        if (!handle) return null
        const seriesData = param.seriesData?.get(handle.api)
        if (!seriesData || typeof seriesData.value !== 'number' || hiddenSeries.has(series.id)) return null
        return {
          id: series.id,
          lender: series.lender,
          productName: series.productName,
          color: series.color,
          rate: seriesData.value,
          meta: series.meta,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)

    const tooltipWidth = 280
    const left = clamp(point.x + 14, 12, Math.max(12, container.clientWidth - tooltipWidth - 12))
    const top = clamp(point.y + 14, 12, Math.max(12, container.clientHeight - 200))
    setTooltip({
      visible: rows.length > 0 || (groupedEvents.get(time)?.length ?? 0) > 0,
      left,
      top,
      date: time,
      rows,
      events: groupedEvents.get(time) ?? [],
    })
  })

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: getComputedStyle(document.documentElement).getPropertyValue('--prototype-text').trim() || '#0f172a',
        fontFamily: '"Space Grotesk", sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.15)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.15)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.28)',
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.28)',
        timeVisible: true,
      },
    })

    chartRef.current = chart
    chart.subscribeCrosshairMove(updateTooltip)
    chart.timeScale().subscribeVisibleTimeRangeChange(updateEventOverlay)

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      chart.resize(entry.contentRect.width, entry.contentRect.height)
      updateEventOverlay()
    })

    resizeObserver.observe(container)

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        stickyTouchRef.current = true
      }
    }

    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!container.contains(event.target as Node)) {
        stickyTouchRef.current = false
        setTooltip((current) => ({ ...current, visible: false }))
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerdown', onDocumentPointerDown)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRefs.current.clear()
    }
  }, [updateEventOverlay, updateTooltip])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const incomingIds = new Set(props.series.map((series) => series.id))
    const nextSeriesKey = props.series.map((series) => series.id).join('|')
    Array.from(seriesRefs.current.keys()).forEach((seriesId) => {
      if (!incomingIds.has(seriesId)) {
        const handle = seriesRefs.current.get(seriesId)
        if (handle) {
          chart.removeSeries(handle.api)
        }
        seriesRefs.current.delete(seriesId)
      }
    })

    props.series.forEach((series) => {
      let handle = seriesRefs.current.get(series.id)
      if (!handle) {
        const api = chart.addSeries(LineSeries, {
          color: series.color,
          lineWidth: 2,
          lineType: LineType.WithSteps,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
        })
        handle = { api, source: series }
        seriesRefs.current.set(series.id, handle)
      }
      handle.source = series
      handle.api.setData(insertWhitespaceGaps(series.data))
      handle.api.applyOptions({ color: series.color })
    })

    if (lastSeriesKeyRef.current !== nextSeriesKey) {
      chart.timeScale().fitContent()
      lastSeriesKeyRef.current = nextSeriesKey
    }
    updateEventOverlay()
  }, [props.series, updateEventOverlay])

  useEffect(() => {
    props.series.forEach((series) => {
      const handle = seriesRefs.current.get(series.id)
      if (!handle) return
      handle.api.applyOptions({
        visible: !hiddenSeries.has(series.id),
        color: series.color,
        lineWidth: props.highlightedSeriesId && props.highlightedSeriesId === series.id ? 3 : 2,
      })
    })
  }, [hiddenSeries, props.highlightedSeriesId, props.series])

  useEffect(() => {
    updateEventOverlay()
  }, [props.events, updateEventOverlay])

  return (
    <div className="prototype-chart-area">
      <div className="prototype-chart-canvas" ref={chartContainerRef} />
      <div className="prototype-event-overlay" aria-hidden="true">
        {eventLines.map((event, index) => (
          <div
            className="prototype-event-line"
            data-type={event.type}
            key={`${event.type}:${event.date}:${index}`}
            style={{ left: event.left }}
            title={`${formatDate(event.date)} - ${event.label}`}
          >
            <span className="prototype-event-label">{event.label}</span>
          </div>
        ))}
      </div>
      <Tooltip {...tooltip} />
    </div>
  )
}
