import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const nodeMajor = Number(process.versions.node.split('.')[0] || 0)
const existingOpts = process.env.NODE_OPTIONS || ''
const nodeOpts =
  nodeMajor >= 22 && !existingOpts.includes('--no-experimental-webstorage')
    ? [existingOpts, '--no-experimental-webstorage'].filter(Boolean).join(' ')
    : existingOpts

const vitestBin = resolve('node_modules/vitest/vitest.mjs')
const extraArgs = process.argv.slice(2)

const res = spawnSync(
  process.execPath,
  [
    vitestBin,
    'run',
    '--dir',
    'tests',
    '--exclude',
    'AI-Nutrition-Platform-v2-19_11/**',
    ...extraArgs
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOpts
    }
  }
)

process.exit(res.status ?? 1)
