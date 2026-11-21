/**
 * Nguồn cấu hình AI DUY NHẤT (single source of truth).
 * Frontend, modelRouter, aiService và server/index.ts đều import từ đây.
 * Không được hardcode provider / model / timeout / API key ở nơi khác.
 */

export const GOOGLE_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
export const FREEMODEL_OPENAI_BASE = 'https://freemodel.in/v1'

export const DEFAULT_BASE_URL = GOOGLE_OPENAI_BASE
export const DEFAULT_MODEL = 'gemini-flash-lite-latest'

/**
 * Chuỗi model dự phòng: nếu model cấu hình trả 404 / "model not found" / 503 overloaded / 429 hết quota
 * thì tự thử model kế tiếp.
 */
export const MODEL_FALLBACK_CHAIN = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash']
export const FREEMODEL_FALLBACK_CHAIN = ['gemini-3.7-flash', 'seed-2.1-turbo', 'deepseek-v4.1-flash', 'gemini-3.6-flash', 'gpt-5.5', 'claude-sonnet-5-5']

/** Timeout (ms) theo loại tác vụ. Model suy luận (thinking) cần nhiều thời gian hơn 15-20s. */
export const AI_TIMEOUTS = {
  healthProbe: 3000,
  chatTurn: 60_000,
  textExtract: 45_000,
  vision: 75_000,
  menu1Day: 90_000,
  menu7Day: 150_000,
  structured: 45_000,
  streamFirstByte: 45_000,
  streamIdle: 30_000,
  gatewayUpstream: 120_000
} as const

export function isGoogleKey(key: string): boolean {
  return key.startsWith('AIzaSy') || key.startsWith('AQ.')
}

export function isFreemodelKey(key: string): boolean {
  return key.startsWith('fm_')
}

export function isFreemodelTarget(baseUrlOrKey = ''): boolean {
  return /freemodel\.in/i.test(baseUrlOrKey) || isFreemodelKey(baseUrlOrKey)
}

/** Tên model không còn hợp lệ trong cấu hình cũ -> chuẩn hoá về model mặc định. */
export function normalizeModelName(model: string | undefined | null, baseUrlOrKey = ''): string {
  const m = (model || '').trim()
  if (!m) return isFreemodelTarget(baseUrlOrKey) ? FREEMODEL_FALLBACK_CHAIN[0] : DEFAULT_MODEL
  if (!isFreemodelTarget(baseUrlOrKey) && /^gemini-3\.[78]/.test(m)) return DEFAULT_MODEL
  return m
}

/** Cấu hình cũ trỏ tới freemodel.in -> chuẩn hoá về endpoint Google nếu dùng Google key; giữ nguyên nếu dùng Freemodel key (fm_). */
export function normalizeBaseUrl(baseUrl: string | undefined | null, apiKey = ''): string {
  const b = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!b) return isFreemodelKey(apiKey) ? FREEMODEL_OPENAI_BASE : DEFAULT_BASE_URL
  if (b.includes('freemodel.in') && (!apiKey || isGoogleKey(apiKey))) return GOOGLE_OPENAI_BASE
  return b
}

/** Danh sách model sẽ thử theo thứ tự (không trùng lặp). */
export function modelCandidates(primary: string, baseUrlOrKey = ''): string[] {
  const isFm = isFreemodelTarget(baseUrlOrKey)
  const first = normalizeModelName(primary, baseUrlOrKey)
  const chain = isFm ? FREEMODEL_FALLBACK_CHAIN : MODEL_FALLBACK_CHAIN
  return Array.from(new Set([first, ...chain]))
}

/** Lỗi do model không tồn tại / không hỗ trợ / quá tải / hết quota riêng của model -> nên thử model dự phòng. */
export function isModelNotFoundStatus(status: number, bodyText: string): boolean {
  if (status === 404) return true
  if (status === 503 && /high demand|temporarily unavailable|overloaded|peak capacity|spikes in demand/i.test(bodyText)) return true
  // Quota free-tier tính RIÊNG cho từng model -> model khác vẫn còn hạn mức
  if (status === 429 && /RESOURCE_EXHAUSTED|quota|exceeded your current|peak capacity/i.test(bodyText)) return true
  if (status === 400 || status === 403) {
    return /model/i.test(bodyText) && /(not found|not supported|does not exist|unsupported|invalid)/i.test(bodyText)
  }
  return false
}
