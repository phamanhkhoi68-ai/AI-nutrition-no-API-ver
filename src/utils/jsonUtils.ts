/**
 * Ultra-resilient JSON extractor for LLM / Vision model outputs.
 * Handles:
 * - Markdown fences: ```json ... ``` or ``` ... ```
 * - Preceding / trailing conversational commentary or explanation text
 * - Trailing commas before closing braces/brackets
 * - Balanced brace/bracket extraction for nested JSON structures
 * - Strip comments or extra whitespace
 */

export function extractJsonBlock<T = any>(text: any): T | null {
  if (text === null || text === undefined) return null
  if (typeof text === 'object') return text as T
  if (typeof text !== 'string') return null

  const trimmed = text.trim()
  if (!trimmed) return null

  // 1. Direct parse attempt
  try {
    return JSON.parse(trimmed) as T
  } catch {}

  // 2. Extract from markdown code fences: ```(?:json)?\s*([\s\S]*?)\s*```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(trimmed)) !== null) {
    const candidate = match[1]?.trim()
    if (candidate) {
      const parsed = tryParseWithSanitization<T>(candidate)
      if (parsed !== null) return parsed
    }
  }

  // 3. Balanced bracket extractor for outermost { ... } or [ ... ]
  const firstBrace = trimmed.indexOf('{')
  const firstBracket = trimmed.indexOf('[')
  let startIdx = -1
  let openChar = '{'
  let closeChar = '}'

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace
    openChar = '{'
    closeChar = '}'
  } else if (firstBracket !== -1) {
    startIdx = firstBracket
    openChar = '['
    closeChar = ']'
  }

  if (startIdx !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    let matchedEnd = -1

    for (let i = startIdx; i < trimmed.length; i++) {
      const c = trimmed[i]
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (c === openChar) {
          depth++
        } else if (c === closeChar) {
          depth--
          if (depth === 0) {
            matchedEnd = i
            break
          }
        }
      }
    }

    if (matchedEnd !== -1) {
      const candidate = trimmed.slice(startIdx, matchedEnd + 1)
      const parsed = tryParseWithSanitization<T>(candidate)
      if (parsed !== null) return parsed
    }

    // 4. Greedy match between startIdx and lastIndexOf(closeChar)
    const lastClose = trimmed.lastIndexOf(closeChar)
    if (lastClose > startIdx) {
      const candidate = trimmed.slice(startIdx, lastClose + 1)
      const parsed = tryParseWithSanitization<T>(candidate)
      if (parsed !== null) return parsed
    }
  }

  return null
}

function tryParseWithSanitization<T>(str: string): T | null {
  const clean = str.trim()
  if (!clean) return null

  try {
    return JSON.parse(clean) as T
  } catch {}

  // Strip trailing commas before } or ]
  try {
    const noTrailingCommas = clean.replace(/,\s*([\}\]])/g, '$1')
    return JSON.parse(noTrailingCommas) as T
  } catch {}

  // Remove common JS comments if present & trailing commas
  try {
    const noComments = clean
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*/g, '$1')
      .replace(/,\s*([\}\]])/g, '$1')
    return JSON.parse(noComments) as T
  } catch {}

  return null
}
