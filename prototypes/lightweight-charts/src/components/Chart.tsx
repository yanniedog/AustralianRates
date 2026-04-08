import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineType,
  createChart,
} from 'lightweight-charts'
import { eventsByDate, formatDate, insertWhitespaceGaps } from '../lib/chartHelpers'
import type { ChartEvent, DatasetKey, RenderableSeries, ReportMovesPoint } from '../lib/types'
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
  movesPoints: ReportMovesPoint[] | null
  hiddenSeriesIds: string[]
  highlightedSeriesId: string | null
  /** When false, crosshair tooltip omits per-product status meta until a line is clicked */
  showTooltipSeriesMeta: boolean
  onSeriesLineClick?: (seriesId: string) => void
}

type EventLine = ChartEvent & { left: number }

const MOVES_PANE_HEIGHT = 92
const MOVES_PRICE_SCALE = 'ar-moves'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function movesHistogramColors(dataset: DatasetKey): { up: string; down: string } {
  if (dataset === 'home-loans') {
    return { up: '#b91c1c', down: '#0f766e' }
  }
  return { up: '#0f766e', down: '#b91c1c' }
}

export default function Chart(props: ChartProps) {
  const chartMountRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const seriesRefs = useRef(new Map<string, { api: any; source: RenderableSeries }>())
  const movesUpRef = useRef<any>(null)
  const movesDownRef = useRef<any>(null)
  const stickyTouchRef = useRef(false)
  const lastSeriesKeyRef = useRef<string>('')
  const onLineClickRef = useRef(props.onSeriesLineClick)
  onLineClickRef.current = props.onSeriesLineClick
  const datasetRef = useRef(props.dataset)
  datasetRef.current = props.dataset

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

  const positionEventOverlay = useEffectEvent(() => {
    const mount = chartMountRef.current
    const chart = chartRef.current
    const overlay = overlayRef.current
    if (!mount || !chart || !overlay) return
    const pane0 = chart.panes()[0]?.getHTMLElement()
    if (!pane0) {
      overlay.style.display = 'none'
      return
    }
    const mr = mount.getBoundingClientRect()
    const pr = pane0.getBoundingClientRect()
    overlay.style.display = 'block'
    overlay.style.top = `${pr.top - mr.top}px`
    overlay.style.left = '0'
    overlay.style.width = `${mount.clientWidth}px`
    overlay.style.height = `${pr.height}px`
  })

  const updateEventOverlay = useEffectEvent(() => {
    const mount = chartMountRef.current
    const chart = chartRef.current
    if (!mount || !chart) return
    const nextLines = props.events
      .map((event) => {
        const left = chart.timeScale().timeToCoordinate(event.date)
        if (!Number.isFinite(left)) return null
        return { ...event, left: Number(left) }
      })
      .filter((event): event is EventLine => event != null && event.left >= 0 && event.left <= mount.clientWidth)
    setEventLines(nextLines)
    positionEventOverlay()
  })

  const updateTooltip = useEffectEvent((param: any) => {
    const mount = chartMountRef.current
    if (!mount) return
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
    const left = clamp(point.x + 14, 12, Math.max(12, mount.clientWidth - tooltipWidth - 12))
    const top = clamp(point.y + 14, 12, Math.max(12, mount.clientHeight - 200))
    setTooltip({
      visible: rows.length > 0 || (groupedEvents.get(time)?.length ?? 0) > 0,
      left,
      top,
      date: time,
      rows,
      events: groupedEvents.get(time) ?? [],
    })
  })

  const applyMovesData = useEffectEvent(() => {
    const chart = chartRef.current
    const upApi = movesUpRef.current
    const downApi = movesDownRef.current
    if (!chart || !upApi || !downApi) return
    const points = props.movesPoints
    const pane1 = chart.panes()[1]
    if (!pane1) return

    if (!points || points.length === 0) {
      upApi.setData([])
      downApi.setData([])
      pane1.setHeight(0)
      return
    }

    const { up, down } = movesHistogramColors(props.dataset)
    const upData = points.map((p) => ({
      time: p.date,
      value: p.up_count,
      color: up,
    }))
    const downData = points.map((p) => ({
      time: p.date,
      value: p.down_count > 0 ? -p.down_count : 0,
      color: down,
    }))
    upApi.setData(upData)
    downApi.setData(downData)
    upApi.applyOptions({ color: up })
    downApi.applyOptions({ color: down })
    pane1.setHeight(MOVES_PANE_HEIGHT)
    positionEventOverlay()
  })

  const onChartClick = useEffectEvent((param: any) => {
    const hovered = param?.hoveredSeries
    if (!hovered) return
    for (const [id, handle] of seriesRefs.current) {
      if (handle.api === hovered) {
        onLineClickRef.current?.(id)
        return
      }
    }
  })

  useEffect(() => {
    const mount = chartMountRef.current
    if (!mount) return

    const chart = createChart(mount, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: getComputedStyle(document.documentElement).getPropertyValue('--prototype-text').trim() || '#0f172a',
        fontFamily: '"Space Grotesk", sans-serif',
        panes: {
          enableResize: false,
          separatorColor: 'rgba(148, 163, 184, 0.28)',
          separatorHoverColor: 'rgba(148, 163, 184, 0.4)',
        },
        attributionLogo: false,
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
    chart.addPane(false)
    const pane1 = chart.panes()[1]
    pane1.setHeight(0)

    const { up, down } = movesHistogramColors(datasetRef.current)
    const upApi = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: MOVES_PRICE_SCALE,
        priceLineVisible: false,
        lastValueVisible: false,
        color: up,
      },
      1,
    )
    const downApi = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: MOVES_PRICE_SCALE,
        priceLineVisible: false,
        lastValueVisible: false,
        color: down,
      },
      1,
    )
    movesUpRef.current = upApi
    movesDownRef.current = downApi
    chart.priceScale(MOVES_PRICE_SCALE, 1).applyOptions({
      borderColor: 'rgba(148, 163, 184, 0.2)',
      scaleMargins: { top: 0.15, bottom: 0.02 },
    })

    chart.subscribeCrosshairMove(updateTooltip)
    chart.subscribeClick(onChartClick)
    chart.timeScale().subscribeVisibleTimeRangeChange(updateEventOverlay)

    const resizeObserver = new ResizeObserver(() => {
      chart.resize(mount.clientWidth, mount.clientHeight)
      updateEventOverlay()
      positionEventOverlay()
    })
    resizeObserver.observe(mount)

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        stickyTouchRef.current = true
      }
    }

    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!mount.contains(event.target as Node)) {
        stickyTouchRef.current = false
        setTooltip((current) => ({ ...current, visible: false }))
      }
    }

    mount.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerdown', onDocumentPointerDown)

    return () => {
      mount.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRefs.current.clear()
      movesUpRef.current = null
      movesDownRef.current = null
    }
  }, [onChartClick, positionEventOverlay, updateEventOverlay, updateTooltip])

  useEffect(() => {
    applyMovesData()
  }, [applyMovesData, props.dataset, props.movesPoints])

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
      <div className="prototype-chart-viewport">
        <div className="prototype-chart-mount" ref={chartMountRef} />
        <div className="prototype-event-overlay" ref={overlayRef} aria-hidden="true">
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
        <Tooltip {...tooltip} showSeriesMeta={props.showTooltipSeriesMeta} />
      </div>
    </div>
  )
}
