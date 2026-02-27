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

  it('includes product_url and published_at migration', () => {
    const file = resolve(process.cwd(), 'migrations/0013_product_url_published_at.sql')
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('ADD COLUMN product_url TEXT')
    expect(sql).toContain('ADD COLUMN published_at TEXT')
    expect(sql).toContain('SET product_url = source_url')
    expect(sql).toContain('CREATE VIEW vw_latest_rates AS')
    expect(sql).toContain('CREATE VIEW vw_latest_savings_rates AS')
    expect(sql).toContain('CREATE VIEW vw_latest_td_rates AS')
  })

  it('includes dataset coverage progress migration', () => {
    const file = resolve(process.cwd(), 'migrations/0014_dataset_coverage_progress.sql')
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS dataset_coverage_progress')
    expect(sql).toContain("dataset_key IN ('mortgage', 'savings', 'term_deposits')")
    expect(sql).toContain("status IN ('pending', 'active', 'completed_lower_bound')")
    expect(sql).toContain("INSERT OR IGNORE INTO dataset_coverage_progress (dataset_key, status)")
  })

  it('includes product presence status migration', () => {
    const file = resolve(process.cwd(), 'migrations/0016_product_presence_status.sql')
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_presence_status')
    expect(sql).toContain("section IN ('home_loans', 'savings', 'term_deposits')")
    expect(sql).toContain('is_removed INTEGER NOT NULL DEFAULT 0')
    expect(sql).toContain('PRIMARY KEY (section, bank_name, product_id)')
  })
})
