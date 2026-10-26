import { clipForAccent, directStaticPronunciationSrc, isJobHuntStaticClip, staticClipFallbackSrc } from '../src/features/pronunciation/accent-local-audio.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const us = 'JobHunt_Must/0000-us.mp3'
const uk = 'JobHunt_Must/0000-uk.mp3'

test('JobHunt accent metadata points playback at a same-origin static file', () => {
  const localAudio = { us, uk }
  assert.equal(clipForAccent(localAudio, 'us'), us)
  assert.equal(clipForAccent(localAudio, 'uk'), uk)
  assert.equal(directStaticPronunciationSrc(localAudio, 'us'), `/local-pronunciation/${us}`)
  assert.equal(directStaticPronunciationSrc(localAudio, 'uk'), `/local-pronunciation/${uk}`)
})

test('a missing JobHunt accent does not invent a static file', () => {
  assert.equal(clipForAccent({ uk }, 'us'), undefined)
  assert.equal(directStaticPronunciationSrc({ uk }, 'us'), '')
  assert.equal(directStaticPronunciationSrc(undefined, 'uk'), '')
  assert.equal(directStaticPronunciationSrc({}, 'us'), '')
})

test('Wang clips stay on the audio API instead of a direct static path', () => {
  const clip = 'ieltsWang3/0000-original.mp3'
  assert.equal(clipForAccent(clip, 'us'), clip)
  assert.equal(clipForAccent(clip, 'uk'), clip)
  assert.equal(isJobHuntStaticClip(clip), false)
  assert.equal(directStaticPronunciationSrc(clip, 'us'), '')
  assert.equal(directStaticPronunciationSrc(clip, 'uk'), '')
})

test('JobHunt static names are accent files and reject traversal', () => {
  assert.equal(isJobHuntStaticClip('JobHunt_Must/0391-us.mp3'), true)
  assert.equal(isJobHuntStaticClip('JobHunt_Must/0391-uk.mp3'), true)
  for (const clip of [
    '../secret.mp3',
    'JobHunt_Must/0000.mp3',
    'JobHunt_Must/0000-original.mp3',
    'JobHunt_Must/0000-us.wav',
    'JobHunt_Must/../0000-us.mp3',
    'ieltsWang3/0000-us.mp3',
    'JobHunt_Must/00000-us.mp3',
  ]) {
    assert.equal(isJobHuntStaticClip(clip), false, clip)
    assert.equal(directStaticPronunciationSrc(clip, 'us'), '')
  }
})

test('a failed static clip falls back to the online pronunciation URL', () => {
  const online = 'http://127.0.0.1:8787/audio?word=product&pronunciation=us'
  assert.equal(staticClipFallbackSrc(`/local-pronunciation/${us}`, online), online)
  assert.equal(staticClipFallbackSrc(online, online), undefined)
  assert.equal(staticClipFallbackSrc(`/local-pronunciation/${us}`, `/local-pronunciation/${uk}`), undefined)
})

test('playback builds the static path before the shared audio query', async () => {
  const source = stripComments(await readFile(new URL('../src/features/pronunciation/sound-src.ts', import.meta.url), 'utf8'))
  const player = stripComments(await readFile(new URL('../src/features/pronunciation/usePronunciation.ts', import.meta.url), 'utf8'))
  assert.equal(source.includes('directStaticPronunciationSrc(entry.localAudio, accent)'), true)
  assert.equal(source.includes('generateWordSoundSrc(entry.name, accent, entry.localAudio)'), true)
  assert.equal(source.includes('${localAudioQuery(localAudio)}'), true)
  assert.equal(player.includes('staticClipFallbackSrc'), true)
  assert.equal(player.includes("startsWith('/local-pronunciation/')"), true)
})

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
