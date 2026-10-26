import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { handleCloudRequest } from '../cloud/vercel-adapter.mjs'

const audioRequest = (path) => new Request(`https://example.test${path}`)

test('local pronunciation is served from the repository files', async () => {
  const response = await handleCloudRequest(
    audioRequest('/api/audio?word=ability&localAudio=ieltsWang3%2F0000-original.mp3'),
    '/audio',
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-pronunciation-provider'), 'local')
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    await readFile(new URL('../public/local-pronunciation/ieltsWang3/0000-original.mp3', import.meta.url)),
  )
})

test('invalid local audio paths are rejected', async () => {
  const response = await handleCloudRequest(audioRequest('/api/audio?word=ability&localAudio=..%2Findex.html'), '/audio')
  assert.equal(response.status, 400)
  assert.equal((await handleCloudRequest(audioRequest('/api/audio?word=product&localAudio=JobHunt_Must%2F0000.mp3'), '/audio')).status, 400)
})

test('JobHunt_Must accent audio is served from the repository files', async () => {
  const response = await handleCloudRequest(
    audioRequest('/api/audio?word=product&pronunciation=uk&localAudio=JobHunt_Must%2F0000-uk.mp3'),
    '/audio',
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-pronunciation-provider'), 'local')
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    await readFile(new URL('../public/local-pronunciation/JobHunt_Must/0000-uk.mp3', import.meta.url)),
  )
})

test('missing local clips fall through to the online pronunciation race', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(new Uint8Array(700).fill(3), { headers: { 'content-type': 'audio/mpeg' } })
  try {
    const response = await handleCloudRequest(
      audioRequest('/api/audio?word=adapter-online-word'),
      '/audio',
      null,
      { fetchImpl: async () => new Response(null, { status: 404 }) },
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-pronunciation-provider'), 'youdao')
    assert.equal((await response.arrayBuffer()).byteLength, 700)
  } finally {
    globalThis.fetch = original
  }
})

test('pronunciation events are accepted without object storage and rejected when malformed', async () => {
  const saved = []
  const ok = await handleCloudRequest(
    new Request('https://example.test/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'played', elapsedMs: 12 }),
    }),
    '/events',
    null,
    { bucket: { async put(key, body) { saved.push([key, body]) } } },
  )
  assert.equal(ok.status, 204)
  assert.equal(saved.length, 1)
  assert.match(saved[0][0], /^pronunciation-events\//)
  assert.equal(JSON.parse(saved[0][1]).event, 'played')

  const malformed = await handleCloudRequest(
    new Request('https://example.test/api/events', { method: 'POST', body: 'not-json' }),
    '/events',
  )
  assert.equal(malformed.status, 400)
})

test('storage failures stay visible', async () => {
  const response = await handleCloudRequest(
    new Request('https://example.test/api/events', {
      method: 'POST',
      body: JSON.stringify({ event: 'played' }),
    }),
    '/events',
    null,
    { bucket: { async put() { throw new Error('unavailable') } } },
  )
  assert.equal(response.status, 503)
})

test('vercel.json publishes the cloud build from Hong Kong and keeps SPA routes', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(config.buildCommand, 'npm run build')
  assert.equal(config.outputDirectory, 'build')
  assert.deepEqual(config.regions, ['hkg1'])
  assert.deepEqual(config.rewrites.slice(0, 2), [
    { source: '/audio', destination: '/api/audio' },
    { source: '/events', destination: '/api/events' },
  ])
  assert.equal(config.rewrites.at(-1).destination, '/index.html')
})
