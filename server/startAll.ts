import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'
const npmCmd = isWin ? 'npm.cmd' : 'npm'

const gw = spawn(npmCmd, ['run', 'server'], { stdio: 'inherit', shell: isWin })
const ui = spawn(npmCmd, ['run', 'dev'], { stdio: 'inherit', shell: isWin })

function shutdown() {
  try { gw.kill() } catch {}
  try { ui.kill() } catch {}
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
gw.on('exit', code => {
  if (code && code !== 0) {
    console.error(`[startAll] Gateway exited with code ${code}`)
  }
})
ui.on('exit', code => {
  shutdown()
})
