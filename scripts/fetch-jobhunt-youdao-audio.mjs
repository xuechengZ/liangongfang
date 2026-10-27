import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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

// Try the whole string first. If Youdao has no clip, split on the coarsest
// separator that still leaves a multi-part phrase: spaces, then slashes, then
// hyphens. That keeps a known compound such as "cross-functional" intact
// inside "cross-functional delivery", and only then breaks "referral-led".
export function coarsestPieces(phrase) {
  const text = phrase.trim()
  const spaced = text.split(/\s+/).filter(Boolean)
  if (spaced.length > 1) return spaced
  const slashed = text.split(/[/／]+/).filter(Boolean)
  if (slashed.length > 1) return slashed
  const hyphened = text.split(/[-‐‑–—]+/).filter(Boolean)
  if (hyphened.length > 1) return hyphened
  return null
}

export async function resolvePhraseAudio(phrase, accent, fetchToken) {
  const direct = await fetchToken(phrase, accent)
  if (direct.ok) return { ok: true, bodies: [direct.body], tokens: [phrase], concatenated: false }
  const pieces = coarsestPieces(phrase)
  if (!pieces) return { ok: false, reason: direct.reason || 'no-audio', status: direct.status, failedToken: phrase }
  const bodies = []
  const tokens = []
  for (const piece of pieces) {
    const child = await resolvePhraseAudio(piece, accent, fetchToken)
    if (!child.ok) return { ok: false, reason: 'token-failed', status: child.status, failedToken: child.failedToken || piece }
    bodies.push(...child.bodies)
    tokens.push(...child.tokens)
  }
  return { ok: true, bodies, tokens, concatenated: true }
}

// Youdao clips mix 24/44.1/48 kHz and mono/stereo, and each token keeps a long
// dictionary lead-in and tail. Decode, trim only those outer silences — the
// tail trim is done after areverse so an internal pause is not treated as the
// end — then concat and re-encode with the same libmp3lame 96k mono settings
// used for WAV-mislabeled clips.
const tokenTrim =
  'aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.08,areverse'

export async function concatMp3s(parts) {
  if (parts.length === 1) return parts[0]
  const directory = await mkdtemp(path.join(tmpdir(), 'jobhunt-concat-'))
  try {
    const args = ['-y', '-hide_banner', '-loglevel', 'error']
    const filters = []
    const labels = []
    for (let index = 0; index < parts.length; index += 1) {
      const file = path.join(directory, `${index}.mp3`)
      await writeFile(file, parts[index])
      args.push('-i', file)
      filters.push(`[${index}:a]${tokenTrim}[a${index}]`)
      labels.push(`[a${index}]`)
    }
    const output = path.join(directory, 'out.mp3')
    args.push(
      '-filter_complex',
      `${filters.join(';')};${labels.join('')}concat=n=${parts.length}:v=0:a=1[out]`,
      '-map',
      '[out]',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '24000',
      output,
    )
    await execFileAsync('ffmpeg', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
    const mp3 = await readFile(output)
    if (!isMp3(mp3, 'audio/mpeg')) throw new Error('concat-not-mp3')
    return mp3
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

async function main() {
  const words = JSON.parse(await readFile(dictPath, 'utf8'))
  await mkdir(root, { recursive: true })
  const jobs = []
  for (const [index, word] of words.entries()) {
    for (const accent of accents) jobs.push({ index, name: word.name, accent })
  }

  const audioCache = new Map()
  function cachedFetch(word, accent) {
    const key = `${accent}\0${word}`
    let pending = audioCache.get(key)
    if (!pending) {
      pending = fetchAccent(word, accent)
      audioCache.set(key, pending)
    }
    return pending
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
    const resolved = await resolvePhraseAudio(job.name, job.accent, cachedFetch)
    if (!resolved.ok) {
      finished += 1
      console.log(`miss ${id} ${job.accent} ${job.name} token=${resolved.failedToken || job.name} ${resolved.reason || 'missing'}`)
      if (finished % 40 === 0 || finished === jobs.length) console.log(`fetched ${finished}/${jobs.length}`)
      return { ...job, ...resolved, bytes: 0 }
    }
    try {
      const body = resolved.concatenated ? await concatMp3s(resolved.bodies) : resolved.bodies[0]
      const temporary = `${target}.partial`
      await writeFile(temporary, body)
      await rename(temporary, target)
      finished += 1
      if (resolved.concatenated) console.log(`concat ${id} ${job.accent} ${job.name} <= ${resolved.tokens.join(' + ')}`)
      else console.log(`whole ${id} ${job.accent} ${job.name}`)
      if (finished % 40 === 0 || finished === jobs.length) console.log(`fetched ${finished}/${jobs.length}`)
      return { ...job, ok: true, bytes: body.length, tokens: resolved.tokens, concatenated: resolved.concatenated }
    } catch (error) {
      finished += 1
      console.log(`miss ${id} ${job.accent} ${job.name} concat-failed`)
      return {
        ...job,
        ok: false,
        reason: 'concat-failed',
        failedToken: job.name,
        detail: error instanceof Error ? error.message : 'concat-failed',
        bytes: 0,
      }
    }
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
      else
        failed.push({
          index,
          name: word.name,
          accent,
          reason: hits[accent]?.reason || 'missing',
          status: hits[accent]?.status,
          failedToken: hits[accent]?.failedToken,
        })
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
  const gained = { both: [], usOnly: [], ukOnly: [] }
  const concatenated = []
  const stillMissing = []
  for (const [index, word] of words.entries()) {
    const before = word.localAudio || {}
    const after = nextWords[index].localAudio || {}
    const hits = byIndex.get(index) || {}
    const gainedUs = !before.us && Boolean(after.us)
    const gainedUk = !before.uk && Boolean(after.uk)
    if (gainedUs && gainedUk) gained.both.push(word.name)
    else if (gainedUs) gained.usOnly.push(word.name)
    else if (gainedUk) gained.ukOnly.push(word.name)
    for (const accent of accents) {
      if (hits[accent]?.concatenated) concatenated.push({ name: word.name, accent, tokens: hits[accent].tokens })
    }
    if (!after.us || !after.uk) {
      stillMissing.push({
        index,
        name: word.name,
        missing: accents.filter((accent) => !after[accent]),
        failedToken: Object.fromEntries(accents.filter((accent) => !after[accent]).map((accent) => [accent, hits[accent]?.failedToken])),
      })
    }
  }
  const summary = {
    words: words.length,
    files: files.length,
    bytes,
    failed: failed.length,
    failures: failed,
    gained,
    concatenated,
    stillMissing,
  }
  await writeFile('/tmp/jobhunt-youdao-report.json', JSON.stringify(summary, null, 2))
  console.log(
    JSON.stringify({
      words: summary.words,
      files: summary.files,
      bytes: summary.bytes,
      failed: summary.failed,
      gained: {
        both: gained.both.length,
        usOnly: gained.usOnly.length,
        ukOnly: gained.ukOnly.length,
      },
      stillMissing: stillMissing.length,
    }),
  )
}

if (isDirectRun()) await main()
