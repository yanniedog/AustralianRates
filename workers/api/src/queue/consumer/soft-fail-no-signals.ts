function hasOnlyNon2xxStatuses(statuses: number[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status < 200 || status >= 300)
}

export function shouldSoftFailNoSignals(input: {
  lenderCode: string
  successfulIndexFetch: boolean
  observedUpstreamStatuses: number[]
}): boolean {
  return (
    input.lenderCode === 'ubank' &&
    !input.successfulIndexFetch &&
    hasOnlyNon2xxStatuses(input.observedUpstreamStatuses)
  )
}
