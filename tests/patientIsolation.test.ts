// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('patient-specific local records', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        clear: () => data.clear()
      }
    })
    vi.resetModules()
  })

  it('preserves both patients across role changes, reloads and expert selection', async () => {
    let store = await import('../src/services/store')
    expect(store.login('patient@demo.vn', 'Demo123!')).toBe('')
    store.set(state => {
      state.profile.goal = 'An riêng'
      state.profile.allergies = 'cá'
      state.diary['qa-day'] = { 'Bữa sáng': [{ foodId: 'F001', grams: 100 }] }
    })
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    expect(store.get().profile.conditions).toEqual([])
    expect(store.get().profile.files).toEqual([])
    expect(store.get().profile.allergies).toBe('')
    expect(store.get().diary).toEqual({})
    expect(store.get().plans).toEqual([])
    store.set(state => { state.profile.goal = 'Hồ sơ thử riêng' })
    vi.resetModules()
    store = await import('../src/services/store')
    expect(store.get().profile.goal).toBe('Hồ sơ thử riêng')
    expect(store.login('patient@demo.vn', 'Demo123!')).toBe('')
    expect(store.get().profile.goal).toBe('An riêng')
    expect(store.get().profile.allergies).toBe('cá')
    expect(store.get().diary['qa-day']['Bữa sáng'][0].grams).toBe(100)
    store.selectPatient('u-test-patient')
    expect(store.get().profile.goal).toBe('An riêng')
    expect(store.login('expert@demo.vn', 'Demo123!')).toBe('')
    store.selectPatient('u-test-patient')
    expect(store.get().profile.goal).toBe('Hồ sơ thử riêng')
    store.selectPatient('u1')
    expect(store.get().profile.goal).toBe('An riêng')
  })

  it('migrates a legacy shared record without losing it', async () => {
    const { seed } = await import('../src/data/seed')
    const legacy = seed()
    legacy.users = legacy.users.filter(user => user.id !== 'u-test-patient')
    legacy.profile.goal = 'Dữ liệu đã có'
    window.localStorage.setItem('ainp_v4', JSON.stringify(legacy))
    vi.resetModules()
    const store = await import('../src/services/store')
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    expect(store.get().profile.goal).toBe('')
    expect(store.login('patient@demo.vn', 'Demo123!')).toBe('')
    expect(store.get().profile.goal).toBe('Dữ liệu đã có')
  })
})
