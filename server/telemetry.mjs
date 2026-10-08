import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadLocalPronunciation } from './localPronunciation.mjs'

const port = Number(process.env.TELEMETRY_PORT || 8787)
const dataDir = join(process.cwd(), '.data')
const logFile = join(dataDir, 'pronunciation-events.jsonl')
const localAudioDir = join(dataDir, 'local-pronunciation')
const audioCache = new Map()
const audioRequests = new Map()
const providerHealth = new Map()
const maxCacheEntries = 200

await mkdir(dataDir, { recursive: true })

function hashWord(word) {
  return createHash('sha256').update(word).digest('hex')
}

async function logEvent(event) {
  await appendFile(logFile, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`)
}

function recordProviderSuccess(provider) {
  providerHealth.delete(provider)
}

function recordProviderFailure(provider) {
  const now = Date.now()
  const health = providerHealth.get(provider)
  const failures = health && now - health.firstFailureAt < 60_000 ? health.failures + 1 : 1
  providerHealth.set(provider, {
    failures,
    firstFailureAt: failures === 1 ? now : health.firstFailureAt,
    blockedUntil: failures >= 3 ? now + 120_000 : 0,
  })
}

function isProviderAvailable(provider) {
  const health = providerHealth.get(provider)
  return !health?.blockedUntil || health.blockedUntil <= Date.now()
}

async function fetchAudio(url, signal) {
  const response = await fetch(url, { signal, headers: { 'user-agent': 'Qwerty-Learner-Local/1.0' } })
  if (!response.ok) throw new Error(`http-${response.status}`)

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') throw new Error('not-audio')

  const body = Buffer.from(await response.arrayBuffer())
  if (body.length < 500) throw new Error('audio-too-small')
  return { body, contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg' }
}

function youdaoUrl(word, pronunciation) {
  const audio = encodeURIComponent(word)
  if (pronunciation === 'uk') return `https://dict.youdao.com/dictvoice?audio=${audio}&type=1`
  if (pronunciation === 'us') return `https://dict.youdao.com/dictvoice?audio=${audio}&type=2`
  if (pronunciation === 'ja' || pronunciation === 'romaji') return `https://dict.youdao.com/dictvoice?audio=${audio}&le=jap`
  if (pronunciation === 'zh') return `https://dict.youdao.com/dictvoice?audio=${audio}&le=zh`
  if (pronunciation === 'de') return `https://dict.youdao.com/dictvoice?audio=${audio}&le=de`
  if (pronunciation === 'id') return `https://dict.youdao.com/dictvoice?audio=${audio}&le=id`
  return `https://dict.youdao.com/dictvoice?audio=${audio}&le=ru`
}

async function requestYoudao(word, pronunciation, signal) {
  return fetchAudio(`${youdaoUrl(word, pronunciation)}&cacheBust=${Date.now()}`, signal)
}

async function requestDictionary(word, pronunciation, signal) {
  if (pronunciation !== 'uk' && pronunciation !== 'us') throw new Error('unsupported-language')

  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal })
  if (response.status === 404) throw new Error('word-not-found')
  if (!response.ok) throw new Error(`http-${response.status}`)

  const entries = await response.json()
  const audioUrls = entries.flatMap((entry) => entry.phonetics || []).map((phonetic) => phonetic.audio).filter(Boolean)
  const accentPattern = pronunciation === 'uk' ? /(?:_gb_|-uk(?:[-./]|$)|\/uk\/)/i : /(?:_us_|-us(?:[-./]|$)|\/us\/)/i
  const audioUrl = audioUrls.find((url) => accentPattern.test(url))
  if (!audioUrl) throw new Error('accent-not-found')

  return fetchAudio(audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl, signal)
}

async function requestProvider(provider, word, pronunciation, signal) {
  if (!isProviderAvailable(provider)) throw new Error('provider-circuit-open')
  const startedAt = Date.now()

  try {
    const audio = provider === 'youdao' ? await requestYoudao(word, pronunciation, signal) : await requestDictionary(word, pronunciation, signal)
    recordProviderSuccess(provider)
    void logEvent({ event: 'source_success', provider, word: hashWord(word), pronunciation, elapsedMs: Date.now() - startedAt })
    return { ...audio, provider }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown-error'
    const wasAborted = error instanceof Error && error.name === 'AbortError'
    if (!wasAborted && reason !== 'word-not-found' && reason !== 'accent-not-found' && reason !== 'unsupported-language' && reason !== 'provider-circuit-open') {
      recordProviderFailure(provider)
    }
    void logEvent({ event: wasAborted ? 'source_cancelled' : 'source_failure', provider, word: hashWord(word), pronunciation, elapsedMs: Date.now() - startedAt, error: reason })
    throw error
  }
}

async function loadPronunciation(word, pronunciation, timeoutMs) {
  const key = `${pronunciation}:${word.toLocaleLowerCase()}`
  const cached = audioCache.get(key)
  if (cached) {
    audioCache.delete(key)
    audioCache.set(key, cached)
    void logEvent({ event: 'source_cache_hit', provider: cached.provider, word: hashWord(word), pronunciation, elapsedMs: 0 })
    return cached
  }

  let request = audioRequests.get(key)
  if (!request) {
    request = createPronunciationRequest(key, word, pronunciation)
    audioRequests.set(key, request)
  }

  if (timeoutMs >= 4_000) return request
  return Promise.race([
    request,
    new Promise((_, reject) => setTimeout(() => reject(new Error('request-timeout')), timeoutMs)),
  ])
}

async function createPronunciationRequest(key, word, pronunciation) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4_000)
  const youdao = requestProvider('youdao', word, pronunciation, controller.signal)
  const dictionary = new Promise((resolve, reject) => {
    const start = () => requestProvider('dictionary', word, pronunciation, controller.signal).then(resolve, reject)
    const delay = setTimeout(start, 350)
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(delay)
        reject(new Error('request-timeout'))
      },
      { once: true },
    )
  })

  try {
    const result = await Promise.any([youdao, dictionary])
    audioCache.set(key, result)
    if (audioCache.size > maxCacheEntries) audioCache.delete(audioCache.keys().next().value)
    controller.abort()
    return result
  } finally {
    clearTimeout(timer)
    audioRequests.delete(key)
  }
}

function sendAudio(response, audio) {
  response.setHeader('content-type', audio.contentType)
  response.setHeader('content-length', audio.body.length)
  response.setHeader('cache-control', 'private, max-age=3600')
  response.setHeader('x-pronunciation-provider', audio.provider)
  response.writeHead(200).end(audio.body)
}

createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('access-control-expose-headers', 'x-pronunciation-provider')

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === '/audio') {
    const word = url.searchParams.get('word')?.trim()
    const pronunciation = url.searchParams.get('pronunciation') || 'uk'
    if (!word) {
      response.writeHead(400).end()
      return
    }

    const startedAt = Date.now()
    try {
      const localAudio = url.searchParams.get('localAudio')
      if (localAudio) {
        const audio = await loadLocalPronunciation(localAudio, localAudioDir)
        if (audio) {
          void logEvent({ event: 'source_success', provider: 'local', word: hashWord(word), pronunciation, elapsedMs: Date.now() - startedAt })
          sendAudio(response, audio)
          return
        }
      }
      const timeoutMs = url.searchParams.get('prefetch') === '1' ? 4_000 : 1_000
      const audio = await loadPronunciation(word, pronunciation, timeoutMs)
      sendAudio(response, audio)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown-error'
      void logEvent({
        event: reason === 'request-timeout' ? 'online_deadline_exceeded' : 'all_sources_failed',
        word: hashWord(word),
        pronunciation,
        elapsedMs: Date.now() - startedAt,
        error: reason,
      })
      response.writeHead(504).end()
    }
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/events') {
    response.writeHead(404).end()
    return
  }

  let body = ''
  for await (const chunk of request) body += chunk

  try {
    const event = JSON.parse(body)
    await logEvent(event)
    response.writeHead(204).end()
  } catch {
    response.writeHead(400).end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Pronunciation service listening on http://127.0.0.1:${port}`)
})
