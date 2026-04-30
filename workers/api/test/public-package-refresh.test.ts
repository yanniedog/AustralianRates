import { describe, expect, it } from 'vitest'
import { PRECOMPUTED_CHART_WINDOWS } from '../src/db/chart-cache'
import { publicPackageRefreshSideEffectPolicy } from '../src/pipeline/public-package-refresh-cron'
import {
  publicSnapshotPackageScopeItems,
  publicSnapshotScopesForSection,
} from '../src/pipeline/public-package-scopes'

describe('public snapshot package scopes', () => {
  it('covers every selectable public window for home loans and savings', () => {
    for (const section of ['home_loans', 'savings'] as const) {
      const scopes = publicSnapshotScopesForSection(section)

      expect(scopes).toContain('default')
      expect(scopes).toContain('preset:consumer-default')
      for (const window of PRECOMPUTED_CHART_WINDOWS) {
        expect(scopes).toContain(`window:${window}`)
        expect(scopes).toContain(`preset:consumer-default:window:${window}`)
      }
      expect(new Set(scopes).size).toBe(scopes.length)
    }
  })

  it('covers every selectable public window for term deposits without unsupported presets', () => {
    const scopes = publicSnapshotScopesForSection('term_deposits')

    expect(scopes).toContain('default')
    for (const window of PRECOMPUTED_CHART_WINDOWS) {
      expect(scopes).toContain(`window:${window}`)
    }
    expect(scopes.some((scope) => scope.startsWith('preset:'))).toBe(false)
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it('prioritizes the bare default scope across all datasets before any windowed bucket', () => {
    // The homepage hero, slice-pair indicators and ribbon read `/snapshot`
    // with no `chart_window` query, which resolves to the bare default
    // scope (`default` and `preset:consumer-default`). Refreshing those
    // before 30D / 90D / 1Y buckets means the public ribbon recovers even
    // when the cron's CPU budget runs out partway through the iteration.
    expect(publicSnapshotPackageScopeItems().slice(0, 5)).toEqual([
      { section: 'home_loans', scope: 'preset:consumer-default' },
      { section: 'home_loans', scope: 'default' },
      { section: 'savings', scope: 'preset:consumer-default' },
      { section: 'savings', scope: 'default' },
      { section: 'term_deposits', scope: 'default' },
    ])
  })
})

describe('public package refresh side-effect policy', () => {
  it('keeps replay and persistent assurance enabled when D1 guardrails are clear', () => {
    expect(
      publicPackageRefreshSideEffectPolicy({
        emergencyMinimumWrites: false,
        nonEssentialDisabled: false,
      }),
    ).toEqual({
      suppressed: false,
      reason: null,
      runReplayMaintenance: true,
      assuranceOptions: {
        persist: true,
        emitHardFailureLog: true,
      },
    })
  })

  it('keeps the package refresh eligible in D1 emergency mode while suppressing D1 write side effects', () => {
    expect(
      publicPackageRefreshSideEffectPolicy({
        emergencyMinimumWrites: true,
        nonEssentialDisabled: false,
      }),
    ).toEqual({
      suppressed: true,
      reason: 'd1_emergency_minimum_writes',
      runReplayMaintenance: false,
      assuranceOptions: {
        persist: false,
        emitHardFailureLog: false,
      },
    })
  })

  it('also suppresses side effects when nonessential D1 work is disabled', () => {
    const policy = publicPackageRefreshSideEffectPolicy({
      emergencyMinimumWrites: false,
      nonEssentialDisabled: true,
    })

    expect(policy.runReplayMaintenance).toBe(false)
    expect(policy.assuranceOptions).toEqual({ persist: false, emitHardFailureLog: false })
    expect(policy.reason).toBe('d1_nonessential_disabled')
  })
})
