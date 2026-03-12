import { describe, expect, it } from 'vitest'
import {
  isOperationalInternalTable,
  isProtectedOperationalTableError,
} from '../src/routes/admin-download-operational'

describe('admin download operational helpers', () => {
  it('filters Cloudflare and sqlite internal tables from operational snapshots', () => {
    expect(isOperationalInternalTable('_cf_KV')).toBe(true)
    expect(isOperationalInternalTable('_cf_something_else')).toBe(true)
    expect(isOperationalInternalTable('sqlite_sequence')).toBe(true)
    expect(isOperationalInternalTable('run_reports')).toBe(false)
    expect(isOperationalInternalTable('historical_loan_rates')).toBe(false)
  })

  it('recognizes protected internal table access errors', () => {
    expect(
      isProtectedOperationalTableError(
        new Error('D1_ERROR: access to _cf_KV.key is prohibited: SQLITE_AUTH'),
      ),
    ).toBe(true)
    expect(isProtectedOperationalTableError(new Error('some other failure'))).toBe(false)
  })
})
