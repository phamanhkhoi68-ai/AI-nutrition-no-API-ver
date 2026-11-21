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
Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true })

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { reset, get, set, login, selectPatient, approvePlan, rejectPlan } from '../src/services/store'
import { CDSSReviewPage } from '../src/pages/Expert'
import { Logs as AdminLogs } from '../src/pages/Admin'
import AIOpsCenter from '../src/pages/AIOpsCenter'
import Shell from '../src/layouts/Shell'
import { EVAL_CASE_COUNT } from '../src/evals/aiEvalSuite'

beforeEach(() => {
  mockStorage.clear()
  reset()
})

afterEach(() => {
  cleanup()
})

describe('Phase 0.5 HITL Surgical Patch: Plan State Guards & Empty Queue UI', () => {
  it('allows PENDING_EXPERT_REVIEW -> Approve & Reject, and enforces idempotency for same-note re-approval (L08)', () => {
    login('expert@demo.vn', 'Demo123!')
    selectPatient('u1')

    const planId = get().plans[0].id
    expect(get().plans[0].status).toBe('PENDING_EXPERT_REVIEW')

    // 1. Valid approval
    const firstErr = approvePlan(planId, 'Đạt ngưỡng lâm sàng KDIGO')
    expect(firstErr).toBe('')
    expect(get().plans[0].status).toBe('EXPERT_APPROVED')
    const histLenAfterApprove = get().plans[0].history.length
    const verAfterApprove = get().plans[0].version

    // 2. Same note re-approval is idempotent no-op
    const sameNoteErr = approvePlan(planId, 'Đạt ngưỡng lâm sàng KDIGO')
    expect(sameNoteErr).toBe('')
    expect(get().plans[0].history.length).toBe(histLenAfterApprove)
    expect(get().plans[0].version).toBe(verAfterApprove)

    // 3. Rejecting an already approved plan is blocked
    const rejectApprovedErr = rejectPlan(planId, 'Thử từ chối sau khi duyệt', 'u1')
    expect(rejectApprovedErr).not.toBe('')
    expect(get().plans[0].status).toBe('EXPERT_APPROVED')

    // 4. Re-approving with a DIFFERENT note is blocked and does not overwrite
    const diffNoteErr = approvePlan(planId, 'Ghi chú mới ghi đè', undefined, 'u1')
    expect(diffNoteErr).not.toBe('')
    expect(get().plans[0].expert_notes).toBe('Đạt ngưỡng lâm sàng KDIGO')
    expect(get().plans[0].history.length).toBe(histLenAfterApprove)
  })

  it('blocks approvePlan and rejectPlan on REJECTED and DRAFT plans', () => {
    login('expert@demo.vn', 'Demo123!')
    selectPatient('u1')

    const planId = get().plans[0].id
    // Reject valid pending plan first
    const rejErr = rejectPlan(planId, 'Vượt ngưỡng Natri', 'u1')
    expect(rejErr).toBe('')
    expect(get().plans[0].status).toBe('REJECTED')

    // Approve & Reject on REJECTED must be blocked
    expect(approvePlan(planId, 'Thử duyệt plan đã từ chối', undefined, 'u1')).not.toBe('')
    expect(rejectPlan(planId, 'Từ chối lần 2', 'u1')).not.toBe('')
    expect(get().plans[0].status).toBe('REJECTED')

    // Force DRAFT status and verify both approvePlan and rejectPlan block it
    set(d => {
      d.plans[0].status = 'DRAFT'
    })
    expect(approvePlan(planId, 'Duyệt bản nháp', undefined, 'u1')).not.toBe('')
    expect(rejectPlan(planId, 'Từ chối bản nháp', 'u1')).not.toBe('')
    expect(get().plans[0].status).toBe('DRAFT')
  })

  it('CDSSReviewPage renders explicit empty state without falling back to EXPERT_APPROVED / REJECTED plans', () => {
    login('expert@demo.vn', 'Demo123!')
    selectPatient('u1')

    // Approve the only plan so no PENDING_EXPERT_REVIEW plan remains
    const planId = get().plans[0].id
    expect(approvePlan(planId, 'Đã thẩm định')).toBe('')
    expect(get().plans[0].status).toBe('EXPERT_APPROVED')

    render(
      <MemoryRouter>
        <CDSSReviewPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Không có thực đơn chờ thẩm định')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Phê duyệt Lâm sàng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Từ chối Thực đơn/i })).toBeNull()
  })
})

describe('Phase 1-4 Staff Atelier Scoping, Mobile Patient Context & Honest Telemetry Labels', () => {
  it('Shell applies .staff-atelier-root ONLY for expert/admin (never patient) and renders non-hidden Patient Context selector', () => {
    // 1. Patient compatibility mode -> NO .staff-atelier-root
    login('patient@demo.vn', 'Demo123!')
    const patientRender = render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    )
    expect(patientRender.container.querySelector('.staff-atelier-root')).toBeNull()
    cleanup()

    // 2. Expert mode -> HAS .staff-atelier-root & visible Patient Context selector
    login('expert@demo.vn', 'Demo123!')
    const expertRender = render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    )
    expect(expertRender.container.querySelector('.staff-atelier-root')).not.toBeNull()
    const selectEl = screen.getByLabelText('Hồ sơ bệnh nhân đang xem')
    expect(selectEl).toBeTruthy()
    expect(selectEl.closest('label')?.className).not.toContain('hidden')
    cleanup()

    // 3. Admin mode -> HAS .staff-atelier-root
    login('admin@demo.vn', 'Demo123!')
    const adminRender = render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    )
    expect(adminRender.container.querySelector('.staff-atelier-root')).not.toBeNull()
  })

  it('Admin Logs and AIOpsCenter display honest Patient context scope labels and AIOpsCenter keeps all 5 tabs', () => {
    login('admin@demo.vn', 'Demo123!')
    selectPatient('u1')

    const logsRender = render(
      <MemoryRouter>
        <AdminLogs />
      </MemoryRouter>
    )
    expect(logsRender.container.textContent).toContain('Hồ sơ đang chọn (Patient context)')
    expect(logsRender.container.textContent).not.toMatch(/toàn hệ thống|system-wide/i)
    cleanup()

    const opsRender = render(
      <MemoryRouter>
        <AIOpsCenter />
      </MemoryRouter>
    )
    expect(opsRender.container.textContent).toContain('Hồ sơ đang chọn (Patient context)')
    expect(opsRender.container.textContent).not.toMatch(/toàn hệ thống|system-wide/i)
    expect(screen.getByRole('tab', { name: 'Observability Waterfall' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Workflow DAG & Resume' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Real MCP Inspector' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Guardrails Red-Team' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: `AI Evals (${EVAL_CASE_COUNT} Ca)` })).toBeTruthy()
  })
})

