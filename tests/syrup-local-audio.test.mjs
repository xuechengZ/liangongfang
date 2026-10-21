import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const words = JSON.parse(await readFile(new URL('../public/dicts/IELTS_WANG_3.json', import.meta.url), 'utf8'))

test('syrup at index 969 falls back instead of playing the mismatched local clip', () => {
  const syrup = words[969]
  assert.equal(syrup.name, 'syrup')
  assert.equal(syrup.usphone, 'ˈsɪrəp')
  assert.equal(syrup.ukphone, 'ˈsɪrəp')
  assert.equal(Object.hasOwn(syrup, 'localAudio'), false)
  assert.equal(Object.hasOwn(syrup, 'localAudioUncertain'), false)
  assert.equal(words[968].name, 'subject')
  assert.equal(words[968].localAudio, 'ieltsWang3/0968-original.mp3')
  assert.equal(words[970].name, 'subsidy')
  assert.equal(words[970].localAudio, 'ieltsWang3/0970-original.mp3')
})

test('the mismatched syrup clip stays in the repo', async () => {
  await access(new URL('../public/local-pronunciation/ieltsWang3/0969-original.mp3', import.meta.url))
})
