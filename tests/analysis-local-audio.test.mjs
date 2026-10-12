import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const words = JSON.parse(await readFile(new URL('../public/dicts/IELTS_WANG_3.json', import.meta.url), 'utf8'))
const badClip = 'ieltsWang3/0028-original.mp3'

test('analysis falls back to online audio instead of the mis-cut local clip', () => {
  const analysis = words.find((word) => word.name === 'analysis')
  assert.ok(analysis, 'analysis entry missing')
  assert.equal(analysis.localAudio, undefined)
  assert.equal(analysis.localAudioUncertain, undefined)
  assert.deepEqual(
    words.filter((word) => word.localAudio === badClip).map((word) => word.name),
    [],
  )

  const amount = words[27]
  const analyst = words[29]
  assert.equal(amount.name, 'amount')
  assert.equal(amount.localAudio, 'ieltsWang3/0027-original.mp3')
  assert.equal(analyst.name, 'analyst')
  assert.equal(analyst.localAudio, 'ieltsWang3/0029-original.mp3')
})
