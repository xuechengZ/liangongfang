import { hashWord, loadPronunciation } from './online-pronunciation.mjs'

const localAudioPattern = /^ieltsWang(?:3|4|5|11)\/\d{4}(?:-original)?\.mp3$/
const appRoutes = new Set(['/', '/gallery', '/mobile', '/error-book', '/analysis', '/friend-links', '/dynamic-wordbook'])

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/audio' && request.method === 'GET') {
      const word = url.searchParams.get('word')?.trim()
      const localAudio = url.searchParams.get('localAudio')
      if (!word || (localAudio && !localAudioPattern.test(localAudio))) return new Response(null, { status: 400 })
      const startedAt = Date.now()
      if (localAudio) {
        const asset = await env.ASSETS.fetch(new Request(new URL(`/local-pronunciation/${localAudio}`, url)))
        if (asset.ok && asset.headers.get('content-type')?.startsWith('audio/')) {
          console.log(JSON.stringify({ event: 'source_success', provider: 'local', word: await hashWord(word),
            pronunciation: url.searchParams.get('pronunciation') || 'uk', elapsedMs: Date.now() - startedAt }))
          const headers = new Headers(asset.headers)
          headers.set('cache-control', 'private, max-age=3600')
          headers.set('x-pronunciation-provider', 'local')
          return new Response(asset.body, { headers })
        }
      }
      let timer
      try {
        const online = loadPronunciation(word, url.searchParams.get('pronunciation') || 'uk', 4000)
        ctx.waitUntil(online.catch(() => {}))
        const audio = url.searchParams.get('prefetch') === '1' ? await online : await Promise.race([
          online,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request-timeout')), 1000) }),
        ])
        return new Response(audio.body, { headers: {
          'content-type': audio.contentType,
          'cache-control': 'private, max-age=3600',
          'x-pronunciation-provider': audio.provider,
        } })
      } catch (error) {
        console.log(JSON.stringify({ event: error.message === 'request-timeout' ? 'online_deadline_exceeded' : 'all_sources_failed',
          word: await hashWord(word), pronunciation: url.searchParams.get('pronunciation') || 'uk',
          elapsedMs: Date.now() - startedAt, error: error.message }))
        return new Response(null, { status: 504 })
      } finally { clearTimeout(timer) }
    }
    if (url.pathname === '/events' && request.method === 'POST') {
      let event
      try {
        event = await request.json()
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid-event')
      } catch { return new Response(null, { status: 400 }) }
      const timestamp = new Date().toISOString()
      const body = JSON.stringify({ ...event, timestamp })
      console.log(body)
      try {
        await env.BUCKET.put(`pronunciation-events/${timestamp.slice(0, 10)}/${timestamp}-${crypto.randomUUID()}.json`, body, {
          httpMetadata: { contentType: 'application/json' },
        })
        return new Response(null, { status: 204 })
      } catch (error) {
        console.error('pronunciation-event-storage-unavailable', error.message)
        return new Response(null, { status: 503 })
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 404 })
    if (appRoutes.has(url.pathname.replace(/\/$/, '') || '/')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: request.method }))
    }
    return env.ASSETS.fetch(request)
  },
}
