import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Shell from './layouts/Shell'
import PatientLiquidShell from './layouts/PatientLiquidShell'
import Login from './pages/Login'
import * as P from './pages/Patient'
import Diary from './pages/Diary'
import * as E from './pages/Expert'
import * as A from './pages/Admin'
import AIOpsCenter from './pages/AIOpsCenter'
import { me, useS } from './services/store'

// Cấu hình AI nằm ở src/services/aiConfig.ts (một nguồn duy nhất). KHÔNG đặt API key trong mã nguồn frontend:
// khoá nằm trong .env phía server và được gateway /api/ai/* sử dụng.
// Migration 1 lần: xoá khoá/endpoint/model cũ từng được nhúng tự động vào localStorage (khoá cũ đã bị lộ trong bundle).
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  try {
    if (!localStorage.getItem('ainp_cfg_migrated_v3')) {
      localStorage.removeItem('ainp_ai_api_key')
      localStorage.removeItem('ainp_gemini_api_key')
      localStorage.removeItem('ainp_ai_base_url')
      localStorage.removeItem('ainp_ai_model')
      localStorage.setItem('ainp_cfg_migrated_v3', '1')
    }
  } catch {}
}

function App() {
  const s = useS()
  const u = me(s)
  if (!u) return <Login />

  if (u.role === 'patient') {
    return (
      <Routes>
        <Route element={<PatientLiquidShell />}>
          <Route index element={<P.Dashboard />} />
          <Route path="ho-so" element={<P.ProfilePage />} />
          <Route path="thuc-pham" element={<P.Foods />} />
          <Route path="tu-van" element={<P.Chat />} />
          <Route path="thuc-don" element={<P.Planner />} />
          <Route path="nhat-ky-an" element={<Diary />} />
          <Route path="phan-tich" element={<P.Analysis />} />
          <Route path="thuc-don-tuan" element={<P.Planner week />} />
          <Route path="lich-su" element={<P.History />} />
          <Route path="tai-khoan" element={<P.Account />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    )
  }

  const R = {
    expert: (
      <>
        <Route index element={<E.Dashboard />} />
        <Route path="cdss-hitl" element={<E.CDSSReviewPage />} />
        <Route path="tai-lieu" element={<E.Docs />} />
        <Route path="quy-tac" element={<E.Rules />} />
        <Route path="lich-su-duyet" element={<E.Reviews />} />
        <Route path="ai-ops" element={<AIOpsCenter />} />
      </>
    ),
    admin: (
      <>
        <Route index element={<A.Dashboard />} />
        <Route path="nguoi-dung" element={<A.Users />} />
        <Route path="thuc-pham" element={<A.FoodsAdmin />} />
        <Route path="benh-ly" element={<A.Conditions />} />
        <Route path="tai-lieu" element={<E.Docs />} />
        <Route path="nhat-ky" element={<A.Logs />} />
        <Route path="ai-ops" element={<AIOpsCenter />} />
      </>
    )
  }[u.role]

  return (
    <Routes>
      <Route element={<Shell />}>
        {R}
        <Route path="tai-khoan" element={<P.Account />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  )
}
createRoot(document.getElementById('root')!).render(<StrictMode><HashRouter future={{ v7_relativeSplatPath: true }}><App /></HashRouter></StrictMode>)
