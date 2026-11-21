import type { MedicalRecordExtraction, LabMetric, MedicationInfo, OrganMapping, OrganId, Severity } from '../types'

export interface PDFExtractionResult {
  text: string
  pageCount: number
  images: string[] // data:image/jpeg;base64,...
  hasText: boolean
  hasImages: boolean
}

// Convert various input formats to Uint8Array
export async function toUint8Array(input: File | Blob | string | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (typeof input === 'string') {
    // Strip Data URL prefix if present
    const base64 = input.replace(/^data:[^;]+;base64,/, '')
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const ab = await input.arrayBuffer()
    return new Uint8Array(ab)
  }
  throw new Error('Định dạng dữ liệu đầu vào không hợp lệ để phân tích PDF.')
}

/**
 * Native Browser Flate (zlib) Decompression using Web Streams API DecompressionStream.
 * Handles both zlib-wrapped deflate and raw deflate.
 */
async function decompressFlate(data: Uint8Array): Promise<Uint8Array> {
  const tryFormat = async (format: 'deflate' | 'deflate-raw', payload: Uint8Array): Promise<Uint8Array | null> => {
    if (typeof DecompressionStream === 'undefined') return null
    try {
      const ds = new DecompressionStream(format)
      const writer = ds.writable.getWriter()
      const writePromise = writer.write(payload as any).catch(() => {})
      const closePromise = writer.close().catch(() => {})
      const buf = await new Response(ds.readable).arrayBuffer()
      await Promise.allSettled([writePromise, closePromise])
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  const hasZlibHeader = data.length >= 2 && data[0] === 0x78
  if (hasZlibHeader) {
    const res = await tryFormat('deflate', data)
    if (res) return res
    const rawRes = await tryFormat('deflate-raw', data.subarray(2))
    if (rawRes) return rawRes
  } else {
    const rawRes = await tryFormat('deflate-raw', data)
    if (rawRes) return rawRes
    const res = await tryFormat('deflate', data)
    if (res) return res
  }

  return data
}

/**
 * Native Browser DOCX Content Extractor (Microsoft Word .docx)
 * Extracts and decompresses word/document.xml from the ZIP container using Web Streams API.
 */
export async function extractDocxContent(
  input: File | Blob | string | ArrayBuffer | Uint8Array
): Promise<string> {
  try {
    const bytes = await toUint8Array(input)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    const max = bytes.length - 30

    while (offset < max) {
      // Check for ZIP Local File Header signature 0x04034b50 ('PK\x03\x04')
      if (view.getUint32(offset, true) === 0x04034b50) {
        const compMethod = view.getUint16(offset + 8, true)
        const compSize = view.getUint32(offset + 18, true)
        const fnLen = view.getUint16(offset + 26, true)
        const extraLen = view.getUint16(offset + 28, true)
        const fnBytes = bytes.subarray(offset + 30, offset + 30 + fnLen)
        const fileName = new TextDecoder('utf-8').decode(fnBytes)
        const dataStart = offset + 30 + fnLen + extraLen

        if (fileName === 'word/document.xml') {
          const compData = bytes.subarray(dataStart, dataStart + compSize)
          let xml = ''
          if (compMethod === 8) {
            const decompressed = await decompressFlate(compData)
            xml = new TextDecoder('utf-8').decode(decompressed)
          } else {
            xml = new TextDecoder('utf-8').decode(compData)
          }
          return xml
            .replace(/<\/w:p>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .trim()
        }
        offset = dataStart + compSize
      } else {
        offset++
      }
    }
  } catch (err) {
    console.warn('DOCX extraction warning:', err)
  }
  return ''
}

/**
 * Parse string tokens from PDF content streams.
 * Handles:
 * - (escaped text with parens, newlines, octals) Tj
 * - [(array) -20 (of) 10 (strings)] TJ
 * - <HexEncodedString> Tj
 */
function parsePdfStringOperators(content: string): string[] {
  const result: string[] = []
  const len = content.length
  let i = 0

  while (i < len) {
    const char = content[i]

    // 1. Array of text strings: [ ... ] TJ
    if (char === '[') {
      const closeBracket = content.indexOf(']', i)
      if (closeBracket !== -1) {
        const arrayBody = content.slice(i + 1, closeBracket)
        // Extract all parenthesized and hex strings inside array
        let j = 0
        const subStrings: string[] = []
        while (j < arrayBody.length) {
          if (arrayBody[j] === '(') {
            let depth = 1
            j++
            let str = ''
            while (j < arrayBody.length && depth > 0) {
              if (arrayBody[j] === '\\' && j + 1 < arrayBody.length) {
                const next = arrayBody[j + 1]
                if (next === '(' || next === ')' || next === '\\') {
                  str += next
                  j += 2
                  continue
                }
                if (next === 'n') { str += ' '; j += 2; continue }
                if (next === 'r') { j += 2; continue }
                if (next === 't') { str += ' '; j += 2; continue }
              }
              if (arrayBody[j] === '(') depth++
              else if (arrayBody[j] === ')') {
                depth--
                if (depth === 0) { j++; break }
              }
              str += arrayBody[j]
              j++
            }
            if (str.trim()) subStrings.push(str)
          } else if (arrayBody[j] === '<') {
            const endHex = arrayBody.indexOf('>', j)
            if (endHex !== -1) {
              const hex = arrayBody.slice(j + 1, endHex).replace(/\s+/g, '')
              const decoded = decodeHexString(hex)
              if (decoded.trim()) subStrings.push(decoded)
              j = endHex + 1
              continue
            }
            j++
          } else {
            j++
          }
        }
        if (subStrings.length > 0) {
          result.push(subStrings.join(''))
        }
        i = closeBracket + 1
        continue
      }
    }

    // 2. Parenthesized string: ( ... ) Tj
    if (char === '(') {
      let depth = 1
      i++
      let str = ''
      while (i < len && depth > 0) {
        if (content[i] === '\\' && i + 1 < len) {
          const next = content[i + 1]
          if (next === '(' || next === ')' || next === '\\') {
            str += next
            i += 2
            continue
          }
          if (next === 'n') { str += ' '; i += 2; continue }
          if (next === 'r') { i += 2; continue }
          if (next === 't') { str += ' '; i += 2; continue }
          if (/[0-7]/.test(next)) {
            // Octal escape
            let octal = next
            let k = i + 2
            while (k < len && octal.length < 3 && /[0-7]/.test(content[k])) {
              octal += content[k]
              k++
            }
            str += String.fromCharCode(parseInt(octal, 8))
            i = k
            continue
          }
        }
        if (content[i] === '(') depth++
        else if (content[i] === ')') {
          depth--
          if (depth === 0) { i++; break }
        }
        str += content[i]
        i++
      }
      if (str.trim()) {
        result.push(str)
      }
      continue
    }

    // 3. Hex string: < ... > Tj
    if (char === '<' && content[i + 1] !== '<') {
      const closeHex = content.indexOf('>', i)
      if (closeHex !== -1) {
        const hex = content.slice(i + 1, closeHex).replace(/\s+/g, '')
        const decoded = decodeHexString(hex)
        if (decoded.trim()) {
          result.push(decoded)
        }
        i = closeHex + 1
        continue
      }
    }

    // Line breaks or text block separators
    if (char === '\n' || char === '\r') {
      // Small boundary marker
    }

    i++
  }

  return result
}

function decodeHexString(hex: string): string {
  if (!hex || hex.length % 2 !== 0) return ''
  try {
    // Check if UTF-16BE (starts with FEFF or uses 4-hex glyphs)
    if (hex.toUpperCase().startsWith('FEFF')) {
      const sub = hex.slice(4)
      let str = ''
      for (let i = 0; i < sub.length; i += 4) {
        str += String.fromCharCode(parseInt(sub.substr(i, 4), 16))
      }
      return str
    }
    // If multiple of 4 and every odd byte is 00 (e.g. 00410042)
    if (hex.length >= 4 && hex.length % 4 === 0) {
      let isUtf16 = true
      for (let i = 0; i < hex.length; i += 4) {
        if (hex.slice(i, i + 2) !== '00') {
          isUtf16 = false
          break
        }
      }
      if (isUtf16) {
        let str = ''
        for (let i = 0; i < hex.length; i += 4) {
          str += String.fromCharCode(parseInt(hex.substr(i, 4), 16))
        }
        return str
      }
    }
    // Standard Latin-1 / ASCII bytes
    let str = ''
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
    }
    return str
  } catch {
    return ''
  }
}

/**
 * Find embedded JPEG images within a PDF Uint8Array buffer.
 * JPEGs in PDFs start with SOI (0xFF, 0xD8, 0xFF) and end with EOI (0xFF, 0xD9).
 */
/**
 * Find embedded JPEG images within a PDF Uint8Array buffer (Optimized fast byte search).
 * JPEGs in PDFs start with SOI (0xFF, 0xD8, 0xFF) and end with EOI (0xFF, 0xD9).
 */
function extractEmbeddedJPEGs(bytes: Uint8Array, maxImages = 8): string[] {
  const images: string[] = []
  const len = bytes.length
  let i = 0

  while (i < len - 4) {
    // Check for JPEG SOI (0xFF 0xD8 0xFF)
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      const start = i
      let end = -1
      // Scan for JPEG EOI (0xFF 0xD9), capped at 5MB per image to prevent UI freeze
      const maxScan = Math.min(len - 1, start + 5 * 1024 * 1024)
      for (let j = start + 2; j < maxScan; j++) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
          end = j + 2
          break
        }
      }

      if (end !== -1) {
        const jpegBytes = bytes.subarray(start, end)
        // Ignore tiny icon fragments (< 4KB)
        if (jpegBytes.length > 4096) {
          let binary = ''
          const chunk = 16384
          for (let k = 0; k < jpegBytes.length; k += chunk) {
            const slice = jpegBytes.subarray(k, Math.min(k + chunk, jpegBytes.length))
            binary += String.fromCharCode.apply(null, slice as any)
          }
          const base64 = btoa(binary)
          images.push(`data:image/jpeg;base64,${base64}`)
          if (images.length >= maxImages) break
        }
        i = end
        continue
      }
    }
    i++
  }

  return images
}

/**
 * Ultra-Fast Parallel PDF Extractor:
 * 1. Fast index-based stream finding without catastrophic backtracking regex.
 * 2. Parallel Flate decompression via Promise.all.
 * 3. Lazy image scanning: skips embedded JPEG scanning when text is present.
 */
export async function extractPDFContent(
  input: File | Blob | string | ArrayBuffer | Uint8Array
): Promise<PDFExtractionResult> {
  const bytes = await toUint8Array(input)
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  const isNodeRuntime = Boolean((globalThis as any).process?.versions?.node)
  if (isNodeRuntime) {
    if (!(globalThis as any).pdfjsWorker) {
      const workerSpec = 'pdfjs-dist/build/pdf.worker.mjs'
      ;(globalThis as any).pdfjsWorker = await import(/* @vite-ignore */ workerSpec)
    }
  } else if (typeof window !== 'undefined' && !import.meta.env?.SSR) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    GlobalWorkerOptions.workerSrc = worker.default
  }

  const document = await getDocument({ data: bytes.slice() }).promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      let lastY: number | undefined
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        if (lastY !== undefined && Math.abs(y - lastY) > 3 && line.trim()) {
          lines.push(line.trim())
          line = ''
        }
        if (item.str.trim()) line += (line ? ' ' : '') + item.str.trim()
        lastY = y
        if (item.hasEOL && line.trim()) {
          lines.push(line.trim())
          line = ''
          lastY = undefined
        }
      }
      if (line.trim()) lines.push(line.trim())
      pages.push(lines.join('\n'))
      page.cleanup()
    }
    const text = pages.join('\n').trim()
    const maxScanPages = 8
    let images = text.length <= 30 ? extractEmbeddedJPEGs(bytes, Math.min(document.numPages, maxScanPages)) : []

    // In browser runtimes, render pages via canvas if embedded JPEG extraction missed non-JPEG scans
    if (text.length <= 30 && images.length < Math.min(document.numPages, maxScanPages) && !isNodeRuntime && typeof window !== 'undefined' && typeof globalThis.document !== 'undefined') {
      const renderedImages: string[] = []
      const pagesToRender = Math.min(document.numPages, maxScanPages)
      for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber++) {
        try {
          const page = await document.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = globalThis.document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(viewport.width))
          canvas.height = Math.max(1, Math.round(viewport.height))
          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise
            renderedImages.push(canvas.toDataURL('image/jpeg', 0.85))
          }
          page.cleanup()
        } catch {
          // Ignore canvas failure in non-canvas environments
        }
      }
      if (renderedImages.length > images.length) {
        images = renderedImages
      }
    }

    return {
      text,
      pageCount: document.numPages,
      images,
      hasText: text.length > 30,
      hasImages: images.length > 0
    }
  } finally {
    await document.destroy()
  }
}
// ==================== CLINICAL ENTITY EXTRACTOR (SMART LOCAL PARSER) ====================

interface DiseaseRule {
  names: string[]
  regex: RegExp
  organ: OrganId
  severity: Severity
  reason: string
  nutrientLimits: Record<string, string | number | boolean>
}

const CLINICAL_DISEASE_RULES: DiseaseRule[] = [
  // Dạ dày / Đường tiêu hóa
  {
    names: ['Viêm loét dạ dày tá tràng', 'Nhiễm khuẩn HP (Helicobacter Pylori)'],
    regex: /vi[eê]m\s+(lo[eé]t\s+)?d[aạ]\s+d[aà]y|lo[eé]t\s+d[aạ]\s+d[aà]y|hp\s*\(?\+?\)?|helicobacter/i,
    organ: 'stomach',
    severity: 'critical',
    reason: 'Tổn thương niêm mạc dạ dày tá tràng kèm nhiễm HP. Cần kiêng chất chua cay, cồn và gia vị kích thích.',
    nutrientLimits: { avoid_spicy: true, avoid_acid: true, split_meals: 5 }
  },
  {
    names: ['Trào ngược dạ dày thực quản (GERD)', 'Viêm dạ dày'],
    regex: /tr[aà]o\s+ng[uư][oợ]c|gerd|vi[eê]m\s+d[aạ]\s+d[aà]y/i,
    organ: 'stomach',
    severity: 'warning',
    reason: 'Trào ngược acid dịch vị dạ dày thực quản. Tránh ăn no sát giờ ngủ, hạn chế cà phê, socola, đồ béo.',
    nutrientLimits: { avoid_spicy: true, avoid_grease: true, dinner_before_hours: 3 }
  },
  {
    names: ['Viêm đại tràng mạn tính', 'Hội chứng ruột kích thích'],
    regex: /vi[eê]m\s+[đd][aạ]i\s+tr[aà]ng|ru[oộ]t\s+k[ií]ch\s+th[ií]ch|ibs/i,
    organ: 'stomach',
    severity: 'warning',
    reason: 'Rối loạn nhu động đại tràng và hấp thu tiêu hóa. Ưu tiên thức ăn mềm, chín kỹ, hạn chế sữa động vật có lactose.',
    nutrientLimits: { fiber_soluble_only: true, avoid_raw: true }
  },

  // Gan / Mật
  {
    names: ['Viêm gan B mạn tính', 'Tăng men gan (ALT/AST)'],
    regex: /vi[eê]m\s+gan\s+b|vi[eê]m\s+gan\s+c|hbv|hcv|t[aă]ng\s+men\s+gan|men\s+gan\s+cao/i,
    organ: 'liver',
    severity: 'critical',
    reason: 'Tế bào gan đang bị hoại tử hoặc viêm mạn tính. Tuyệt đối kiêng rượu bia, giảm mỡ no, hạn chế thực phẩm chế biến sẵn.',
    nutrientLimits: { avoid_alcohol: true, fat_max_percent: 20, antioxidant_rich: true }
  },
  {
    names: ['Gan nhiễm mỡ', 'Rối loạn chức năng gan'],
    regex: /gan\s+nhi[eễ]m\s+m[oỡ]|fatty\s+liver/i,
    organ: 'liver',
    severity: 'warning',
    reason: 'Tích tụ mỡ tại nhu mô gan. Cần giảm carbohydrate tinh chế, tăng vận động và bổ sung omega-3 thực vật.',
    nutrientLimits: { avoid_refined_sugar: true, omega3_rich: true }
  },

  // Tim mạch & Huyết áp
  {
    names: ['Tăng huyết áp độ 2', 'Bệnh tim thiếu máu cục bộ'],
    regex: /t[aă]ng\s+huy[eế]t\s+[aá]p|cao\s+huy[eế]t\s+[aá]p|hypertension|thi[eế]u\s+m[aá]u\s+c[oơ]\s+tim|b[eệ]nh\s+m[aạ]ch\s+v[aà]nh/i,
    organ: 'heart',
    severity: 'critical',
    reason: 'Áp lực mạch vành và thành mạch tăng cao. Siết chặt trần Natri < 1500mg/ngày, tăng Kali tự nhiên từ rau củ.',
    nutrientLimits: { sodium_max_mg: 1500, saturated_fat_max_g: 10 }
  },
  {
    names: ['Suy tim', 'Rối loạn nhịp tim'],
    regex: /suy\s+tim|heart\s+failure|lo[aạ]n\s+nh[iị]p/i,
    organ: 'heart',
    severity: 'critical',
    reason: 'Phân suất tống máu suy giảm. Cần kiểm soát lượng dịch nạp vào, giới hạn muối tối đa < 1200mg/ngày.',
    nutrientLimits: { sodium_max_mg: 1200, fluid_limit_ml: 1500 }
  },

  // Thận & Tiết niệu
  {
    names: ['Suy thận mạn CKD Giai đoạn 4'],
    regex: /suy\s+th[aậ]n.*(?:giai\s+[đd]o[aạ]n|stage|g)\s*4|ckd\s*4/i,
    organ: 'kidneys',
    severity: 'critical',
    reason: 'Mức lọc cầu thận suy giảm nghiêm trọng. Giới hạn đạm 0.8g/kg/ngày, kiểm soát Kali < 1800mg và Natri < 1500mg.',
    nutrientLimits: { protein_g_per_kg: 0.8, potassium_max_mg: 1800, sodium_max_mg: 1500 }
  },
  {
    names: ['Suy thận mạn', 'Viêm cầu thận'],
    regex: /suy\s+th[aậ]n|ckd|vi[eê]m\s+c[aầ]u\s+th[aậ]n|h[oộ]i\s+ch[uứ]ng\s+th[aậ]n\s+h[uư]/i,
    organ: 'kidneys',
    severity: 'warning',
    reason: 'Chức năng lọc độc tố ure & creatinine suy giảm. Cần kiểm soát lượng đạm nạp vào và hạn chế muối.',
    nutrientLimits: { protein_g_per_kg: 0.9, sodium_max_mg: 1800 }
  },
  {
    names: ['Sỏi thận', 'Lắng đọng tinh thể tiết niệu'],
    regex: /s[oỏ]i\s+th[aậ]n|s[oỏ]i\s+ti[eế]t\s+ni[eệ]u|s[oỏ]i\s+ni[eệ]u\s+qu[aả]n|s[oỏ]i\s+[đd][aà]i\s+b[eể]\s+th[aậ]n|kidney\s+stone|nephrolithiasis|urolithiasis/i,
    organ: 'kidneys',
    severity: 'warning',
    reason: 'Phát hiện sỏi thận / hệ tiết niệu. Cần uống nhiều nước (> 2.5L/ngày) để tăng bài xuất cặn lắng, giảm Natri < 1500mg và kiêng thực phẩm giàu Oxalate.',
    nutrientLimits: { water_min_ml: 2500, sodium_max_mg: 1500, avoid_oxalate: true }
  },

  // Tụy & Nội tiết
  {
    names: ['Đái tháo đường Type 2'],
    regex: /[đd][aá]i\s+th[aá]o\s+[đd][uư][oờ]ng\s*(?:type|typ)?\s*2|ti[eể]u\s+[đd][uư][oờ]ng\s*(?:type|typ)?\s*2|t2d/i,
    organ: 'pancreas',
    severity: 'warning',
    reason: 'Kháng insulin ngoại vi. Kiểm soát tải đường huyết Glycemic Load, hạn chế GI > 55, cấm đường tinh luyện.',
    nutrientLimits: { gi_max: 55, free_sugar_g: 0, carb_ratio_max: 45 }
  },
  {
    names: ['Đái tháo đường Type 1'],
    regex: /[đd][aá]i\s+th[aá]o\s+[đd][uư][oờ]ng\s*(?:type|typ)?\s*1|ti[eể]u\s+[đd][uư][oờ]ng\s*(?:type|typ)?\s*1|t1d/i,
    organ: 'pancreas',
    severity: 'critical',
    reason: 'Thiếu hụt insulin tuyệt đối. Đòi hỏi tính toán chính xác lượng Carbohydrate (Carb Counting) theo đơn vị insulin.',
    nutrientLimits: { carb_counting: true, gi_max: 50, free_sugar_g: 0 }
  },
  {
    names: ['Viêm tụy cấp', 'Viêm tụy mạn'],
    regex: /vi[eê]m\s+t[uụ]y/i,
    organ: 'pancreas',
    severity: 'critical',
    reason: 'Men tụy tự tiêu hủy mô tụy. Tuyệt đối kiêng mỡ béo động vật, kiêng rượu bia, ăn thành nhiều bữa nhỏ.',
    nutrientLimits: { fat_max_percent: 15, avoid_alcohol: true }
  },

  // Khớp & Chuyển hóa Uric
  {
    names: ['Bệnh Gout (Gút) mạn tính', 'Tăng Acid Uric máu'],
    regex: /\bgout\b|\bg[uú]t\b|t[aă]ng\s+(?:acid|axit)\s+uric/i,
    organ: 'joints',
    severity: 'warning',
    reason: 'Nguy cơ lắng đọng tinh thể Urat tại màng hoạt dịch khớp. Kiêng phủ tạng động vật, thịt đỏ, hải sản và bia rượu.',
    nutrientLimits: { purine_level: 'Thấp', avoid_red_meat: true, avoid_seafood: true }
  },
  {
    names: ['Thoái hóa khớp', 'Viêm khớp dạng thấp'],
    regex: /tho[aá]i\s+h[oó]a\s+kh[oớ]p|vi[eê]m\s+kh[oớ]p/i,
    organ: 'joints',
    severity: 'warning',
    reason: 'Mòn sụn khớp và phản ứng viêm bao khớp. Bổ sung collagen tuýp II, omega-3 chống viêm và duy trì cân nặng tối ưu.',
    nutrientLimits: { anti_inflammatory: true, omega3_rich: true }
  },

  // Phổi & Hô hấp
  {
    names: ['Viêm phổi', 'Bệnh phổi tắc nghẽn mạn tính (COPD)', 'Hen phế quản'],
    regex: /vi[eê]m\s+ph[oổ]i|copd|hen\s+ph[eế]\s+qu[aả]n|hen\s+suy[eễ]n|ph[oổ]i/i,
    organ: 'lungs',
    severity: 'warning',
    reason: 'Tổn thương nhu mô phổi & đường dẫn khí. Cần tăng cường chất chống oxy hóa, vitamin C và hạn chế muối.',
    nutrientLimits: { antioxidant_rich: true, sodium_max_mg: 1800 }
  },

  // Tuyến giáp & Nội tiết cổ
  {
    names: ['Cường giáp (Basedow)', 'Suy tuyến giáp', 'Bướu cổ'],
    regex: /c[uư][oờ]ng\s+gi[aá]p|suy\s+gi[aá]p|tuy[eế]n\s+gi[aá]p|basedow|b[uư][oớ]u\s+c[oổ]/i,
    organ: 'thyroid',
    severity: 'warning',
    reason: 'Rối loạn hormone tuyến giáp (T3/T4/TSH). Điều chỉnh lượng I-ốt trong khẩu phần ăn theo phác đồ chuyên khoa.',
    nutrientLimits: { iodine_control: true }
  },

  // Não bộ & Thần kinh
  {
    names: ['Thiếu máu não', 'Rối loạn tiền đình', 'Đột quỵ não'],
    regex: /[đd][oộ]t\s+qu[yị]|tai\s+bi[eế]n|thi[eế]u\s+m[aá]u\s+n[aã]o|ti[eề]n\s+[đd][iì]nh|migraine/i,
    organ: 'brain',
    severity: 'critical',
    reason: 'Rối loạn tuần hoàn não và nguy cơ tổn thương tế bào thần kinh. Cần kiểm soát huyết áp và bổ sung Omega-3.',
    nutrientLimits: { sodium_max_mg: 1500, omega3_rich: true }
  }
]

export function stripVietnameseDiacritics(input: string): string {
  return (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
}

export function isNoisyDiagnosis(raw: string): boolean {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ')
  if (trimmed.length < 3) return true
  if (/\.(?:docx?|pdf|png|jpe?g|webp|gif|bmp|tiff?|txt|rtf|xlsx?|csv)\b/i.test(trimmed)) return true

  const ascii = stripVietnameseDiacritics(trimmed)
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (/\b(?:ho\s+so\s+benh\s+an|phieu\s+xet\s+nghiem|ket\s+qua\s+xet\s+nghiem|benh\s+an\s+(?:noi|ngoai)\s+tru|tom\s+tat\s+benh\s+an|to\s+dieu\s+tri)\b/i.test(ascii)) {
    return true
  }
  if (/\b(?:icd[-\s]?10|clinical\s+diagnosis|chan\s+doan|diagnosis|danh\s+sach|ma\s+icd)\b/i.test(ascii)) {
    return true
  }

  const strippedHeader = ascii
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (
    !strippedHeader ||
    /^(?:xac\s+dinh|lam\s+sang(?:\s+xac\s+dinh)?|xac\s+dinh\s+lam\s+sang|so\s+bo|phan\s+biet|ra\s+vien|vao\s+vien|ket\s+luan|benh\s+chinh|benh\s+kem(?:\s+theo)?|thong\s+tin\s+hanh\s+chinh|ho\s+va\s+ten|don\s+thuoc(?:\s+dieu\s+tri)?|chi\s+so\s+xet\s+nghiem|chi\s+so\s+sinh\s+hoa|phac\s+do\s+dieu\s+tri|muc\s+do|co\s+quan|khong\s+co|chua\s+phan\s+loai)$/.test(
      strippedHeader
    )
  ) {
    return true
  }

  if (/^[a-z]\d{2}(?:\.\d+)?(?:\s*\/\s*[a-z]\d{2}(?:\.\d+)?)*$/i.test(ascii)) return true
  if (/^(?:khong|chua|am\s+tinh|loai\s+tru)\b/i.test(ascii)) return true
  if (/\b(?:binh\s+thuong|khoe\s+manh)\b/i.test(ascii)) return true

  return false
}

export function cleanDiseaseLabel(raw: string): string {
  let cleaned = (raw || '').trim().replace(/\s+/g, ' ')
  cleaned = cleaned.replace(/^[-•*+·]+\s*/, '').replace(/^\d+[.)]\s+/, '')
  cleaned = cleaned.replace(
    /^(?:ch[aẩ]n\s+[đd]o[aá]n(?:\s+(?:x[aá]c\s+[đd][iị]nh|l[aâ]m\s+s[aà]ng|s[oơ]\s+b[oộ]|ra\s+vi[eệ]n|v[aà]o\s+vi[eệ]n|ch[ií]nh|ph[uụ]))?|k[eế]t\s+lu[aậ]n|b[eệ]nh\s+ch[ií]nh|b[eệ]nh\s+k[eè]m(?:\s+theo)?|diagnosis)\s*[:\-–]\s*/i,
    ''
  )
  cleaned = cleaned.replace(/[,;:\s]+$/g, '')
  if (!/\.[a-z0-9]{2,5}\.?$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\.+$/g, '').trim()
  }
  return cleaned
}

const CANONICAL_CONDITION_GROUPS: Array<{ id: string; purePattern: RegExp; coversPattern: RegExp }> = [
  {
    id: 'gerd',
    purePattern: /^(?:benh\s+)?(?:trao\s+nguoc\s+da\s+day(?:\s+thuc\s+quan)?(?:\s*\(gerd\))?|gerd)$/,
    coversPattern: /\bgerd\b|trao\s+nguoc\s+da\s+day/
  },
  {
    id: 'hypertension',
    purePattern: /^(?:benh\s+)?(?:tang|cao)\s+huyet\s+ap(?:\s+vo\s+can)?(?:\s+do\s+\d+)?(?:\s*\([^)]*\))?$|^hypertension$/,
    coversPattern: /(?:tang|cao)\s+huyet\s+ap|\bhypertension\b/
  },
  {
    id: 'gout',
    purePattern: /^(?:benh\s+)?(?:gout|gut)(?:\s*\((?:gout|gut)\))?(?:\s+(?:cap|man(?:\s+tinh)?))?(?:\s*\([^)]*\))?$/,
    coversPattern: /\b(?:gout|gut)\b/
  },
  {
    id: 'ckd',
    purePattern: /^(?:benh\s+than\s+man|suy\s+than\s+man)(?:\s*\(?ckd\)?)?$/,
    coversPattern: /suy\s+than\s+man|benh\s+than\s+man|\bckd\b/
  },
  {
    id: 't2d',
    purePattern: /^(?:dai\s+thao\s+duong|tieu\s+duong)(?:\s*(?:type|typ)\s*2)?(?:\s*\(t2d\))?$|^t2d$/,
    coversPattern: /(?:dai\s+thao\s+duong|tieu\s+duong).*\b2\b|\bt2d\b/
  },
  {
    id: 'fatty_liver',
    purePattern: /^gan\s+nhiem\s+mo(?:\s+do\s+\d+)?$/,
    coversPattern: /gan\s+nhiem\s+mo|fatty\s+liver/
  }
]

export function cleanAndDeduplicateDiseases(diseases: string[] | undefined | null): string[] {
  if (!Array.isArray(diseases)) return []
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of diseases) {
    if (typeof raw !== 'string') continue
    const cleaned = cleanDiseaseLabel(raw)
    if (!cleaned || isNoisyDiagnosis(cleaned)) continue
    const key = cleaned.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(cleaned)
    }
  }

  const asciis = unique.map(item =>
    stripVietnameseDiacritics(item).toLowerCase().replace(/\s+/g, ' ').trim()
  )

  return unique.filter((itemA, idxA) => {
    const asciiA = asciis[idxA]
    for (let idxB = 0; idxB < unique.length; idxB++) {
      if (idxA === idxB) continue
      const itemB = unique[idxB]
      const asciiB = asciis[idxB]
      for (const group of CANONICAL_CONDITION_GROUPS) {
        if (group.purePattern.test(asciiA) && group.coversPattern.test(asciiB)) {
          const bIsNotPure = !group.purePattern.test(asciiB)
          if (
            bIsNotPure ||
            itemB.length > itemA.length ||
            (itemB.length === itemA.length && idxB < idxA)
          ) {
            return false
          }
        }
      }
    }
    return true
  })
}

function stripDosageSuffix(text: string): string {
  return text.replace(/\s+\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|ml|ui|iu|viên|gói)\b.*$/i, '').trim()
}

export function normalizeMedicationString(raw: string): string {
  let text = (raw || '').trim().replace(/\s+/g, ' ').replace(/\s*\(\s*\)/g, '').trim()
  while (true) {
    const m = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
    if (!m) break
    const prefix = m[1].trim()
    const paren = m[2].trim()
    if (!prefix) break

    const parenNorm = paren.toLocaleLowerCase('vi').replace(/\s+/g, ' ')
    const prefixNoParens = prefix.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    const baseNameNorm = stripDosageSuffix(prefixNoParens).toLocaleLowerCase('vi')
    const existingParens = Array.from(prefix.matchAll(/\(([^()]+)\)/g)).map(x =>
      x[1].trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ')
    )

    if (
      parenNorm === prefix.toLocaleLowerCase('vi') ||
      parenNorm === baseNameNorm ||
      (baseNameNorm.length > 0 && stripDosageSuffix(paren).toLocaleLowerCase('vi') === baseNameNorm) ||
      existingParens.includes(parenNorm)
    ) {
      text = prefix
      continue
    }
    break
  }
  return text
}

export function formatMedicationDisplay(name: string, activeIngredient?: string): string {
  const cleanName = normalizeMedicationString(name)
  const cleanIngredient = (activeIngredient || '').trim().replace(/\s+/g, ' ')
  if (!cleanName) return cleanIngredient
  if (!cleanIngredient) return cleanName
  return normalizeMedicationString(`${cleanName} (${cleanIngredient})`)
}

export function cleanAndDeduplicateMedications(meds: string[] | undefined | null): string[] {
  if (!Array.isArray(meds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of meds) {
    if (typeof raw !== 'string') continue
    const normalized = normalizeMedicationString(raw)
    if (!normalized) continue
    const key = normalized.toLocaleLowerCase('vi')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(normalized)
    }
  }
  return out
}

export function filterAndDeduplicateConditions<T extends { name: string }>(items: T[] | undefined | null): T[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (!item?.name) continue
    const cleanName = cleanDiseaseLabel(item.name)
    if (!cleanName || isNoisyDiagnosis(cleanName)) continue
    const key = cleanName.toLocaleLowerCase('vi')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(cleanName === item.name ? item : { ...item, name: cleanName })
    }
  }
  return out
}

function splitOutsideParens(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function sanitizeClinicalText(rawText: string): { sanitizedFull: string; positiveDiseaseText: string } {
  const injectionPattern = /(ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|disregard\s+all|system\s+prompt|you\s+are\s+now|bỏ\s+qua\s+(?:tất\s+cả\s+)?(?:hướng\s+dẫn|quy\s+tắc)|hãy\s+thêm\s+(?:thuốc|bệnh)|forget\s+all)/i
  const lines = rawText
    .split(/\r?\n/)
    .filter(line => !injectionPattern.test(line))

  const sanitizedFull = lines.join('\n')
  // Strip negated diagnostic/allergy phrases without corrupting numeric decimals or indentation
  const negationSubClause = /(?:^|[\s.;:(])(?:không(?:\s+(?:có|bị|mắc|dị\s+ứng|phát\s+hiện|ghi\s+nhận|dùng|sử\s+dụng|tiền\s+sử))?|chưa\s+(?:phát\s+hiện|ghi\s+nhận|có)|âm\s+tính\s+với|loại\s+trừ|no\s+evidence\s+of|denies|negative\s+for)\s+(?:(?!(?:nhưng|song|tuy\s+nhiên)\b)[^.;\n])*/gi
  const positiveDiseaseText = sanitizedFull.replace(negationSubClause, ' ')
  return { sanitizedFull, positiveDiseaseText }
}

export function extractClinicalDataFromText(
  extractedText: string,
  fileName: string = 'Ho-so-benh-an.pdf'
): MedicalRecordExtraction {
  const { sanitizedFull, positiveDiseaseText } = sanitizeClinicalText(extractedText)
  const norm = sanitizedFull.toLowerCase()
  const normDiseases = positiveDiseaseText.toLowerCase()
  const detectedDiseases: string[] = []
  const organMapRecord: Partial<Record<OrganId, OrganMapping>> = {}

  // 1. Check explicit ICD-10 Clinical Diagnosis Table rows (e.g. from structured hospital docx/pdf)
  const icdTableRegex = /([A-Z]\d{2}(?:\.\d+)?(?:\s*[\/]\s*[A-Z]\d{2}(?:\.\d+)?)*)\s*[\r\n]+\s*([^:\r\n]+?)(?::\s*([^\r\n]+))?\s*[\r\n]+\s*[^()\r\n]*\(([a-z_]+)\)\s*[\r\n]+\s*(NGHIÊM TRỌNG|BÁO ĐỘNG|CẢNH BÁO|CRITICAL|WARNING)/gi
  let icdMatch: RegExpExecArray | null
  while ((icdMatch = icdTableRegex.exec(sanitizedFull)) !== null) {
    const code = icdMatch[1].trim()
    const rawName = icdMatch[2].trim()
    const desc = icdMatch[3] ? icdMatch[3].trim() : ''
    const organId = icdMatch[4].trim() as OrganId
    const sevRaw = icdMatch[5].trim().toUpperCase()
    const sev: Severity = (sevRaw.includes('NGHIÊM TRỌNG') || sevRaw.includes('BÁO ĐỘNG') || sevRaw.includes('CRITICAL'))
      ? 'critical'
      : 'warning'

    const fullName = `${rawName} (${code})`
    if (!isNoisyDiagnosis(rawName) && !detectedDiseases.includes(fullName)) {
      detectedDiseases.push(fullName)
    }

    organMapRecord[organId] = {
      organ_id: organId,
      severity: sev,
      reason: desc ? `${rawName}: ${desc}` : rawName,
      nutrient_limits: {}
    }
  }

  // 2. Check explicit "Chẩn đoán:" / "Kết luận:" lines (using positiveDiseaseText so negated/injected lines are excluded)
  const diagLineRegex = /(?:ch[aẩ]n\s+[đd]o[aá]n(?:\s+(?:x[aá]c\s+[đd][iị]nh|l[aâ]m\s+s[aà]ng|s[oơ]\s+b[oộ]|ra\s+vi[eệ]n|v[aà]o\s+vi[eệ]n|ch[ií]nh|ph[uụ]))?|k[eế]t\s+lu[aậ]n|b[eệ]nh\s+ch[ií]nh|b[eệ]nh\s+k[eè]m(?:\s+theo)?|diagnosis)\s*:\s*([^\n\r]+)/gi
  let diagMatch: RegExpExecArray | null
  while ((diagMatch = diagLineRegex.exec(positiveDiseaseText)) !== null) {
    const truncatedAtNextSection = diagMatch[1].split(/\b(?:[đd]ơn\s+thuốc|thuốc\s+điều\s+trị|phác\s+đồ|kết\s+quả\s+xét\s+nghiệm|chỉ\s+số\s+xét\s+nghiệm|dị\s+ứng|lời\s+dặn)\s*:/i)[0]
    const sentences = truncatedAtNextSection.split(/\.(?:\s+|$)/)
    for (const sentence of sentences) {
      const parts = splitOutsideParens(sentence)
      for (const rawPart of parts) {
        const cleaned = cleanDiseaseLabel(rawPart)
        if (cleaned && !isNoisyDiagnosis(cleaned) && !detectedDiseases.includes(cleaned)) {
          detectedDiseases.push(cleaned)
        }
      }
    }
  }

  // 3. Match against comprehensive clinical disease database
  for (const rule of CLINICAL_DISEASE_RULES) {
    if (rule.regex.test(normDiseases)) {
      const alreadyCovered = detectedDiseases.some(d => rule.regex.test(d.toLowerCase()))
      if (!alreadyCovered && rule.names[0] && !detectedDiseases.includes(rule.names[0])) {
        detectedDiseases.push(rule.names[0])
      }
      if (!organMapRecord[rule.organ] || organMapRecord[rule.organ]?.severity !== 'critical') {
        organMapRecord[rule.organ] = {
          organ_id: rule.organ,
          severity: rule.severity,
          reason: rule.reason,
          nutrient_limits: rule.nutrientLimits
        }
      }
    }
  }

  // 4. Extract Lab Metrics via clinical Regex
  const metrics: LabMetric[] = []

  // Creatinine
  const creatMatch = norm.match(/\b(?:creatinine(?:\s+huy[eế]t\s+thanh)?|cre)\b[^\d]{0,20}([0-9.]+)\s*(µmol\/l|umol\/l|mg\/dl)?/i)
  if (creatMatch) {
    const val = parseFloat(creatMatch[1])
    const unit = creatMatch[2] || 'µmol/L'
    const isHigh = unit.toLowerCase().includes('mg') ? val > 1.2 : val > 106
    metrics.push({
      name: 'Creatinine',
      value: val,
      unit,
      status: isHigh ? 'high' : 'normal',
      referenceRange: unit.toLowerCase().includes('mg') ? '0.7 - 1.2 mg/dL' : '62 - 106 µmol/L',
      affectedOrgan: 'kidneys'
    })
    if (isHigh && !organMapRecord.kidneys) {
      organMapRecord.kidneys = {
        organ_id: 'kidneys',
        severity: val > 150 ? 'critical' : 'warning',
        reason: `Creatinine tăng cao (${val} ${unit}) - Thận giảm khả năng đào thải độc tố chuyển hóa.`,
        nutrient_limits: { protein_g_per_kg: 0.8, sodium_max_mg: 1500 }
      }
    }
  }

  // eGFR
  const egfrMatch = norm.match(/(?:m[uứ]c\s+l[oọ]c\s+c[aầ]u\s+th[aậ]n(?:\s*\(egfr\))?|egfr|mlct)[^\d]{0,20}([0-9.]+)\s*(ml\/min|ml\/ph[uú]t)?/i)
  if (egfrMatch) {
    const val = parseFloat(egfrMatch[1])
    const isLow = val < 60
    metrics.push({
      name: 'eGFR',
      value: val,
      unit: 'ml/phút/1.73m²',
      status: isLow ? 'low' : 'normal',
      referenceRange: '> 90',
      affectedOrgan: 'kidneys'
    })
    if (val < 45) {
      organMapRecord.kidneys = {
        organ_id: 'kidneys',
        severity: 'critical',
        reason: `eGFR suy giảm nặng (${val} ml/phút) - Bệnh thận mạn giai đoạn 3b-4.`,
        nutrient_limits: { protein_g_per_kg: 0.8, potassium_max_mg: 1800, sodium_max_mg: 1500 }
      }
    } else if (val < 60 && (!organMapRecord.kidneys || organMapRecord.kidneys.severity !== 'critical')) {
      organMapRecord.kidneys = {
        organ_id: 'kidneys',
        severity: 'warning',
        reason: `eGFR giảm (${val} ml/phút). Cần theo dõi chức năng thận và điều chỉnh chế độ ăn.`,
        nutrient_limits: { sodium_max_mg: 1800 }
      }
    }
  }

  // Kali máu (K+)
  const kaliMatch = norm.match(/(?:kali(?:\s+m[aá]u)?|potassium)[^\d]{0,20}([0-9.]+)\s*(mmol\/l|meq\/l)?/i)
  if (kaliMatch) {
    const val = parseFloat(kaliMatch[1])
    const isHigh = val > 5.0
    metrics.push({
      name: 'Kali máu (K+)',
      value: val,
      unit: 'mmol/L',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '3.5 - 5.0',
      affectedOrgan: 'kidneys'
    })
    if (isHigh && organMapRecord.kidneys) {
      organMapRecord.kidneys.nutrient_limits = {
        ...organMapRecord.kidneys.nutrient_limits,
        potassium_max_mg: 1800
      }
    }
  }

  // Natri máu (Na+)
  const natriMatch = norm.match(/(?:natri(?:\s+m[aá]u)?|sodium)[^\d]{0,20}([0-9.]+)\s*(mmol\/l|meq\/l)?/i)
  if (natriMatch) {
    const val = parseFloat(natriMatch[1])
    metrics.push({
      name: 'Natri máu (Na+)',
      value: val,
      unit: 'mmol/L',
      status: val > 145 ? 'high' : val < 135 ? 'low' : 'normal',
      referenceRange: '135 - 145',
      affectedOrgan: 'heart'
    })
  }

  // Sỏi thận & Kích thước sỏi siêu âm
  const stoneSizeMatch =
    norm.match(/(?:s[oỏ]i.*?k[ií]ch\s+th[uư][oớ]c|k[ií]ch\s+th[uư][oớ]c\s+s[oỏ]i|kt\s+s[oỏ]i|s[oỏ]i.*?kt|s[oỏ]i\s+[đd][aà]i\s+th[aậ]n.*?)[:\s]*([0-9.,]+)\s*(mm|cm)/i) ||
    norm.match(/s[oỏ]i.*?([0-9.,]+)\s*(mm|cm)/i)
  if (stoneSizeMatch && /s[oỏ]i/i.test(norm)) {
    const sVal = stoneSizeMatch[1]
    const sUnit = stoneSizeMatch[2] || 'mm'
    metrics.push({
      name: 'Kích thước sỏi thận',
      value: `${sVal} ${sUnit}`,
      unit: '',
      status: 'high',
      referenceRange: 'Không có sỏi',
      affectedOrgan: 'kidneys'
    })
    const numSize = parseFloat(sVal)
    if (numSize >= 8 || /ứ\s*nước|tắc\s*nghẽn/i.test(norm)) {
      organMapRecord.kidneys = {
        organ_id: 'kidneys',
        severity: 'critical',
        reason: `Sỏi thận kích thước lớn (${sVal} ${sUnit}) có nguy cơ gây ứ nước hoặc tắc nghẽn niệu quản. Cần theo dõi sát chỉ định ngoại khoa và tuân thủ chế độ uống nước nghiêm ngặt.`,
        nutrient_limits: { water_min_ml: 2500, sodium_max_mg: 1500, avoid_oxalate: true }
      }
    }
  }

  // Hồng cầu niệu (RBC)
  const rbcMatch = norm.match(/(?:h[oồ]ng\s+c[aầ]u\s+ni[eệ]u|rbc\s+ni[eệ]u|erythrocytes)[:\s]+([^\n,;]+)/i)
  if (rbcMatch) {
    const raw = rbcMatch[1].trim()
    const isPos = /[1-9]|\+|\bpos\b|d[uư][oơ]ng/i.test(raw)
    metrics.push({
      name: 'Hồng cầu niệu (RBC)',
      value: raw,
      unit: '',
      status: isPos ? 'high' : 'normal',
      referenceRange: 'Âm tính (-)',
      affectedOrgan: 'kidneys'
    })
  }

  // Glucose máu lúc đói
  const glucoseMatch = norm.match(/(?:glucose(?:\s+m[aá]u)?(?:\s+l[uú]c\s+[đd][oó]i)?)[^\d]{0,20}([0-9.]+)\s*(mmol\/l|mg\/dl)?/i)
  if (glucoseMatch) {
    const val = parseFloat(glucoseMatch[1])
    const isHigh = val > 7.0
    metrics.push({
      name: 'Glucose máu lúc đói',
      value: val,
      unit: 'mmol/L',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '3.9 - 5.6',
      affectedOrgan: 'pancreas'
    })
    if (isHigh && !organMapRecord.pancreas) {
      organMapRecord.pancreas = {
        organ_id: 'pancreas',
        severity: val > 11.0 ? 'critical' : 'warning',
        reason: `Đường huyết đói cao (${val} mmol/L). Rối loạn chuyển hóa carbohydrate.`,
        nutrient_limits: { gi_max: 55, free_sugar_g: 0 }
      }
    }
  }

  // HbA1c
  const hba1cMatch = norm.match(/(?:hba1c)[^\d]{0,20}([0-9.]+)\s*%/i)
  if (hba1cMatch) {
    const val = parseFloat(hba1cMatch[1])
    const isHigh = val >= 6.5
    metrics.push({
      name: 'HbA1c',
      value: `${val}%`,
      unit: '',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '< 5.7%',
      affectedOrgan: 'pancreas'
    })
    if (val >= 8.0) {
      organMapRecord.pancreas = {
        organ_id: 'pancreas',
        severity: 'critical',
        reason: `HbA1c ${val}% rất cao (mục tiêu < 7.0%) - Đái tháo đường kiểm soát kém.`,
        nutrient_limits: { gi_max: 55, free_sugar_g: 0 }
      }
    }
  }

  // Acid Uric
  const uricMatch = norm.match(/(?:acid\s+uric(?:\s+m[aá]u)?|axit\s+uric)[^\d]{0,20}([0-9.]+)\s*(µmol\/l|umol\/l|mg\/dl)?/i)
  if (uricMatch) {
    const val = parseFloat(uricMatch[1])
    const unit = uricMatch[2] || 'µmol/L'
    const isHigh = unit.toLowerCase().includes('mg') ? val > 7.0 : val > 428
    metrics.push({
      name: 'Acid Uric máu',
      value: val,
      unit,
      status: isHigh ? 'high' : 'normal',
      referenceRange: unit.toLowerCase().includes('mg') ? '3.5 - 7.0 mg/dL' : '208 - 428 µmol/L',
      affectedOrgan: 'joints'
    })
    if (isHigh && !organMapRecord.joints) {
      organMapRecord.joints = {
        organ_id: 'joints',
        severity: val > 500 ? 'critical' : 'warning',
        reason: `Acid Uric tăng cao (${val} ${unit}). Nguy cơ kết tủa tinh thể Urat tại khớp gây cơn Gout cấp.`,
        nutrient_limits: { purine_level: 'Thấp', avoid_red_meat: true }
      }
    }
  }

  // Triglyceride
  const trigMatch = norm.match(/(?:triglyceride(?:\s+m[aá]u)?)[^\d]{0,20}([0-9.]+)\s*(mmol\/l|mg\/dl)?/i)
  if (trigMatch) {
    const val = parseFloat(trigMatch[1])
    const isHigh = val > 1.7
    metrics.push({
      name: 'Triglyceride',
      value: val,
      unit: 'mmol/L',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '< 1.7',
      affectedOrgan: 'liver'
    })
  }

  // Cholesterol toàn phần
  const cholMatch = norm.match(/(?:cholesterol(?:\s+to[aà]n\s+ph[aầ]n)?)[^\d]{0,20}([0-9.]+)\s*(mmol\/l|mg\/dl)?/i)
  if (cholMatch) {
    const val = parseFloat(cholMatch[1])
    const isHigh = val > 5.2
    metrics.push({
      name: 'Cholesterol toàn phần',
      value: val,
      unit: 'mmol/L',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '< 5.2',
      affectedOrgan: 'heart'
    })
  }

  // AST / ALT
  const astMatch = norm.match(/(?:ast(?:\s*\(got\))?)[^\d]{0,20}([0-9.]+)\s*(u\/l|ui\/l)?/i)
  if (astMatch) {
    const val = parseFloat(astMatch[1])
    metrics.push({
      name: 'AST (GOT)',
      value: val,
      unit: 'U/L',
      status: val > 40 ? 'high' : 'normal',
      referenceRange: '< 40',
      affectedOrgan: 'liver'
    })
  }

  const altMatch = norm.match(/(?:alt(?:\s*\(gpt\))?)[^\d]{0,20}([0-9.]+)\s*(u\/l|ui\/l)?/i)
  if (altMatch) {
    const val = parseFloat(altMatch[1])
    metrics.push({
      name: 'ALT (GPT)',
      value: val,
      unit: 'U/L',
      status: val > 40 ? 'high' : 'normal',
      referenceRange: '< 40',
      affectedOrgan: 'liver'
    })
  }

  // Huyết áp
  const bpMatch = norm.match(/(?:huy[eế]t\s+[aá]p|ha|bp)[^\d]{0,20}([0-9]{2,3}\s*[\/]\s*[0-9]{2,3})\s*(mmhg)?/i)
  if (bpMatch) {
    const val = bpMatch[1].replace(/\s+/g, '')
    const parts = val.split('/')
    const sys = parseInt(parts[0], 10)
    const isHigh = sys >= 135
    metrics.push({
      name: 'Huyết áp',
      value: val,
      unit: 'mmHg',
      status: isHigh ? 'high' : 'normal',
      referenceRange: '< 120/80',
      affectedOrgan: 'heart'
    })
    if (isHigh && !organMapRecord.heart) {
      organMapRecord.heart = {
        organ_id: 'heart',
        severity: sys >= 150 ? 'critical' : 'warning',
        reason: `Huyết áp ${val} mmHg cao. Nguy cơ biến cố tim mạch.`,
        nutrient_limits: { sodium_max_mg: 1500 }
      }
    }
  }

  // 4. Extract Medications (using negated-stripped normDiseases and preserving source dosage L02)
  const extractDoseLine = (kw: RegExp, fallback: string): string => {
    const lines = positiveDiseaseText.split(/\r?\n/)
    const matchLine = lines.find(l => kw.test(l))
    if (!matchLine) return fallback
    const cleaned = matchLine.replace(/^[^:]*:\s*/, '').trim()
    const doseMatch = cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|ml|ui|viên)[^\n,.;]*)/i)
    return doseMatch ? doseMatch[1].trim() : (cleaned.length > 0 && cleaned.length < 80 ? cleaned : fallback)
  }

  const medications: MedicationInfo[] = []
  if (/nexium|esomeprazole/i.test(normDiseases)) {
    medications.push({
      name: 'Nexium 40mg',
      activeIngredient: 'Esomeprazole',
      dosage: extractDoseLine(/nexium|esomeprazole/i, '40mg x 1 viên trước ăn sáng'),
      purpose: 'Ức chế bơm proton, giảm acid dạ dày',
      ddiAlert: 'Uống trước bữa ăn 30-60 phút. Không nhai nát viên.',
      affectedOrgan: 'stomach'
    })
  }
  if (/phosphalugel|gastropulgite/i.test(normDiseases)) {
    medications.push({
      name: 'Phosphalugel',
      activeIngredient: 'Aluminium phosphate',
      dosage: extractDoseLine(/phosphalugel|gastropulgite/i, '1-2 gói khi đau hoặc sau ăn'),
      purpose: 'Bảo vệ niêm mạc dạ dày',
      ddiAlert: 'Dùng cách xa các thuốc khác ít nhất 2 giờ.',
      affectedOrgan: 'stomach'
    })
  }
  if (/metformin|glucophage/i.test(normDiseases)) {
    const doseStr = extractDoseLine(/metformin|glucophage/i, '')
    medications.push({
      name: /glucophage/i.test(normDiseases) ? 'Glucophage' : 'Metformin',
      activeIngredient: 'Metformin',
      dosage: doseStr,
      purpose: 'Kiểm soát đường huyết, giảm đề kháng insulin',
      ddiAlert: 'Tuyệt đối không uống rượu bia khi dùng Metformin (nguy cơ nhiễm toan lactic).',
      affectedOrgan: 'pancreas'
    })
  }
  if (/amlodipine|norvasc/i.test(normDiseases)) {
    medications.push({
      name: 'Amlodipine',
      activeIngredient: 'Amlodipine',
      dosage: extractDoseLine(/amlodipine|norvasc/i, '5mg x 1 viên mỗi sáng'),
      purpose: 'Hạ áp, giãn mạch ngoại vi',
      ddiAlert: 'Tránh dùng cùng bưởi chùm vì làm tăng nồng độ thuốc trong máu.',
      affectedOrgan: 'heart'
    })
  }
  if (/allopurinol|zyloric/i.test(normDiseases)) {
    medications.push({
      name: /zyloric/i.test(normDiseases) ? 'Zyloric' : 'Allopurinol',
      activeIngredient: 'Allopurinol',
      dosage: extractDoseLine(/allopurinol|zyloric/i, '300mg x 1 viên sau ăn'),
      purpose: 'Hạ Acid Uric máu, phòng ngừa cơn Gout cấp',
      ddiAlert: 'Uống nhiều nước (> 2 lít/ngày) để tránh kết tủa tinh thể.',
      affectedOrgan: 'joints'
    })
  }
  if (/rowatinex|kim\s+ti[eề]n\s+th[aả]o/i.test(normDiseases)) {
    medications.push({
      name: /rowatinex/i.test(normDiseases) ? 'Rowatinex' : 'Kim Tiền Thảo',
      activeIngredient: /rowatinex/i.test(normDiseases) ? 'Pinene, Camphene, Cineol' : 'Herba Desmodii styracifolii',
      dosage: extractDoseLine(/rowatinex|kim\s+ti[eề]n\s+th[aả]o/i, '1 viên x 3 lần/ngày'),
      purpose: 'Lợi tiểu, giãn cơ trơn đường tiết niệu, hỗ trợ bài xuất sỏi',
      ddiAlert: 'Bắt buộc uống với nhiều nước (> 2.5 lít/ngày).',
      affectedOrgan: 'kidneys'
    })
  }
  if (/warfarin|coumadin/i.test(normDiseases)) {
    medications.push({
      name: 'Warfarin',
      activeIngredient: 'Warfarin',
      dosage: extractDoseLine(/warfarin|coumadin/i, '5mg x 1 viên mỗi tối (20h00)'),
      purpose: 'Thuốc chống đông kháng Vitamin K, phòng ngừa đột quỵ & tắc mạch',
      ddiAlert: 'Tránh biến thiên đột ngột lượng rau xanh giàu Vitamin K (rau bina, cải xoăn, bông cải).',
      affectedOrgan: 'heart'
    })
  }
  if (/atorvastatin|lipitor/i.test(normDiseases)) {
    medications.push({
      name: 'Atorvastatin',
      activeIngredient: 'Atorvastatin',
      dosage: extractDoseLine(/atorvastatin|lipitor/i, '20mg x 1 viên sau ăn tối'),
      purpose: 'Hạ lipid máu, giảm mỡ máu nhóm Statin',
      ddiAlert: 'CẤM TUYỆT ĐỐI bưởi chùm (Grapefruit) do ức chế enzyme CYP3A4 gây tiêu cơ vân.',
      affectedOrgan: 'liver'
    })
  }
  if (/losartan|cozaar/i.test(normDiseases)) {
    medications.push({
      name: 'Losartan',
      activeIngredient: 'Losartan',
      dosage: extractDoseLine(/losartan|cozaar/i, '50mg x 1 viên mỗi sáng'),
      purpose: 'Hạ huyết áp nhóm đối kháng thụ thể Angiotensin II (ARB)',
      ddiAlert: 'Ức chế Aldosterone gây tăng giữ Kali máu. Cấm muối giảm Natri chứa KCl.',
      affectedOrgan: 'kidneys'
    })
  }

  // 5. Extract Allergies & Food Intolerances (negation-safe)
  const allergies: string[] = []
  if (/t[oô]m|cua|gi[aá]p\s+x[aá]c|shellfish/i.test(normDiseases)) {
    allergies.push('Tôm, Cua, Giáp xác (Shellfish)')
  }
  if (/[đd][aậ]u\s+ph[oộ]ng|l[aạ]c|peanut/i.test(normDiseases)) {
    allergies.push('Đậu phộng / Lạc (Peanuts)')
  }
  if (/lactose|s[uư]a\s+b[oò]/i.test(normDiseases)) {
    allergies.push('Bất dung nạp đường Lactose')
  }

  // 6. Build Organ Mappings List
  // Core organs are mapped with their evaluated status (normal if not diseased)
  const coreOrgans: OrganId[] = ['heart', 'liver', 'stomach', 'pancreas', 'kidneys', 'joints']
  for (const org of coreOrgans) {
    if (!organMapRecord[org]) {
      organMapRecord[org] = {
        organ_id: org,
        severity: 'normal',
        reason: 'Chỉ số và chức năng cơ quan trong giới hạn bình thường.',
        nutrient_limits: {}
      }
    }
  }

  const organ_mappings: OrganMapping[] = Object.values(organMapRecord).filter((m): m is OrganMapping => Boolean(m))

  // 7. Final Clean diseases (never fabricate disease name from fileName)
  const finalDiseases = cleanAndDeduplicateDiseases(detectedDiseases)

  const rawSummary = finalDiseases.length > 0 || metrics.length > 0 || medications.length > 0
    ? `Hồ sơ "${fileName}" đã được đọc thành công. Hệ thống trích xuất được ${finalDiseases.length} tình trạng bệnh lý (${finalDiseases.join(', ')}), ${metrics.length} chỉ số sinh hóa và ${medications.length} thuốc điều trị.`
    : `Không trích xuất được bệnh lý hoặc chỉ số y khoa từ "${fileName}".`

  return {
    id: 'rec-' + Date.now(),
    name: fileName,
    date: new Date().toISOString().slice(0, 10),
    type: 'Bệnh án & Phiếu xét nghiệm trích xuất từ tài liệu',
    metrics,
    diseases: finalDiseases,
    allergies,
    medications,
    has_conflict: organ_mappings.some(m => m.severity === 'critical') || norm.includes('clinical_conflict_detected = true') || norm.includes('pending_expert_review'),
    conflict_reason: organ_mappings.some(m => m.severity === 'critical')
      ? 'Phát hiện cơ quan trong tình trạng cảnh báo cao. Chế độ dinh dưỡng cần tuân thủ nghiêm ngặt theo khuyến nghị CDSS.'
      : undefined,
    organ_mappings,
    raw_summary: rawSummary,
    confirmed: false
  }
}
