import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const dictPath = 'public/dicts/JobHunt_Must.json'
const root = 'public/local-pronunciation/JobHunt_Must'
const accents = ['us', 'uk']
const concurrency = 5

function youdaoUrl(word, accent) {
  const type = accent === 'uk' ? 1 : 2
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`
}

function isMp3(body, contentType) {
  if (contentType && !contentType.startsWith('audio/')) return false
  if (body.length < 500) return false
  if (body[0] === 0x49 && body[1] === 0x44 && body[2] === 0x33) return true
  return body[0] === 0xff && (body[1] & 0xe0) === 0xe0
}

function isWav(body, contentType) {
  if (contentType && !contentType.startsWith('audio/')) return false
  return body.length > 44 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WAVE'
}

async function wavToMp3(body) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobhunt-wav-'))
  const input = path.join(directory, 'in.wav')
  const output = path.join(directory, 'out.mp3')
  try {
    await writeFile(input, body)
    await execFileAsync('ffmpeg', ['-y', '-i', input, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', output], { timeout: 20000 })
    const mp3 = await readFile(output)
    if (!isMp3(mp3, 'audio/mpeg')) throw new Error('transcode-not-mp3')
    return mp3
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function fetchAccent(word, accent) {
  let last = { ok: false, reason: 'not-tried' }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(youdaoUrl(word, accent), {
        headers: { 'user-agent': 'Qwerty-Learner-Local/1.0', accept: 'audio/mpeg,*/*' },
        signal: AbortSignal.timeout(15000),
      })
      const contentType = response.headers.get('content-type') || ''
      const body = Buffer.from(await response.arrayBuffer())
      if (response.ok && isMp3(body, contentType)) return { ok: true, body }
      if (response.ok && isWav(body, contentType)) return { ok: true, body: await wavToMp3(body), transcoded: true }
      const text = body.toString('utf8')
      if (text.includes('returned null audio')) return { ok: false, reason: 'no-audio', status: response.status }
      last = { ok: false, reason: response.ok ? 'not-audio' : `http-${response.status}`, status: response.status }
      if (response.status !== 429 && response.status < 500) return last
    } catch (error) {
      last = { ok: false, reason: error instanceof Error ? error.name : 'network-error' }
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
  }
  return last
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

const words = JSON.parse(await readFile(dictPath, 'utf8'))
await mkdir(root, { recursive: true })
const jobs = []
for (const [index, word] of words.entries()) {
  for (const accent of accents) jobs.push({ index, name: word.name, accent })
}

let finished = 0
const fetched = await mapPool(jobs, concurrency, async (job) => {
  const id = String(job.index).padStart(4, '0')
  const filename = `${id}-${job.accent}.mp3`
  const target = path.join(root, filename)
  try {
    const existing = await readFile(target)
    if (isMp3(existing, 'audio/mpeg')) {
      finished += 1
      return { ...job, ok: true, cached: true, bytes: existing.length }
    }
  } catch {}
  const result = await fetchAccent(job.name, job.accent)
  if (result.ok) {
    const temporary = `${target}.partial`
    await writeFile(temporary, result.body)
    await rename(temporary, target)
  }
  finished += 1
  if (finished % 40 === 0 || finished === jobs.length) {
    console.log(`fetched ${finished}/${jobs.length}`)
  }
  return { ...job, ...result, bytes: result.body?.length || 0 }
})

const byIndex = new Map()
for (const item of fetched) {
  const row = byIndex.get(item.index) || {}
  row[item.accent] = item
  byIndex.set(item.index, row)
}

const failed = []
const nextWords = words.map((word, index) => {
  const id = String(index).padStart(4, '0')
  const hits = byIndex.get(index) || {}
  const localAudio = {}
  for (const accent of accents) {
    if (hits[accent]?.ok) localAudio[accent] = `JobHunt_Must/${id}-${accent}.mp3`
    else failed.push({ index, name: word.name, accent, reason: hits[accent]?.reason || 'missing', status: hits[accent]?.status })
  }
  const next = {}
  for (const [key, value] of Object.entries(word)) {
    if (key === 'localAudio') continue
    next[key] = value
    if (key === 'name' && Object.keys(localAudio).length) next.localAudio = localAudio
  }
  return next
})

await writeFile(dictPath, `${JSON.stringify(nextWords, null, 2)}\n`)
const files = fetched.filter((item) => item.ok)
const bytes = files.reduce((sum, item) => sum + item.bytes, 0)
const summary = {
  words: words.length,
  files: files.length,
  bytes,
  failed: failed.length,
  failures: failed,
}
await writeFile('/tmp/jobhunt-youdao-report.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ words: summary.words, files: summary.files, bytes: summary.bytes, failed: summary.failed }))
