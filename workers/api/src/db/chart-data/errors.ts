export class ChartDataRequestError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ChartDataRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class OffsetFieldUnavailableError extends ChartDataRequestError {
  constructor(message: string, details?: unknown) {
    super(422, 'OFFSET_FIELD_UNAVAILABLE', message, details)
    this.name = 'OffsetFieldUnavailableError'
  }
}
