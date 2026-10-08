import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import worker from '../cloud/worker.mjs'

const pending = []
const ctx = { waitUntil(promise) { pending.push(promise) } }
const saved = new Map()
const env = {
  BUCKET: { async put(key, body) { saved.set(key, body) } },
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname
      try {
        const body = await readFile(new URL(`../public${path}`, import.meta.url))
        return new Response(body, { headers: { 'content-type': path.endsWith('.mp3') ? 'audio/mpeg' : 'application/json' } })
      } catch {
        if (path === '/index.html') return new Response('<html>Qwerty</html>', { headers: { 'content-type': 'text/html' } })
        return new Response(null, { status: 404 })
      }
    },
  },
}
const request = (path, options) => new Request(`https://test.local${path}`, options)

test('cloud playback returns exact original MP3 bytes and local provider', async () => {
  const response = await worker.fetch(request('/audio?word=ability&localAudio=ieltsWang3%2F0000-original.mp3'), env, ctx)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-pronunciation-provider'), 'local')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL('../public/local-pronunciation/ieltsWang3/0000-original.mp3', import.meta.url)))
})

test('invalid local paths are rejected without exposing other assets', async () => {
  assert.equal((await worker.fetch(request('/audio?word=ability&localAudio=..%2F..%2Findex.html'), env, ctx)).status, 400)
  assert.equal((await worker.fetch(request('/audio'), env, ctx)).status, 400)
})

test('missing original clip uses online source and repeat uses cached audio', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(new Uint8Array(700).fill(7), { headers: { 'content-type': 'audio/mpeg' } }) }
  try {
    const path = '/audio?word=cloud-test-cache&localAudio=ieltsWang3%2F9999-original.mp3'
    const first = await worker.fetch(request(path), env, ctx)
    const second = await worker.fetch(request(path), env, ctx)
    assert.equal(first.status, 200)
    assert.equal(second.headers.get('x-pronunciation-provider'), 'youdao')
    assert.equal((await second.arrayBuffer()).byteLength, 700)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})

test('dictionary UK audio wins when Youdao fails; both failures return timeout', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url.includes('dict.youdao.com')) return new Response(null, { status: 503 })
    if (url.includes('dictionaryapi.dev')) return Response.json([{ phonetics: [{ audio: 'https://audio.test/example-uk.mp3' }] }])
    return new Response(new Uint8Array(700).fill(9), { headers: { 'content-type': 'audio/mpeg' } })
  }
  try {
    const result = await worker.fetch(request('/audio?word=cloud-test-fallback'), env, ctx)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('x-pronunciation-provider'), 'dictionary')
    globalThis.fetch = async () => new Response(null, { status: 503 })
    assert.equal((await worker.fetch(request('/audio?word=cloud-test-failure'), env, ctx)).status, 504)
  } finally { globalThis.fetch = original }
})

test('playback diagnostics persist in cloud storage, malformed events do not', async () => {
  saved.clear()
  const event = { event: 'playback_no_progress', word: 'hashed-word', elapsedMs: 500 }
  const response = await worker.fetch(request('/events', { method: 'POST', body: JSON.stringify(event) }), env, ctx)
  assert.equal(response.status, 204)
  assert.equal(saved.size, 1)
  const body = JSON.parse([...saved.values()][0])
  assert.equal(body.event, 'playback_no_progress')
  assert.equal(body.elapsedMs, 500)
  assert.ok(body.timestamp)
  assert.equal((await worker.fetch(request('/events', { method: 'POST', body: 'not-json' }), env, ctx)).status, 400)
})

test('SPA routes render the app but missing MP3s and API paths remain 404', async () => {
  const response = await worker.fetch(request('/dynamic-wordbook'), env, ctx)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Qwerty/)
  for (const path of ['/local-pronunciation/missing.mp3', '/dicts/missing.json', '/api/unknown']) {
    assert.equal((await worker.fetch(request(path), env, ctx)).status, 404)
  }
  await Promise.all(pending)
})

test('foreground deadline retains late audio for the next request', async () => {
  const original = globalThis.fetch
  const originalLog = console.log
  const logs = []
  console.log = line => logs.push(JSON.parse(line))
  let calls = 0
  globalThis.fetch = async (url) => {
    if (url.includes('dictionaryapi.dev')) return new Response(null, { status: 404 })
    calls++
    await new Promise(resolve => setTimeout(resolve, 1500))
    return new Response(new Uint8Array(700).fill(4), { headers: { 'content-type': 'audio/mpeg' } })
  }
  try {
    const response = await worker.fetch(request('/audio?word=cloud-test-late'), env, ctx)
    assert.equal(response.status, 504)
    assert.ok(logs.some(event => event.event === 'online_deadline_exceeded' && event.elapsedMs >= 900 && event.word))
    await Promise.all(pending)
    const retry = await worker.fetch(request('/audio?word=cloud-test-late'), env, ctx)
    assert.equal(retry.status, 200)
    assert.equal(retry.headers.get('x-pronunciation-provider'), 'youdao')
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original; console.log = originalLog }
})

test('storage failure is visible to diagnostics caller rather than falsely accepted', async () => {
  const response = await worker.fetch(request('/events', { method: 'POST', body: '{"event":"played"}' }), {
    ...env, BUCKET: { async put() { throw new Error('unavailable') } },
  }, ctx)
  assert.equal(response.status, 503)
})
