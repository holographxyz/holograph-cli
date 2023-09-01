export class IntrinsicGasTooLowError extends Error {
  constructor() {
    super('IntrinsicGasTooLowError')
    this.name = 'IntrinsicGasTooLowError'
  }
}

export class KnownTransactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnownTransactionError'
  }
}
