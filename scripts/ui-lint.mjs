import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BAN = [
  [/Sparkles/, 'sparkle icon'],
  [/backdrop-blur/, 'glass blur'],
  [/animate-(pulse|ping|bounce)/, 'looping animation'],
  [/rounded-3xl/, 'oversized radius'],
  [/(bg-gradient|linear-gradient)/, 'gradient (allow-list only)'],
  [/\p{Extended_Pictographic}/u, 'emoji']
]

const JARGON_RE = /\b(CDSS|FDA)\b/

const ALLOW = new Set([
  'src/styles/paper-grain.css',
  'src/components/Anatomy3DVisualizer.tsx',
  'src/components/Medical3DViewer.tsx'
])

const SCAN_DIRS = [
  'src/ui',
  'src/components',
  'src/layouts',
  'src/pages',
  'src/features',
  'src/styles'
]

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const bad = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const norm = full.replace(/\\/g, '/')
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(tsx?|css)$/.test(norm) || ALLOW.has(norm)) continue
    const raw = readFileSync(full, 'utf8')
    const noComments = stripComments(raw)
    for (const [re, why] of BAN) {
      if (re.test(noComments)) bad.push(`${norm}: ${why}`)
    }
    if (JARGON_RE.test(noComments)) {
      bad.push(`${norm}: jargon in UI copy`)
    }
  }
}

for (const dir of SCAN_DIRS) walk(dir)

if (bad.length) {
  console.error(bad.join('\n'))
  process.exit(1)
}
console.log('UI lint passed: 0 violations across UI directories (2D anatomy model preserved).')
