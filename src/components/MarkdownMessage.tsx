import React from 'react'

/**
 * Chuẩn hoá các biểu thức toán LaTeX (ví dụ: $\le 42\,\text{g/ngày}$)
 * về văn bản tiếng Việt tự nhiên và ký tự Unicode trực quan (≤ 42 g/ngày).
 */
export function cleanLatexMath(raw: string): string {
  if (!raw) return ''
  return raw
    // Gỡ cặp bọc công thức $$...$$ và $...$
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^\$\n]+?)\$/g, '$1')
    // Gỡ lệnh \text{...}, \mathrm{...}, \mathbf{...}
    .replace(/\\(?:text|mathrm|mathbf|textit|textbf)\{([^}]+)\}/g, '$1')
    // Chuyển ký hiệu so sánh & phép toán LaTeX sang ký tự Unicode
    .replace(/\\(?:le|leq)\b/g, '≤')
    .replace(/\\(?:ge|geq)\b/g, '≥')
    .replace(/\\times\b/g, '×')
    .replace(/\\pm\b/g, '±')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\(?:ne|neq)\b/g, '≠')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\degree\b/g, '°')
    .replace(/\\mu\b/g, 'µ')
    // Phân số \frac{a}{b} -> a/b
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    // Khoảng trắng LaTeX: \, \; \! \quad \qquad
    .replace(/\\[,;!\s]/g, ' ')
    .replace(/\\(?:quad|qquad)\b/g, ' ')
    // Xoá các dấu gạch chéo ngược lẻ tẻ trước từ hoặc dấu ngoặc
    .replace(/\\([a-zA-Z{}])/g, '$1')
    .replace(/\\/g, '')
    // Chuẩn hoá khoảng trắng ngang (giữ nguyên ngắt dòng \n)
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/[ \t]*([≤≥=<>±~])[ \t]*/g, ' $1 ')
    .replace(/[ \t]*\)/g, ')')
    .replace(/\([ \t]*/g, '(')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim()
}

function renderInline(text: string): React.ReactNode[] {
  const cleaned = cleanLatexMath(text)
  const nodes: React.ReactNode[] = []
  const tokenRegex = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*(?!\s)[^*\n]+?(?<!\s)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = tokenRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(cleaned.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-black/5 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderInline(token.slice(2, -2))}
        </strong>
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key++} className="italic">
          {renderInline(token.slice(1, -1))}
        </em>
      )
    }
    lastIndex = tokenRegex.lastIndex
  }

  if (lastIndex < cleaned.length) {
    nodes.push(cleaned.slice(lastIndex))
  }
  return nodes
}

export function MarkdownMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  const raw = cleanLatexMath(text || '')
  const lines = raw.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  const cursor = streaming ? (
    <span className="inline-block w-1.5 h-3 ml-0.5 bg-brand animate-pulse align-middle" />
  ) : null

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const headingMatch = line.match(/^#{1,4}\s+(.+)$/)
    if (headingMatch) {
      blocks.push(
        <div key={key++} className="font-semibold text-[13px] mt-1.5 mb-1">
          {renderInline(headingMatch[1].trim())}
        </div>
      )
      i++
      continue
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*•]\s+/, '')
        items.push(<li key={items.length}>{renderInline(content)}</li>)
        i++
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-4 space-y-1 my-1">
          {items}
        </ul>
      )
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, '')
        items.push(<li key={items.length}>{renderInline(content)}</li>)
        i++
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-4 space-y-1 my-1">
          {items}
        </ol>
      )
      continue
    }

    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="my-1 first:mt-0 last:mb-0">
        {paraLines.map((pl, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl)}
          </React.Fragment>
        ))}
      </p>
    )
  }

  if (blocks.length === 0) {
    return <div className="space-y-1">{cursor}</div>
  }

  return (
    <div className="space-y-1">
      {blocks}
      {cursor}
    </div>
  )
}
