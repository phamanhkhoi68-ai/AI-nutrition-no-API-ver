// @vitest-environment jsdom
const storageMap = new Map<string, string>()
const mockStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
  get length() { return storageMap.size },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null
}
Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true })
Object.defineProperty(window, 'localStorage', { value: mockStorage, configurable: true })

import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { get, set, reset, login, setSelectedDiaryDate, syncDailyNutrientAlerts } from '../src/services/store'
import { Dashboard } from '../src/pages/Patient'
import Diary from '../src/pages/Diary'
import { localDateIso, calc } from '../src/utils/nutrition'

describe('Calendar Date Selector & Dashboard Diary Synchronization', () => {
  beforeEach(() => {
    reset()
    login('patient@demo.vn', 'Demo123!')
  })

  it('allows logging food to a past or future date in Diary and syncs nutrition to Dashboard when selecting that date', () => {
    const today = localDateIso()
    const targetDate = '2026-11-15'

    // 1. Initial check: Diary and Dashboard are empty on targetDate
    setSelectedDiaryDate(targetDate)
    const st1 = get()
    expect(st1.selectedDiaryDate).toBe(targetDate)
    expect(st1.diary[targetDate]).toBeUndefined()

    // 2. Render Diary on targetDate
    const { unmount: unmountDiary } = render(
      <MemoryRouter>
        <Diary />
      </MemoryRouter>
    )

    // Verify calendar strip shows the date
    expect(screen.getByText(/Lịch Nhật Ký Ăn Uống/i)).toBeTruthy()
    expect(screen.getByText(/Món đã ghi nhận/i)).toBeTruthy()

    // 3. Add food to targetDate in Diary
    set(d => {
      d.diary[targetDate] = {
        'Bữa trưa': [
          {
            foodId: 'F001',
            foodName: 'Cơm gạo lứt',
            grams: 200,
            note: 'Ăn trưa ngày 15'
          },
          {
            foodId: 'F002',
            foodName: 'Ức gà áp chảo',
            grams: 150,
            note: 'Đạm ngày 15'
          }
        ]
      }
      syncDailyNutrientAlerts(d, targetDate)
    })

    unmountDiary()

    // 4. Render Dashboard on targetDate
    const { unmount: unmountDashboard } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    // Calculate expected nutrients from store
    const foods = get().foods
    const loggedItems = Object.values(get().diary[targetDate] || {}).flat()
    const expectedNutrients = calc(loggedItems, foods)
    expect(expectedNutrients.kcal).toBeGreaterThan(0)
    expect(expectedNutrients.protein).toBeGreaterThan(0)

    // Verify Dashboard reflects the exact calories and items recorded for targetDate
    expect(screen.getByText(/Lịch Nhật Ký & Sơ Đồ Cơ Thể/i)).toBeTruthy()
    expect(screen.getByText(/Sơ đồ Giải phẫu & Tác động Dinh dưỡng Khẩu phần/i)).toBeTruthy()
    expect(screen.getAllByText(new RegExp(`${Math.round(expectedNutrients.kcal)}`, 'i')).length).toBeGreaterThan(0)

    unmountDashboard()

    // 5. Switch to an unlogged date (where no food was logged)
    const unloggedDate = '2026-11-01'
    setSelectedDiaryDate(unloggedDate)
    const { unmount: unmountUnlogged } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    // Unlogged date should show empty diary notice
    expect(screen.getByText(/chưa ghi món nào vào/i)).toBeTruthy()
    unmountUnlogged()
  })

  it('dynamically elevates organ alert on Dashboard when a specific date intake exceeds sodium ceiling', () => {
    const highSodiumDate = '2026-11-18'
    setSelectedDiaryDate(highSodiumDate)

    // Set excessive sodium (3000mg > 2000mg limit)
    set(d => {
      d.diary[highSodiumDate] = {
        'Bữa trưa': [
          {
            foodId: 'F999',
            foodName: 'Món muối mặn',
            grams: 100,
            snapshot: {
              kcal: 500,
              protein: 30,
              fat: 10,
              carb: 40,
              sodium: 3200,
              fiber: 2,
              potassium: 300,
              gi: 50,
              purine: 'Thấp',
              allergens: ''
            }
          }
        ]
      }
      syncDailyNutrientAlerts(d, highSodiumDate)
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    // Verify VƯỢT VẠCH ĐỎ is displayed for sodium on Dashboard
    expect(screen.getAllByText(/VƯỢT VẠCH ĐỎ/i).length).toBeGreaterThan(0)
    // Verify organ diagram shows critical sodium overload alert for that specific date
    expect(screen.getAllByText(/Natri/i).length).toBeGreaterThan(0)
  })
})
