import type { HistoricalProductScope } from '../../types'

export type HistoricalTriggerSource = 'public' | 'admin'
export type HistoricalRunStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'
export type HistoricalTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed'

export type HistoricalRunRow = {
  run_id: string
  trigger_source: HistoricalTriggerSource
  product_scope: HistoricalProductScope
  run_source: 'scheduled' | 'manual'
  start_date: string
  end_date: string
  status: HistoricalRunStatus
  total_tasks: number
  pending_tasks: number
  claimed_tasks: number
  completed_tasks: number
  failed_tasks: number
  mortgage_rows: number
  savings_rows: number
  td_rows: number
  requested_by: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

export type HistoricalTaskRow = {
  task_id: number
  run_id: string
  lender_code: string
  collection_date: string
  status: HistoricalTaskStatus
  claimed_by: string | null
  claimed_at: string | null
  claim_expires_at: string | null
  completed_at: string | null
  attempt_count: number
  mortgage_rows: number
  savings_rows: number
  td_rows: number
  had_signals: number
  last_error: string | null
  updated_at: string
}

export type HistoricalRunDetail = {
  run: HistoricalRunRow
  progress_pct: number
  rows_total: number
  tasks_recent: HistoricalTaskRow[]
}
