import { describe, expect, it } from 'vitest'
import { createSyncRegistry } from './sync.registry'

const pull = async () => Promise.resolve([])

describe('createSyncRegistry', () => {
  it('keeps handlers by table, in registration order', () => {
    const registry = createSyncRegistry()
    registry.register({ table: 'currencies', pull })
    registry.register({ table: 'notes', pull })
    expect(registry.get('notes')?.table).toBe('notes')
    expect(registry.get('wallets')).toBeUndefined()
    expect(registry.all().map((handler) => handler.table)).toEqual(['currencies', 'notes'])
  })

  it('refuses a second handler for the same table', () => {
    const registry = createSyncRegistry()
    registry.register({ table: 'notes', pull })
    expect(() => registry.register({ table: 'notes', pull })).toThrow('already registered')
  })
})
