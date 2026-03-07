import { describe, expect, it } from 'vitest'
import { getExpectedBearerTokens, isAnyBearerTokenAuthorized, isBearerTokenAuthorized, parseBearerToken } from '../src/auth/admin'

describe('admin auth helpers', () => {
  it('parses bearer tokens correctly', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
    expect(parseBearerToken('bearer xyz')).toBe('xyz')
    expect(parseBearerToken('Token xyz')).toBeNull()
  })

  it('authorizes only exact bearer token matches', () => {
    expect(isBearerTokenAuthorized('abc', 'abc')).toBe(true)
    expect(isBearerTokenAuthorized('abc', 'def')).toBe(false)
    expect(isBearerTokenAuthorized(null, 'abc')).toBe(false)
  })

  it('accepts additive secondary admin tokens', () => {
    const expectedTokens = getExpectedBearerTokens({
      ADMIN_API_TOKEN: 'primary-token',
      ADMIN_API_TOKENS: 'secondary-token, tertiary-token',
    })

    expect(expectedTokens).toEqual(['primary-token', 'secondary-token', 'tertiary-token'])
    expect(isAnyBearerTokenAuthorized('secondary-token', expectedTokens)).toBe(true)
    expect(isAnyBearerTokenAuthorized('missing-token', expectedTokens)).toBe(false)
  })
})
