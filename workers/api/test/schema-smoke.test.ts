import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('schema migration smoke test', () => {
  it('contains expected core tables and views', () => {
    const file = resolve(process.cwd(), 'migrations/0001_init.sql')
    const sql = readFileSync(file, 'utf8')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS historical_loan_rates')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS raw_payloads')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS run_reports')
    expect(sql).toContain('CREATE VIEW IF NOT EXISTS vw_latest_rates')
    expect(sql).toContain('CREATE VIEW IF NOT EXISTS vw_rate_timeseries')
  })

  it('includes retrieval_type and auto backfill progress migration', () => {
    const file = resolve(process.cwd(), 'migrations/0010_retrieval_type_auto_backfill_progress.sql')
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('ADD COLUMN retrieval_type TEXT NOT NULL')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS auto_backfill_progress')
    expect(sql).toContain('next_collection_date TEXT NOT NULL')
    expect(sql).toContain("status IN ('active', 'completed_full_history')")
  })
})
