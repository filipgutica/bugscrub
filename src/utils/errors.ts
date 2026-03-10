export class CliError extends Error {
  public readonly exitCode: number

  public constructor({
    message,
    exitCode
  }: {
    message: string
    exitCode: number
  }) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export class ValidationError extends Error {
  public readonly details: string[]

  public constructor({
    message,
    details
  }: {
    message: string
    details: string[]
  }) {
    super(message)
    this.name = 'ValidationError'
    this.details = details
  }
}
