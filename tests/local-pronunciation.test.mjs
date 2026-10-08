import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

let loadLocalPronunciation
try {
  ;({ loadLocalPronunciation } = await import('../server/localPronunciation.mjs'))
} catch {}

test('loads an allowed local pronunciation clip', async () => {
  assert.equal(typeof loadLocalPronunciation, 'function', 'local pronunciation loader is not implemented')
  const root = await mkdtemp(join(tmpdir(), 'qwerty-local-audio-'))
  await mkdir(join(root, 'ieltsWang3'))
  await writeFile(join(root, 'ieltsWang3', '0000.mp3'), Buffer.from('test-audio'))

  const audio = await loadLocalPronunciation('ieltsWang3/0000.mp3', root)

  assert.equal(audio.provider, 'local')
  assert.equal(audio.contentType, 'audio/mpeg')
  assert.equal(audio.body.toString(), 'test-audio')
})

test('rejects a local pronunciation path outside the approved shape', async () => {
  assert.equal(typeof loadLocalPronunciation, 'function', 'local pronunciation loader is not implemented')
  await assert.rejects(() => loadLocalPronunciation('../secret.mp3', tmpdir()), /invalid-local-audio/)
})

test('loads original-quality clips under a new cache-safe filename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qwerty-local-audio-'))
  await mkdir(join(root, 'ieltsWang3'))
  await writeFile(join(root, 'ieltsWang3', '0000-original.mp3'), Buffer.from('original-audio'))

  const audio = await loadLocalPronunciation('ieltsWang3/0000-original.mp3', root)

  assert.equal(audio.provider, 'local')
  assert.equal(audio.body.toString(), 'original-audio')
})

test('allows the existing online chain to continue when a local clip is missing', async () => {
  assert.equal(typeof loadLocalPronunciation, 'function', 'local pronunciation loader is not implemented')
  const root = await mkdtemp(join(tmpdir(), 'qwerty-local-audio-'))

  assert.equal(await loadLocalPronunciation('ieltsWang3/9999.mp3', root), undefined)
})
