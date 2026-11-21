import { useState } from 'react'
import { Leaf, ShieldCheck, UtensilsCrossed, BookOpenCheck } from 'lucide-react'
import { login, get } from '../services/store'
import { verifyGatewaySession, setGatewayAuthStatus, setActiveSessionToken } from '../services/modelRouter'
import { Btn, Field, inp, Disclaimer } from '../components/ui'

export default function Login() {
  const [e, setE] = useState('patient@demo.vn')
  const [p, setP] = useState('Demo123!')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (x: React.FormEvent) => {
    x.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Email không hợp lệ.')
    if (p.length < 6) return setErr('Mật khẩu tối thiểu 6 ký tự.')
    setErr('')

    // 1. Kiểm tra thông tin đăng nhập cục bộ để phản hồi tức thì nếu sai mật khẩu / khóa tài khoản
    const storeState = get()
    const targetUser = storeState.users.find(u => u.email.toLowerCase() === e.trim().toLowerCase())
    if (!targetUser || targetUser.password !== p) {
      return setErr('Email hoặc mật khẩu không đúng.')
    }
    if (!targetUser.active) {
      return setErr('Tài khoản đã bị khóa.')
    }

    setLoading(true)

    // 2. Xác thực Backend & kiểm tra /api/auth/session trước khi coi Gateway đã xác thực
    if (typeof fetch === 'function' && typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: e.trim(), password: p })
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          // Nếu Backend gặp lỗi máy chủ (500) hoặc không tìm thấy route (404),
          // không chặn người dùng: tự động chuyển sang chế độ Client Demo để vào web bình thường
          if (res.status === 404 || res.status >= 500) {
            setGatewayAuthStatus('offline')
          } else {
            setGatewayAuthStatus('unauthenticated')
            setLoading(false)
            if (data?.error === 'CSRF_REJECTED' || res.status === 403) {
              return setErr(
                data?.error === 'CSRF_REJECTED'
                  ? 'Backend từ chối yêu cầu đăng nhập (CSRF_REJECTED): Origin hiện tại chưa được cấp phép trong CDSS_ALLOWED_ORIGINS.'
                  : data?.error || 'Tài khoản bị từ chối truy cập từ Backend (403).'
              )
            }
            return setErr(data?.error || `Xác thực Backend thất bại (HTTP ${res.status}).`)
          }
        } else {
          const loginData = await res.json().catch(() => ({}))
          if (loginData?.sessionToken) {
            setActiveSessionToken(loginData.sessionToken)
          }
          const sessionOk = await verifyGatewaySession()
          if (!sessionOk) {
            // Khi deploy cloud, nếu cookie không duy trì qua serverless container,
            // vẫn cho phép mở phiên demo và cảnh báo Gateway chưa đồng bộ
            setGatewayAuthStatus('offline')
          }
        }
      } catch {
        // Fallback sang chế độ local demo khi lỗi mạng
        setGatewayAuthStatus('offline')
      }
    } else {
      setGatewayAuthStatus('offline')
    }

    // 3. Mở phiên giao diện sau khi đã hoàn tất xác thực Backend hoặc xác nhận Backend offline
    const storeErr = login(e.trim(), p)
    setLoading(false)
    if (storeErr) {
      setErr(storeErr)
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-2">
      <div className="bg-brand-900 text-white p-8 md:p-14 flex flex-col justify-center">
        <div className="flex items-center gap-2 font-semibold text-xl mb-8">
          <Leaf />AI Nutrition Platform
        </div>
        <h1 className="text-3xl md:text-5xl font-semibold leading-tight max-w-md">
          Ăn đúng cách là một phần của hồi phục.
        </h1>
        <p className="mt-3 opacity-80 max-w-md">
          Quản lý hồ sơ, tra cứu thực phẩm và lập thực đơn dựa trên quy tắc đã được chuyên gia duyệt.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-sage/25 px-3 py-1">Đạm</span>
          <span className="rounded-full bg-terra/30 px-3 py-1">Tinh bột</span>
          <span className="rounded-full bg-white/15 px-3 py-1">Chất béo</span>
          <span className="rounded-full bg-brand/60 px-3 py-1">Vi chất</span>
        </div>
        <ul className="mt-8 space-y-4 text-sm max-w-md">
          {[
            [ShieldCheck, 'Chỉ cá nhân hóa khi bệnh lý được hỗ trợ và có quy tắc đã duyệt'],
            [UtensilsCrossed, 'Điều chỉnh món, khẩu phần và xem dinh dưỡng tính lại ngay'],
            [BookOpenCheck, 'Kiến thức được chuyên gia kiểm duyệt trước khi sử dụng']
          ].map(([I, t], i) => (
            <li key={i} className="flex gap-3">
              <I size={20} className="shrink-0" />
              {t as string}
            </li>
          ))}
        </ul>
      </div>

      <div className="p-6 md:p-14 flex flex-col justify-center max-w-md w-full mx-auto">
        <h2 className="text-2xl font-semibold mb-1">Đăng nhập</h2>
        <p className="text-sm text-muted mb-5">Chọn một tài khoản demo hoặc nhập thông tin.</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ['patient', 'Bệnh nhân'],
            ['expert', 'Chuyên gia'],
            ['admin', 'Quản trị']
          ].map(([r, l]) => (
            <button
              key={r}
              type="button"
              onClick={() => setE(r + '@demo.vn')}
              className={`rounded-full border px-2 py-2 text-sm font-medium transition-colors ${
                e === r + '@demo.vn' ? 'border-brand bg-brand-50 text-brand' : 'border-line'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input className={inp} value={e} onChange={x => setE(x.target.value)} />
          </Field>
          <Field label="Mật khẩu">
            <input className={inp} type="password" value={p} onChange={x => setP(x.target.value)} />
          </Field>
          {err && (
            <p role="alert" className="text-rose-ink text-sm mb-2">
              {err}
            </p>
          )}
          <Btn type="submit" disabled={loading} className="w-full">
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </Btn>
        </form>

        <p className="text-xs text-muted mt-3">Mật khẩu demo: Demo123!</p>
        <div className="mt-5">
          <Disclaimer />
        </div>
      </div>
    </div>
  )
}
