import { randomUUID } from 'node:crypto'

export const createRunId = (): string => {
  return randomUUID()
}
