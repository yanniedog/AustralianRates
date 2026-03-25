import { describe, expect, it } from 'vitest'
import { detectUpstreamBlock } from '../src/utils/upstream-block'

describe('detectUpstreamBlock', () => {
  it('flags Akamai edgesuite Access Denied bodies (real WAF shape)', () => {
    const body = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>
<P>https://errors.edgesuite.net/18.d0b42e17.1774455417.8e9b705b</P>
</BODY></HTML>`
    const d = detectUpstreamBlock({ status: 403, body })
    expect(d.blocked).toBe(true)
    expect(d.reasonCode).toBe('upstream_block_waf')
  })
})
