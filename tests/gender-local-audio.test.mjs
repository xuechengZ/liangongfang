import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const words = JSON.parse(await readFile(new URL('../public/dicts/IELTS_WANG_3.json', import.meta.url), 'utf8'))

test('gender at index 425 falls back instead of playing the mismatched local clip', () => {
  const gender = words[425]
  assert.equal(gender.name, 'gender')
  assert.equal(Object.hasOwn(gender, 'localAudio'), false)
  assert.equal(words[424].name, 'gasoline')
  assert.equal(words[424].localAudio, undefined)
  assert.equal(words[426].name, 'germ')
  assert.equal(words[426].localAudio, 'ieltsWang3/0426-original.mp3')
})

test('the mismatched gender clip stays in the repo', async () => {
  await access(new URL('../public/local-pronunciation/ieltsWang3/0425-original.mp3', import.meta.url))
})
