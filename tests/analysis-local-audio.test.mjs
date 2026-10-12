import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const words = JSON.parse(await readFile(new URL('../public/dicts/IELTS_WANG_3.json', import.meta.url), 'utf8'))
const clipPath = 'ieltsWang3/0028-original.mp3'
const goodSha = '62e37b8a74ec4585e0cb836639379b4606aa9bc51a32b8309f68166d026b3268'
const badSha = 'ed439735a8579dad6f661657c4d125ad3f314ed523ac85e558dad0ca011f1eba'

test('analysis plays the local-synced clip, not the mis-cut blob', async () => {
  const analysis = words.find((word) => word.name === 'analysis')
  assert.ok(analysis, 'analysis entry missing')
  assert.equal(analysis.localAudio, clipPath)
  assert.equal(analysis.localAudioUncertain, undefined)
  assert.deepEqual(
    words.filter((word) => word.localAudio === clipPath).map((word) => word.name),
    ['analysis'],
  )

  const clip = await readFile(new URL(`../public/local-pronunciation/${clipPath}`, import.meta.url))
  assert.equal(clip.length, 19321)
  const sha = createHash('sha256').update(clip).digest('hex')
  assert.equal(sha, goodSha)
  assert.notEqual(sha, badSha)

  const amount = words[27]
  const analyst = words[29]
  assert.equal(amount.name, 'amount')
  assert.equal(amount.localAudio, 'ieltsWang3/0027-original.mp3')
  assert.equal(analyst.name, 'analyst')
  assert.equal(analyst.localAudio, 'ieltsWang3/0029-original.mp3')
})
