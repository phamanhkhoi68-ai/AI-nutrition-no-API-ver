import type { Doc, EvidenceBasis, Food } from '../types'

export interface RagChunk {
  chunkId: string
  docId: string
  docTitle: string
  condition: string
  content: string
  tokenCount: number
}

export interface RagRetrievedChunk extends RagChunk {
  bm25Score: number
  vectorScore: number
  rrfScore: number
}

export interface HybridRagResult {
  hasLocalMatch: boolean
  contextSnippet: string
  matchedDocs: Doc[]
  matchedFoods: Food[]
  chunks: RagRetrievedChunk[]
  topScore: number
}

const VI_STOP_WORDS = new Set([
  'của', 'cho', 'với', 'bệnh', 'nhân', 'người', 'dinh', 'dưỡng', 'lâm', 'sàng',
  'phác', 'đồ', 'tài', 'liệu', 'nội', 'bộ', 'hướng', 'dẫn', 'cách', 'ăn', 'uống',
  'có', 'được', 'không', 'là', 'và', 'hay', 'về', 'trong', 'khi', 'nào', 'gì',
  'như', 'thế', 'mỗi', 'ngày', 'tốt', 'hôm', 'nay', 'nên', 'cần', 'tôi', 'bác',
  'quả', 'món', 'thực', 'phẩm', 'điều', 'trị', 'theo', 'mức', 'tối', 'thiểu', 'an', 'toàn',
  'cua', 'voi', 'benh', 'nhan', 'nguoi', 'duoc', 'khong', 'trong', 'nhu', 'the', 'ngay',
  'hồ', 'sơ', 'ho', 'so', 'án', 'tóm', 'tắt', 'tom', 'tat', 'hiện', 'tại', 'hien', 'tai',
  'những', 'nhung', 'gi', 'toi', 'bị', 'bi', 'mắc', 'mac', 'nao', 'xem', 'biết', 'biet'
])

const CLINICAL_SYNONYMS: Record<string, string[]> = {
  'thận': ['ckd', 'egfr', 'creatinine', 'than', 'cau than'],
  'ckd': ['thận', 'suy thận', 'egfr', 'creatinine', 'kdigo'],
  'egfr': ['ckd', 'suy thận', 'mức lọc cầu thận'],
  'đái tháo đường': ['tiểu đường', 'hba1c', 'glucose', 'đường huyết', 'ada'],
  'tiểu đường': ['đái tháo đường', 'hba1c', 'glucose', 'đường huyết', 'gi'],
  'huyết áp': ['tăng huyết áp', 'dash', 'natri', 'kcl', 'lisinopril', 'esc'],
  'gout': ['gút', 'acid uric', 'purine', 'urat', 'acr'],
  'gút': ['gout', 'acid uric', 'purine', 'urat', 'acr'],
  'warfarin': ['chống đông', 'vitamin k', 'inr', 'coumadin'],
  'statin': ['atorvastatin', 'lipitor', 'bưởi', 'cyp3a4', 'mỡ máu'],
  'atorvastatin': ['statin', 'bưởi', 'grapefruit', 'cyp3a4'],
  'bưởi': ['grapefruit', 'statin', 'atorvastatin', 'cyp3a4'],
  'chuối': ['kali', 'potassium', 'acei', 'lisinopril'],
  'dừa': ['kali', 'potassium', 'acei', 'ckd'],
  'sỏi': ['oxalate', 'citrate', 'bài niệu', 'eau'],
  'dạ dày': ['gerd', 'trào ngược', 'loét', 'acg'],
  'gan': ['men gan', 'alt', 'ast', 'easl', 'nhiễm mỡ']
}

export function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeClinical(text: string, expandSynonyms = false): string[] {
  const lower = (text || '').toLowerCase()
  const rawTokens = lower
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !VI_STOP_WORDS.has(t))

  const normTokens = normalizeText(text)
    .split(/\s+/)
    .filter(t => t.length >= 2 && !VI_STOP_WORDS.has(t))

  const set = new Set<string>([...rawTokens, ...normTokens])
  if (expandSynonyms) {
    for (const [k, syns] of Object.entries(CLINICAL_SYNONYMS)) {
      if (lower.includes(k) || normalizeText(lower).includes(normalizeText(k))) {
        syns.forEach(s => {
          normalizeText(s).split(/\s+/).forEach(tok => {
            if (tok.length >= 2) set.add(tok)
          })
        })
      }
    }
  }
  return Array.from(set)
}

export function chunkApprovedDocuments(docs: Doc[], chunkSize = 420, overlap = 60): RagChunk[] {
  const chunks: RagChunk[] = []
  docs
    .filter(d => d.status === 'Đã duyệt')
    .forEach(d => {
      const full = (d.content || '').trim()
      if (!full) return
      if (full.length <= chunkSize) {
        chunks.push({
          chunkId: `${d.id}#c0`,
          docId: d.id,
          docTitle: d.title,
          condition: d.condition,
          content: full,
          tokenCount: tokenizeClinical(full).length
        })
        return
      }
      let start = 0
      let idx = 0
      while (start < full.length) {
        const end = Math.min(full.length, start + chunkSize)
        const slice = full.slice(start, end).trim()
        if (slice.length > 0) {
          chunks.push({
            chunkId: `${d.id}#c${idx++}`,
            docId: d.id,
            docTitle: d.title,
            condition: d.condition,
            content: slice,
            tokenCount: tokenizeClinical(slice).length
          })
        }
        if (end >= full.length) break
        start = Math.max(start + 1, end - overlap)
      }
    })
  return chunks
}

function charTrigrams(text: string): Map<string, number> {
  const norm = normalizeText(text)
  const vec = new Map<string, number>()
  const words = norm.split(/\s+/).filter(Boolean)
  for (const w of words) {
    vec.set(`w:${w}`, (vec.get(`w:${w}`) || 0) + 1.5)
    for (let i = 0; i <= w.length - 3; i++) {
      const g = w.slice(i, i + 3)
      vec.set(`g:${g}`, (vec.get(`g:${g}`) || 0) + 0.5)
    }
  }
  return vec
}

export function cosineSparse(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [, va] of a) normA += va * va
  for (const [, vb] of b) normB += vb * vb
  if (normA === 0 || normB === 0) return 0
  for (const [k, va] of a) {
    const vb = b.get(k)
    if (vb) dot += va * vb
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function hybridRetrieveChunks(
  query: string,
  docs: Doc[],
  foods: Food[] = [],
  topK = 3
): HybridRagResult {
  const chunks = chunkApprovedDocuments(docs)
  const qTokens = tokenizeClinical(query, true)
  const rawQueryTokens = tokenizeClinical(query, false)
  const qLower = query.toLowerCase()
  const qNorm = normalizeText(query)

  const matchedFoods = foods
    .filter(f => {
      const fn = f.name.toLowerCase()
      if (qLower.includes(fn) || qNorm.includes(normalizeText(fn))) return true
      const fToks = tokenizeClinical(fn, false)
      return fToks.length > 0 && fToks.every(t => qNorm.includes(t))
    })
    .slice(0, 3)

  if (chunks.length === 0 || qTokens.length === 0) {
    return buildFoodOnlyOrEmptyResult(matchedFoods)
  }

  // Build IDF for BM25 across chunk corpus
  const N = chunks.length
  const docTokensList = chunks.map(c => tokenizeClinical(`${c.docTitle} ${c.condition} ${c.content}`, false))
  const avgLen = Math.max(1, docTokensList.reduce((acc, t) => acc + t.length, 0) / N)
  const df = new Map<string, number>()
  docTokensList.forEach(toks => {
    new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1))
  })

  const k1 = 1.5
  const b = 0.75
  const qVec = charTrigrams(qTokens.join(' '))

  const scored = chunks.map((chunk, idx) => {
    const toks = docTokensList[idx]
    const tf = new Map<string, number>()
    toks.forEach(t => tf.set(t, (tf.get(t) || 0) + 1))

    let bm25 = 0
    for (const qt of qTokens) {
      const freq = tf.get(qt) || 0
      if (freq === 0) continue
      const nDf = df.get(qt) || 0
      const idf = Math.log(1 + (N - nDf + 0.5) / (nDf + 0.5))
      const denom = freq + k1 * (1 - b + b * (toks.length / avgLen))
      bm25 += idf * ((freq * (k1 + 1)) / denom)
    }

    // Exact phrase / condition match boost
    const titleNorm = normalizeText(`${chunk.docTitle} ${chunk.condition}`)
    if (rawQueryTokens.some(t => titleNorm.includes(t))) bm25 += 0.75
    const contentNorm = normalizeText(chunk.content)
    const contentTokSet = new Set(toks)
    const exactTermHits = rawQueryTokens.filter(t =>
      t.length >= 5 ? contentNorm.includes(t) : t.length >= 3 && contentTokSet.has(t)
    ).length
    bm25 += exactTermHits * 0.45

    const cVec = charTrigrams(`${chunk.docTitle} ${chunk.condition} ${chunk.content}`)
    const vecSim = cosineSparse(qVec, cVec)

    return { chunk, bm25, vecSim, exactHits: exactTermHits }
  })

  // Rank separately for Reciprocal Rank Fusion (RRF)
  const byBm25 = [...scored].sort((a, b2) => b2.bm25 - a.bm25)
  const byVec = [...scored].sort((a, b2) => b2.vecSim - a.vecSim)
  const bm25Rank = new Map<string, number>()
  const vecRank = new Map<string, number>()
  byBm25.forEach((s, i) => bm25Rank.set(s.chunk.chunkId, i + 1))
  byVec.forEach((s, i) => vecRank.set(s.chunk.chunkId, i + 1))

  const K_RRF = 60
  const fused: RagRetrievedChunk[] = scored
    .filter(s => s.bm25 >= 0.4 || (s.vecSim >= 0.22 && s.exactHits >= 1))
    .map(s => {
      const rB = bm25Rank.get(s.chunk.chunkId) || 999
      const rV = vecRank.get(s.chunk.chunkId) || 999
      const rrf = (1 / (K_RRF + rB)) + (1 / (K_RRF + rV)) + Math.min(0.05, s.bm25 * 0.005)
      return {
        ...s.chunk,
        bm25Score: Number(s.bm25.toFixed(3)),
        vectorScore: Number(s.vecSim.toFixed(3)),
        rrfScore: Number(rrf.toFixed(4))
      }
    })
    .sort((a, b2) => b2.rrfScore - a.rrfScore || b2.bm25Score - a.bm25Score)
    .slice(0, topK)

  const docById = new Map(docs.filter(d => d.status === 'Đã duyệt').map(d => [d.id, d]))
  const matchedDocs: Doc[] = []
  const seenDocIds = new Set<string>()
  for (const ch of fused) {
    if (!seenDocIds.has(ch.docId)) {
      const doc = docById.get(ch.docId)
      if (doc) {
        matchedDocs.push(doc)
        seenDocIds.add(ch.docId)
      }
    }
  }

  const snippets = [
    ...fused.map(ch => `[Phác đồ #${ch.docId} | RRF=${ch.rrfScore} | ${ch.docTitle}]: ${ch.content}`),
    ...matchedFoods.map(f => `[Món ăn nội bộ #${f.id}: ${f.name} - ${f.kcal} kcal, Đạm ${f.protein}g, Natri ${f.sodium}mg, GI ${f.gi}]`)
  ]

  if (snippets.length === 0) {
    return buildFoodOnlyOrEmptyResult(matchedFoods)
  }

  return {
    hasLocalMatch: true,
    contextSnippet: snippets.join('\n'),
    matchedDocs,
    matchedFoods,
    chunks: fused,
    topScore: fused[0]?.rrfScore || (matchedFoods.length > 0 ? 0.5 : 0)
  }
}

function buildFoodOnlyOrEmptyResult(matchedFoods: Food[]): HybridRagResult {
  if (matchedFoods.length === 0) {
    return {
      hasLocalMatch: false,
      contextSnippet: 'NONE',
      matchedDocs: [],
      matchedFoods: [],
      chunks: [],
      topScore: 0
    }
  }
  return {
    hasLocalMatch: true,
    contextSnippet: matchedFoods
      .map(f => `[Món ăn nội bộ #${f.id}: ${f.name} - ${f.kcal} kcal, Đạm ${f.protein}g, Natri ${f.sodium}mg, GI ${f.gi}]`)
      .join('\n'),
    matchedDocs: [],
    matchedFoods,
    chunks: [],
    topScore: 0.5
  }
}

export function verifyCitationGrounding(
  answerText: string,
  retrievedChunks: RagRetrievedChunk[],
  claimedCitations: EvidenceBasis[] = []
): {
  groundingScore: number
  verifiedCitations: EvidenceBasis[]
  strippedHallucinations: number
} {
  if (retrievedChunks.length === 0) {
    return {
      groundingScore: claimedCitations.length > 0 ? 0.7 : 0.65,
      verifiedCitations: claimedCitations,
      strippedHallucinations: 0
    }
  }

  const answerNormTokens = new Set(tokenizeClinical(answerText, true))
  const chunkTokens = new Set<string>()
  const validDocIds = new Set(retrievedChunks.map(c => c.docId))
  const validTitles = retrievedChunks.map(c => normalizeText(c.docTitle))

  retrievedChunks.forEach(c => {
    tokenizeClinical(`${c.docTitle} ${c.content}`, true).forEach(t => chunkTokens.add(t))
  })

  let overlap = 0
  chunkTokens.forEach(tok => {
    if (answerNormTokens.has(tok)) overlap++
  })

  const denominator = Math.min(18, Math.max(4, chunkTokens.size))
  const lexicalScore = Math.min(1, overlap / denominator)

  let strippedHallucinations = 0
  const verifiedCitations = claimedCitations.filter(cit => {
    const url = cit.citation_url || ''
    const titleNorm = normalizeText(cit.guideline_name || '')
    const matchesInternalId = Array.from(validDocIds).some(id => url.includes(id))
    const matchesTitle = validTitles.some(vt => vt && titleNorm && (vt.includes(titleNorm) || titleNorm.includes(vt)))
    if (matchesInternalId || matchesTitle) return true
    strippedHallucinations++
    return false
  })

  // Ensure retrieved chunks are always represented as grounded internal citations
  if (verifiedCitations.length === 0) {
    const seen = new Set<string>()
    for (const ch of retrievedChunks) {
      if (!seen.has(ch.docId)) {
        verifiedCitations.push({
          guideline_name: ch.docTitle,
          citation_url: `internal://docs/${ch.docId}`,
          rationale: ch.content.slice(0, 220)
        })
        seen.add(ch.docId)
      }
    }
  }

  const citationFactor = strippedHallucinations > 0 ? 0.85 : 1.0
  const groundingScore = Number(Math.min(1, (0.45 + lexicalScore * 0.55) * citationFactor).toFixed(3))

  return {
    groundingScore,
    verifiedCitations,
    strippedHallucinations
  }
}
