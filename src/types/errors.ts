export interface ExtendedError extends Error {
  code: number
  reason: any
}

export interface AbstractError extends Error {
  [key: string]: any
}
