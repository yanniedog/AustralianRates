import { dateRangeInclusive } from '../economic/parser-utils'

export type EconomicObservationRow = {
  series_id: string
  observation_date: string
  value: number
  source_url: string
  release_date: string | null
  frequency: string
  proxy_flag: number
  fetched_at: string
  notes_json: string | null
}

export type EconomicStatusRow = {
  series_id: string
  last_checked_at: string
  last_success_at: string | null
  last_observation_date: string | null
  last_value: number | null
  status: string
  message: string | null
  source_url: string
  proxy_flag: number
}

export type EconomicPointRow = {
  date: string
  raw_value: number | null
  normalized_value: number | null
  observation_date: string | null
  release_date: string | null
}

type EconomicObservationInput = {
  seriesId: string
  observationDate: string
  value: number
  sourceUrl: string
  releaseDate: string | null
  frequency: string
  proxy: boolean
  notesJson?: string | null
}

type EconomicStatusInput = {
  seriesId: string
  lastCheckedAt: string
  lastSuccessAt: string | null
  lastObservationDate: string | null
  lastValue: number | null
  status: string
  message: string | null
  sourceUrl: string
  proxy: boolean
}

const UPSERT_OBSERVATION_SQL = `INSERT INTO economic_series_observations (
  series_id,
  observation_date,
  value,
  source_url,
  release_date,
  frequency,
  proxy_flag,
  fetched_at,
  notes_json
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, ?8)
ON CONFLICT(series_id, observation_date) DO UPDATE SET
  value = excluded.value,
  source_url = excluded.source_url,
  release_date = excluded.release_date,
  frequency = excluded.frequency,
  proxy_flag = excluded.proxy_flag,
  fetched_at = CURRENT_TIMESTAMP,
  notes_json = excluded.notes_json`

const UPSERT_STATUS_SQL = `INSERT INTO economic_series_status (
  series_id,
  last_checked_at,
  last_success_at,
  last_observation_date,
  last_value,
  status,
  message,
  source_url,
  proxy_flag
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT(series_id) DO UPDATE SET
  last_checked_at = excluded.last_checked_at,
  last_success_at = excluded.last_success_at,
  last_observation_date = excluded.last_observation_date,
  last_value = excluded.last_value,
  status = excluded.status,
  message = excluded.message,
  source_url = excluded.source_url,
  proxy_flag = excluded.proxy_flag`

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size))
  }
  return output
}

export async function upsertEconomicObservations(
  db: D1Database,
  observations: EconomicObservationInput[],
): Promise<void> {
  if (observations.length === 0) return
  const deduped = Array.from(
    new Map(observations.map((row) => [`${row.seriesId}:${row.observationDate}`, row])).values(),
  )

  for (const part of chunk(deduped, 64)) {
    await db.batch(
      part.map((row) =>
        db
          .prepare(UPSERT_OBSERVATION_SQL)
          .bind(
            row.seriesId,
            row.observationDate,
            row.value,
            row.sourceUrl,
            row.releaseDate,
            row.frequency,
            row.proxy ? 1 : 0,
            row.notesJson ?? null,
          ),
      ),
    )
  }
}

export async function upsertEconomicStatus(db: D1Database, input: EconomicStatusInput): Promise<void> {
  await db
    .prepare(UPSERT_STATUS_SQL)
    .bind(
      input.seriesId,
      input.lastCheckedAt,
      input.lastSuccessAt,
      input.lastObservationDate,
      input.lastValue,
      input.status,
      input.message,
      input.sourceUrl,
      input.proxy ? 1 : 0,
    )
    .run()
}

export async function getEconomicStatusMap(
  db: D1Database,
  seriesIds?: string[],
): Promise<Map<string, EconomicStatusRow>> {
  const rows: EconomicStatusRow[] = []
  if (!seriesIds || seriesIds.length === 0) {
    const result = await db.prepare('SELECT * FROM economic_series_status').all<EconomicStatusRow>()
    rows.push(...(result.results ?? []))
  } else {
    for (const seriesId of seriesIds) {
      const row = await db
        .prepare('SELECT * FROM economic_series_status WHERE series_id = ?1')
        .bind(seriesId)
        .first<EconomicStatusRow>()
      if (row) rows.push(row)
    }
  }
  return new Map(rows.map((row) => [row.series_id, row]))
}

export async function getEconomicObservationsForSeries(
  db: D1Database,
  seriesId: string,
  startDate: string,
  endDate: string,
): Promise<EconomicObservationRow[]> {
  const prior = await db
    .prepare(
      `SELECT *
       FROM economic_series_observations
       WHERE series_id = ?1
         AND observation_date < ?2
       ORDER BY observation_date DESC
       LIMIT 1`,
    )
    .bind(seriesId, startDate)
    .first<EconomicObservationRow>()

  const result = await db
    .prepare(
      `SELECT *
       FROM economic_series_observations
       WHERE series_id = ?1
         AND observation_date >= ?2
         AND observation_date <= ?3
       ORDER BY observation_date ASC`,
    )
    .bind(seriesId, startDate, endDate)
    .all<EconomicObservationRow>()

  const rows = result.results ?? []
  if (!prior) return rows
  return [prior, ...rows]
}

export function expandEconomicObservationsDaily(
  observations: EconomicObservationRow[],
  startDate: string,
  endDate: string,
): { baselineDate: string | null; baselineValue: number | null; points: EconomicPointRow[] } {
  const sorted = observations
    .slice()
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date))
  const finalObservationDate = sorted.length ? sorted[sorted.length - 1].observation_date : ''

  let cursor = 0
  let active: EconomicObservationRow | null = null
  let baselineDate: string | null = null
  let baselineValue: number | null = null
  const points: EconomicPointRow[] = []

  for (const date of dateRangeInclusive(startDate, endDate)) {
    while (cursor < sorted.length && sorted[cursor].observation_date <= date) {
      active = sorted[cursor]
      cursor += 1
    }

    if (!active || (finalObservationDate && date > finalObservationDate)) {
      points.push({
        date,
        raw_value: null,
        normalized_value: null,
        observation_date: null,
        release_date: null,
      })
      continue
    }

    if (baselineValue == null) {
      baselineValue = active.value
      baselineDate = date
    }

    points.push({
      date,
      raw_value: active.value,
      normalized_value:
        baselineValue == null || baselineValue === 0 ? null : Number(((active.value / baselineValue) * 100).toFixed(3)),
      observation_date: active.observation_date,
      release_date: active.release_date,
    })
  }

  return { baselineDate, baselineValue, points }
}
