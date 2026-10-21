import { localAudioQuery } from '../src/features/pronunciation/local-audio-query.mjs'
import {
  DEFAULT_WANG_PRONUNCIATION_SOURCE,
  WANG_PRONUNCIATION_DICT_IDS,
  WANG_PRONUNCIATION_SOURCE_OPTIONS,
  WANG_PRONUNCIATION_SOURCE_STORAGE_KEY,
  isWangPronunciationDict,
  resolvePlaybackLocalAudio,
} from '../src/features/pronunciation/wang-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clip = 'ieltsWang3/0968-original.mp3'

test('only the four Wang books can switch pronunciation source', () => {
  assert.deepEqual([...WANG_PRONUNCIATION_DICT_IDS], ['ieltsWang3', 'ieltsWang4', 'ieltsWang5', 'ieltsWang11'])
  for (const id of WANG_PRONUNCIATION_DICT_IDS) {
    assert.equal(isWangPronunciationDict(id), true)
  }
  assert.equal(isWangPronunciationDict('ielts'), false)
  assert.equal(isWangPronunciationDict('cet4'), false)
  assert.equal(isWangPronunciationDict('ieltsWang'), false)
  assert.equal(isWangPronunciationDict('heqiong'), false)
  assert.equal(isWangPronunciationDict('DuckCircle_IELTS'), false)
})

test('the switch labels are the two approved Chinese preferences', () => {
  assert.deepEqual(WANG_PRONUNCIATION_SOURCE_OPTIONS, [
    { value: 'wang', label: '优先王陆语料发音' },
    { value: 'youdao', label: '优先有道词典发音' },
  ])
  assert.equal(DEFAULT_WANG_PRONUNCIATION_SOURCE, 'wang')
  assert.equal(WANG_PRONUNCIATION_SOURCE_STORAGE_KEY, 'wangPronunciationSource')
})

test('Wang preference keeps localAudio and Youdao preference drops it only on those books', () => {
  for (const id of ['ieltsWang3', 'ieltsWang4', 'ieltsWang5', 'ieltsWang11']) {
    assert.equal(resolvePlaybackLocalAudio(clip, id, 'wang'), clip)
    assert.equal(resolvePlaybackLocalAudio(clip, id, 'youdao'), undefined)
    assert.equal(resolvePlaybackLocalAudio(undefined, id, 'wang'), undefined)
    assert.equal(resolvePlaybackLocalAudio(undefined, id, 'youdao'), undefined)
  }
  assert.equal(resolvePlaybackLocalAudio(clip, 'ieltsWang3'), clip)
  assert.equal(resolvePlaybackLocalAudio(clip, 'cet4', 'youdao'), clip)
  assert.equal(resolvePlaybackLocalAudio(clip, 'ielts', 'youdao'), clip)
  assert.equal(resolvePlaybackLocalAudio(clip, 'cet4', 'wang'), clip)
  assert.equal(resolvePlaybackLocalAudio('', 'ieltsWang3', 'wang'), '')
})

test('Youdao preference omits localAudio from the request on Wang books', () => {
  assert.equal(localAudioQuery(resolvePlaybackLocalAudio(clip, 'ieltsWang3', 'youdao')), '')
  assert.equal(localAudioQuery(resolvePlaybackLocalAudio(clip, 'ieltsWang3', 'wang')), '&localAudio=ieltsWang3%2F0968-original.mp3')
  assert.equal(localAudioQuery(resolvePlaybackLocalAudio(clip, 'cet4', 'youdao')), '&localAudio=ieltsWang3%2F0968-original.mp3')
})

test('play and prefetch both resolve localAudio before building the request', async () => {
  const player = stripComments(await readFile(new URL('../src/features/pronunciation/usePronunciation.ts', import.meta.url), 'utf8'))
  assert.equal(player.includes('resolvePlaybackLocalAudio(localAudio, dictId, source)'), true)
  const playCalls = player.match(/playWordPronunciation\(\{ name: word, localAudio: playbackLocalAudio \}, pronunciationConfig\.type\)/g)
  assert.equal(playCalls?.length, 2)
  assert.equal(player.includes('pronunciationConfig.type'), true)
})

test('the request builder itself does not know about the Wang preference', async () => {
  const source = stripComments(await readFile(new URL('../src/features/pronunciation/sound-src.ts', import.meta.url), 'utf8'))
  assert.equal(source.includes('wang-source'), false)
  assert.equal(source.includes('youdao'), false)
  assert.equal(source.includes('${localAudioQuery(localAudio)}'), true)
})

test('the switch is gated to Wang books and stores the preference beside pronunciation', async () => {
  const ui = stripComments(
    await readFile(new URL('../src/features/pronunciation/PronunciationSwitcher/index.tsx', import.meta.url), 'utf8'),
  )
  const atom = stripComments(await readFile(new URL('../src/features/pronunciation/wang-source-atom.ts', import.meta.url), 'utf8'))
  assert.equal(ui.includes('isWangPronunciationDict(currentDictInfo.id)'), true)
  assert.equal(ui.includes('WANG_PRONUNCIATION_SOURCE_OPTIONS'), true)
  assert.equal(ui.includes('wangPronunciationSourceAtom'), true)
  assert.equal(ui.includes('pronunciationConfig.type'), true)
  assert.equal(atom.includes('atomWithStorage'), true)
  assert.equal(atom.includes('WANG_PRONUNCIATION_SOURCE_STORAGE_KEY'), true)
  assert.equal(atom.includes('DEFAULT_WANG_PRONUNCIATION_SOURCE'), true)
})

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
