export const nowIso = (): string => {
  return new Date().toISOString()
}

export const toDateStamp = ({
  date = new Date()
}: {
  date?: Date
} = {}): string => {
  return date.toISOString().slice(0, 10)
}
