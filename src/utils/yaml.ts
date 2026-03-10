import { parse, stringify } from 'yaml'

export const parseYaml = <T>(source: string): T => {
  return parse(source) as T
}

export const stringifyYaml = (value: unknown): string => {
  return stringify(value)
}
