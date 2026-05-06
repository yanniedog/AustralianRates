import { describe, expect, it } from 'vitest'
import { SLICE_PAIR_STATS_PAYLOAD_VERSION } from '../src/db/slice-pair-cache'
import { KV_VALUE_SAFE_BYTE_LIMIT, serializeJsonForKv } from '../src/db/public-cache-support'

describe('slice pair KV serialization guard', () => {
  it('returns null and skips writes when slice-pair payload exceeds KV byte limit', () => {
    const pad = 'y'.repeat(KV_VALUE_SAFE_BYTE_LIMIT)
    const payload = { v: SLICE_PAIR_STATS_PAYLOAD_VERSION, stats: { pad } }
    const key = 'chart:home_loans:slice-pair-stats:v3:testkey'
    expect(serializeJsonForKv(key, payload, { source: 'slice_pair_stats' })).toBeNull()
  })
})
