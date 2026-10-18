import en from './en.json'
import th from './th.json'

const keys = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) =>
        keys(child, prefix ? `${prefix}.${key}` : key)
      )
    : [prefix]

describe('translations', () => {
  it('has the same keys in every language', () => {
    expect(keys(en).sort()).toEqual(keys(th).sort())
  })

  it('has no empty strings', () => {
    const values = [th, en].flatMap((file) =>
      keys(file).map((key) =>
        key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], file)
      )
    )
    expect(values.every((value) => typeof value === 'string' && value.trim() !== '')).toBe(true)
  })
})
