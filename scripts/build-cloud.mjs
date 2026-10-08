import { spawnSync } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'

const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base=/'], {
  stdio: 'inherit',
  env: { ...process.env, CI: 'false', VITE_PRONUNCIATION_ENDPOINT: '/audio', VITE_TELEMETRY_ENDPOINT: '/events' },
})
if (build.status !== 0) process.exit(build.status || 1)
await rm('dist', { recursive: true, force: true })
await mkdir('dist/server', { recursive: true })
await mkdir('dist/.openai', { recursive: true })
await cp('build', 'dist/client', { recursive: true })
await cp('cloud/worker.mjs', 'dist/server/index.js')
await cp('cloud/online-pronunciation.mjs', 'dist/server/online-pronunciation.mjs')
await cp('.openai/hosting.json', 'dist/.openai/hosting.json')
