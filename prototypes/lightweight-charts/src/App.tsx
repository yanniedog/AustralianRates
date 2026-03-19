import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import Chart from './components/Chart'
import Legend from './components/Legend'
import { fetchChartData, fetchFilters } from './lib/api'
import {
  buildChartRequestKey,
  datasetLabel,
  defaultSelection,
  loadHiddenSeries,
  readPrototypeConfig,
  saveHiddenSeries,
  toRenderableSeries,
} from './lib/chartHelpers'
import type {
  AnyChartResponse,
  AnyFilters,
  AnySelection,
  DatasetKey,
  DatasetRuntimeState,
  HomeLoanFilters,
  HomeLoanSelection,
  RangeKey,
  SavingsFilters,
  SavingsSelection,
  TdFilters,
  TdSelection,
} from './lib/types'

const DATASETS: DatasetKey[] = ['home-loans', 'savings', 'term-deposits']
const RANGES: RangeKey[] = ['1Y', '3Y', '5Y', 'ALL']

function initialState(): DatasetRuntimeState {
  return {
    filters: null,
    selection: null,
    response: null,
    range: '1Y',
    loadingFilters: false,
    loadingChart: false,
    error: null,
    hiddenSeriesIds: [],
    highlightedSeriesId: null,
    lastLoadedKey: null,
  }
}

function parseInitialDataset(): DatasetKey {
  const dataset = new URLSearchParams(window.location.search).get('dataset')
  return DATASETS.includes(dataset as DatasetKey) ? (dataset as DatasetKey) : 'home-loans'
}

function cloneFilters<T extends AnyFilters>(filters: T): T {
  return JSON.parse(JSON.stringify(filters)) as T
}

export default function App() {
  const config = useMemo(() => readPrototypeConfig(), [])
  const initialParamsRef = useRef(new URLSearchParams(window.location.search))
  const [activeDataset, setActiveDataset] = useState<DatasetKey>(parseInitialDataset)
  const [states, setStates] = useState<Record<DatasetKey, DatasetRuntimeState>>({
    'home-loans': initialState(),
    savings: initialState(),
    'term-deposits': initialState(),
  })

  const currentState = states[activeDataset]
  const currentSeries = useMemo(
    () => (currentState.response ? toRenderableSeries(activeDataset, currentState.response as AnyChartResponse) : []),
    [activeDataset, currentState.response],
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('dataset', activeDataset)
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [activeDataset])

  useEffect(() => {
    if (currentState.filters || currentState.loadingFilters) return
    const controller = new AbortController()
    setStates((previous) => ({
      ...previous,
      [activeDataset]: {
        ...previous[activeDataset],
        loadingFilters: true,
        error: null,
      },
    }))

    fetchFilters(activeDataset, controller.signal)
      .then((filters) => {
        startTransition(() => {
          setStates((previous) => ({
            ...previous,
            [activeDataset]: {
              ...previous[activeDataset],
              filters: cloneFilters(filters),
              selection: previous[activeDataset].selection ?? defaultSelection(activeDataset, filters, initialParamsRef.current),
              loadingFilters: false,
              error: null,
            },
          }))
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setStates((previous) => ({
          ...previous,
          [activeDataset]: {
            ...previous[activeDataset],
            loadingFilters: false,
            error: error instanceof Error ? error.message : 'Unable to load real filter data.',
          },
        }))
      })

    return () => controller.abort()
  }, [activeDataset, currentState.filters, currentState.loadingFilters])

  useEffect(() => {
    if (!currentState.selection || !currentState.filters) return
    const requestKey = buildChartRequestKey(activeDataset, currentState.selection, currentState.range)
    if (currentState.lastLoadedKey === requestKey && (currentState.response || currentState.error)) return

    const controller = new AbortController()
    setStates((previous) => ({
      ...previous,
      [activeDataset]: {
        ...previous[activeDataset],
        loadingChart: true,
        error: null,
      },
    }))

    fetchChartData(activeDataset, currentState.selection, currentState.range, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        if (response.series.length === 0) {
          setStates((previous) => ({
            ...previous,
            [activeDataset]: {
              ...previous[activeDataset],
              response: null,
              loadingChart: false,
              error: 'No real data returned for the selected filters and date range.',
              lastLoadedKey: requestKey,
            },
          }))
          return
        }
        const hiddenSeriesIds = loadHiddenSeries(config.prototypeSlug, activeDataset).filter((seriesId) =>
          response.series.some((series) => series.id === seriesId),
        )
        startTransition(() => {
          setStates((previous) => ({
            ...previous,
            [activeDataset]: {
              ...previous[activeDataset],
              response,
              loadingChart: false,
              error: null,
              hiddenSeriesIds,
              lastLoadedKey: requestKey,
            },
          }))
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setStates((previous) => ({
          ...previous,
          [activeDataset]: {
            ...previous[activeDataset],
            response: null,
            loadingChart: false,
            error: error instanceof Error ? error.message : 'Unable to load real chart data.',
            lastLoadedKey: requestKey,
          },
        }))
      })

    return () => controller.abort()
  }, [activeDataset, config.prototypeSlug, currentState.error, currentState.filters, currentState.lastLoadedKey, currentState.range, currentState.response, currentState.selection])

  function updateSelection(nextSelection: AnySelection) {
    setStates((previous) => ({
      ...previous,
      [activeDataset]: {
        ...previous[activeDataset],
        selection: nextSelection,
        response: null,
        error: null,
        lastLoadedKey: null,
      },
    }))
  }

  function renderFilters() {
    if (!currentState.filters || !currentState.selection) return null
    if (activeDataset === 'home-loans') {
      const filters = currentState.filters as HomeLoanFilters
      const selection = currentState.selection as HomeLoanSelection
      return (
        <div className="prototype-filter-grid">
          <label className="prototype-field">
            <span className="prototype-field-label">Occupancy</span>
            <select
              className="prototype-select"
              value={selection.occupancy}
              onChange={(event) => updateSelection({ ...selection, occupancy: event.target.value as HomeLoanSelection['occupancy'] })}
            >
              <option value="Owner">Owner</option>
              <option value="Investor">Investor</option>
            </select>
          </label>
          <label className="prototype-field">
            <span className="prototype-field-label">Repayment</span>
            <select
              className="prototype-select"
              value={selection.repaymentType}
              onChange={(event) => updateSelection({ ...selection, repaymentType: event.target.value as HomeLoanSelection['repaymentType'] })}
            >
              <option value="P&I">P&amp;I</option>
              <option value="IO">IO</option>
            </select>
          </label>
          <label className="prototype-field">
            <span className="prototype-field-label">LVR</span>
            <select
              className="prototype-select"
              value={selection.lvr}
              onChange={(event) => updateSelection({ ...selection, lvr: Number(event.target.value) })}
            >
              {filters.lvr_tiers.map((tier) => {
                const value = tier === 'lvr_=60%' ? 60 : Number(tier.match(/(\d+)-(\d+)%$/)?.[2] || 80)
                return (
                  <option key={tier} value={value}>
                    {value}%
                  </option>
                )
              })}
            </select>
          </label>
          <label className="prototype-field">
            <span className="prototype-field-label">Offset</span>
            <select
              className="prototype-select"
              value={selection.offset ? 'true' : 'false'}
              onChange={(event) => updateSelection({ ...selection, offset: event.target.value === 'true' })}
            >
              <option value="false">No offset</option>
              <option value="true">Offset</option>
            </select>
          </label>
        </div>
      )
    }
    if (activeDataset === 'savings') {
      const filters = currentState.filters as SavingsFilters
      const selection = currentState.selection as SavingsSelection
      return (
        <div className="prototype-filter-grid">
          <label className="prototype-field">
            <span className="prototype-field-label">Account type</span>
            <select
              className="prototype-select"
              value={selection.accountType ?? ''}
              onChange={(event) => updateSelection({ ...selection, accountType: event.target.value || undefined })}
            >
              <option value="">All account types</option>
              {filters.account_types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="prototype-field">
            <span className="prototype-field-label">Rate type</span>
            <select
              className="prototype-select"
              value={selection.rateType ?? ''}
              onChange={(event) => updateSelection({ ...selection, rateType: event.target.value || undefined })}
            >
              <option value="">All rate types</option>
              {filters.rate_types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="prototype-field">
            <span className="prototype-field-label">Deposit tier</span>
            <select
              className="prototype-select"
              value={selection.depositTier ?? ''}
              onChange={(event) => updateSelection({ ...selection, depositTier: event.target.value || undefined })}
            >
              <option value="">All deposit tiers</option>
              {filters.deposit_tiers.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      )
    }
    const filters = currentState.filters as TdFilters
    const selection = currentState.selection as TdSelection
    return (
      <div className="prototype-filter-grid">
        <label className="prototype-field">
          <span className="prototype-field-label">Term months</span>
          <select
            className="prototype-select"
            value={selection.termMonths ?? ''}
            onChange={(event) => updateSelection({ ...selection, termMonths: Number(event.target.value) || undefined })}
          >
            {filters.term_months.map((value) => (
              <option key={value} value={value}>
                {value} months
              </option>
            ))}
          </select>
        </label>
        <label className="prototype-field">
          <span className="prototype-field-label">Interest payment</span>
          <select
            className="prototype-select"
            value={selection.interestPayment ?? ''}
            onChange={(event) => updateSelection({ ...selection, interestPayment: event.target.value || undefined })}
          >
            {filters.interest_payments.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="prototype-field">
          <span className="prototype-field-label">Deposit tier</span>
          <select
            className="prototype-select"
            value={selection.depositTier ?? ''}
            onChange={(event) => updateSelection({ ...selection, depositTier: event.target.value || undefined })}
          >
            <option value="">All deposit tiers</option>
            {filters.deposit_tiers.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  function toggleLender(lender: string) {
    if (!currentState.selection) return
    const selection = currentState.selection as HomeLoanSelection | SavingsSelection | TdSelection
    const nextLenders = selection.lenders.includes(lender)
      ? selection.lenders.filter((value) => value !== lender)
      : [...selection.lenders, lender]
    if (nextLenders.length === 0) return
    updateSelection({ ...selection, lenders: nextLenders })
  }

  function toggleSeries(seriesId: string) {
    const nextHidden = currentState.hiddenSeriesIds.includes(seriesId)
      ? currentState.hiddenSeriesIds.filter((value) => value !== seriesId)
      : [...currentState.hiddenSeriesIds, seriesId]
    saveHiddenSeries(config.prototypeSlug, activeDataset, nextHidden)
    setStates((previous) => ({
      ...previous,
      [activeDataset]: {
        ...previous[activeDataset],
        hiddenSeriesIds: nextHidden,
      },
    }))
  }

  return (
    <div className="prototype-page">
      <section className="prototype-hero">
        <p className="prototype-kicker">Prototype</p>
        <h1 className="prototype-title">Real-data Lightweight Charts</h1>
        <p className="prototype-copy">
          Lightweight Charts prototype isolated from the public stack. Every render is bootstrapped from live filter endpoints and dataset-specific
          `/chart-data` responses. Empty, malformed, or unavailable data blocks the chart instead of falling back.
        </p>
      </section>

      <section className="prototype-card">
        <div className="prototype-tabs">
          {DATASETS.map((dataset) => (
            <button
              className={`prototype-tab${dataset === activeDataset ? ' is-active' : ''}`}
              key={dataset}
              type="button"
              onClick={() => setActiveDataset(dataset)}
            >
              {datasetLabel(dataset)}
            </button>
          ))}
        </div>
        <div className="prototype-ranges">
          {RANGES.map((range) => (
            <button
              className={`prototype-range${range === currentState.range ? ' is-active' : ''}`}
              key={range}
              type="button"
              onClick={() =>
                setStates((previous) => ({
                  ...previous,
                  [activeDataset]: {
                    ...previous[activeDataset],
                    range,
                    response: null,
                    error: null,
                    lastLoadedKey: null,
                  },
                }))
              }
            >
              {range}
            </button>
          ))}
        </div>
        {currentState.filters ? (
          <>
            <div className="prototype-lenders">
              {(currentState.filters as HomeLoanFilters | SavingsFilters | TdFilters).banks.map((lender) => {
                const selectedLenders = (currentState.selection as HomeLoanSelection | SavingsSelection | TdSelection | null)?.lenders ?? []
                return (
                  <button
                    className={`prototype-lender${selectedLenders.includes(lender) ? ' is-active' : ''}`}
                    key={lender}
                    type="button"
                    onClick={() => toggleLender(lender)}
                  >
                    {lender}
                  </button>
                )
              })}
            </div>
            {renderFilters()}
          </>
        ) : null}
      </section>

      <section className="prototype-chart-shell">
        <div className="prototype-chart-header">
          <div>
            <p className="prototype-kicker">{datasetLabel(activeDataset)}</p>
            <h2>Rate history</h2>
            <p className="prototype-meta">
              {currentState.loadingFilters ? 'Loading real filter options…' : currentState.loadingChart ? 'Loading real chart data…' : 'Crosshair and tap surface only real recorded values.'}
            </p>
          </div>
          <button className="prototype-logout" type="button" onClick={() => window.AR?.AdminPortal?.logout()}>
            Log out
          </button>
        </div>
        {currentState.error ? <div className="prototype-error">{currentState.error}</div> : null}
        {!currentState.error && currentSeries.length === 0 && !currentState.loadingChart ? (
          <div className="prototype-empty">No real chart data is available for the current selection.</div>
        ) : null}
        {!currentState.error && currentSeries.length > 0 ? (
          <div className="prototype-chart-grid">
            <Chart
              dataset={activeDataset}
              series={currentSeries}
              events={currentState.response?.events ?? []}
              hiddenSeriesIds={currentState.hiddenSeriesIds}
              highlightedSeriesId={currentState.highlightedSeriesId}
            />
            <Legend
              series={currentSeries}
              hiddenSeriesIds={currentState.hiddenSeriesIds}
              highlightedSeriesId={currentState.highlightedSeriesId}
              onToggle={toggleSeries}
              onHighlight={(seriesId) =>
                setStates((previous) => ({
                  ...previous,
                  [activeDataset]: {
                    ...previous[activeDataset],
                    highlightedSeriesId: seriesId,
                  },
                }))
              }
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}
