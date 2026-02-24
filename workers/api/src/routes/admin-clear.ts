/**
 * Admin clear routes: delete rate data by scope (individual, group, multiselect, entire)
 * and product type (mortgages, savings, term_deposits, all).
 */

import { Hono } from 'hono'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'

const PRODUCT_TABLES: Record<string, string[]> = {
  mortgages: ['historical_loan_rates'],
  savings: ['historical_savings_rates'],
  term_deposits: ['historical_term_deposit_rates'],
  all: ['historical_loan_rates', 'historical_savings_rates', 'historical_term_deposit_rates'],
} as const

const TABLE_KEY_COLUMNS: Record<string, string[]> = {
  historical_loan_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'lvr_tier',
    'rate_structure',
    'security_purpose',
    'repayment_type',
    'run_source',
  ],
  historical_savings_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'rate_type',
    'deposit_tier',
    'run_source',
  ],
  historical_term_deposit_rates: [
    'bank_name',
    'collection_date',
    'product_id',
    'term_months',
    'deposit_tier',
    'run_source',
  ],
}

const GROUP_BY_ALLOWED: Record<string, string[]> = {
  historical_loan_rates: ['collection_date', 'bank_name', 'product_id', 'run_source'],
  historical_savings_rates: ['collection_date', 'bank_name', 'product_id', 'run_source'],
  historical_term_deposit_rates: ['collection_date', 'bank_name', 'product_id', 'run_source'],
}

type Scope = 'individual' | 'group' | 'multiselect' | 'entire'
type ProductType = 'mortgages' | 'savings' | 'term_deposits' | 'all'

function getTables(productType: string): string[] {
  const tables = PRODUCT_TABLES[productType as ProductType]
  return tables ? [...tables] : []
}

export const adminClearRoutes = new Hono<AppContext>()

/** GET /admin/db/clear/options - allowed product types, scopes, group_by columns */
adminClearRoutes.get('/db/clear/options', async (c) => {
  return c.json({
    ok: true,
    product_types: [
      { id: 'mortgages', label: 'Mortgages (home loans)' },
      { id: 'savings', label: 'Savings' },
      { id: 'term_deposits', label: 'Term deposits' },
      { id: 'all', label: 'All (mortgages, savings, term deposits)' },
    ],
    scopes: [
      { id: 'individual', label: 'Individual row (by full key)' },
      { id: 'group', label: 'Group (by collection date, bank, product, or run source)' },
      { id: 'multiselect', label: 'Multiple rows (array of keys)' },
      { id: 'entire', label: 'Entire table(s)' },
    ],
    group_by_options: ['collection_date', 'bank_name', 'product_id', 'run_source'],
    key_columns: TABLE_KEY_COLUMNS,
  })
})

/** POST /admin/db/clear - clear rate data by scope and product type */
adminClearRoutes.post('/db/clear', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const productType = (body.product_type as string) || ''
  const scope = (body.scope as Scope) || ''

  const tables = getTables(productType)
  if (tables.length === 0) {
    return jsonError(c, 400, 'BAD_REQUEST', 'product_type must be mortgages, savings, term_deposits, or all')
  }
  if (!['individual', 'group', 'multiselect', 'entire'].includes(scope)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'scope must be individual, group, multiselect, or entire')
  }
  if (productType === 'all' && (scope === 'individual' || scope === 'multiselect')) {
    return jsonError(
      c,
      400,
      'BAD_REQUEST',
      'For product_type "all" only scope "group" or "entire" is allowed (key shapes differ per table)',
    )
  }

  const db = c.env.DB
  const results: { table: string; deleted: number }[] = []

  if (scope === 'entire') {
    for (const table of tables) {
      const r = await db.prepare(`DELETE FROM ${table}`).run()
      results.push({ table, deleted: r.meta.changes ?? 0 })
    }
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      scope: 'entire',
      product_type: productType,
      results,
    })
  }

  if (scope === 'individual') {
    const key = body.key as Record<string, unknown> | undefined
    if (!key || typeof key !== 'object') {
      return jsonError(c, 400, 'BAD_REQUEST', 'scope individual requires key object')
    }
    for (const table of tables) {
      const keyCols = TABLE_KEY_COLUMNS[table]
      if (!keyCols) continue
      const whereParts: string[] = []
      const values: unknown[] = []
      for (const col of keyCols) {
        const v = key[col]
        if (v === undefined || v === null) {
          return jsonError(c, 400, 'BAD_REQUEST', `key missing required column: ${col}`)
        }
        whereParts.push(`${col} = ?`)
        values.push(v)
      }
      const where = whereParts.join(' AND ')
      const r = await db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...values).run()
      results.push({ table, deleted: r.meta.changes ?? 0 })
    }
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      scope: 'individual',
      product_type: productType,
      results,
    })
  }

  if (scope === 'group') {
    const groupBy = (body.group_by as string) || ''
    const value = body.value
    if (value === undefined || value === null) {
      return jsonError(c, 400, 'BAD_REQUEST', 'scope group requires value')
    }
    for (const table of tables) {
      const allowed = GROUP_BY_ALLOWED[table]
      if (!allowed || !allowed.includes(groupBy)) {
        return jsonError(c, 400, 'BAD_REQUEST', `group_by must be one of: ${(allowed || []).join(', ')} for ${table}`)
      }
      const r = await db
        .prepare(`DELETE FROM ${table} WHERE ${groupBy} = ?`)
        .bind(String(value))
        .run()
      results.push({ table, deleted: r.meta.changes ?? 0 })
    }
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      scope: 'group',
      product_type: productType,
      group_by: groupBy,
      results,
    })
  }

  if (scope === 'multiselect') {
    const keys = body.keys as Record<string, unknown>[] | undefined
    if (!Array.isArray(keys) || keys.length === 0) {
      return jsonError(c, 400, 'BAD_REQUEST', 'scope multiselect requires non-empty keys array')
    }
    for (const table of tables) {
      const keyCols = TABLE_KEY_COLUMNS[table]
      if (!keyCols) continue
      let totalDeleted = 0
      for (const key of keys) {
        if (!key || typeof key !== 'object') continue
        const whereParts: string[] = []
        const values: unknown[] = []
        for (const col of keyCols) {
          const v = key[col]
          if (v === undefined || v === null) break
          whereParts.push(`${col} = ?`)
          values.push(v)
        }
        if (whereParts.length !== keyCols.length) continue
        const where = whereParts.join(' AND ')
        const r = await db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...values).run()
        totalDeleted += r.meta.changes ?? 0
      }
      results.push({ table, deleted: totalDeleted })
    }
    return c.json({
      ok: true,
      auth_mode: c.get('adminAuthState')?.mode ?? null,
      scope: 'multiselect',
      product_type: productType,
      results,
    })
  }

  return jsonError(c, 400, 'BAD_REQUEST', 'Invalid scope')
})
