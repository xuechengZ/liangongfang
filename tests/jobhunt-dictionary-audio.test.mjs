import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

test('JobHunt_Must localAudio names real US and UK files and leaves misses unmarked', async () => {
  const words = JSON.parse(await readFile(new URL('../public/dicts/JobHunt_Must.json', import.meta.url), 'utf8'))
  assert.equal(words.length, 392)
  const directory = new URL('../public/local-pronunciation/JobHunt_Must/', import.meta.url)
  const files = new Set((await readdir(directory)).filter((name) => name.endsWith('.mp3')))
  const referenced = new Set()

  for (const [index, word] of words.entries()) {
    const id = String(index).padStart(4, '0')
    if (!word.localAudio) continue
    assert.equal(typeof word.localAudio, 'object', word.name)
    assert.equal(Array.isArray(word.localAudio), false, word.name)
    assert.equal(Object.hasOwn(word, 'localAudioUncertain'), false, word.name)
    const accents = Object.keys(word.localAudio)
    assert.ok(accents.length > 0 && accents.every((accent) => accent === 'us' || accent === 'uk'), word.name)
    for (const accent of accents) {
      const filename = `${id}-${accent}.mp3`
      assert.equal(word.localAudio[accent], `JobHunt_Must/${filename}`, word.name)
      referenced.add(filename)
      const body = await readFile(new URL(filename, directory))
      assert.ok(body.length >= 500, `${word.name} ${accent}`)
      const mp3 = (body[0] === 0x49 && body[1] === 0x44 && body[2] === 0x33) || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0)
      assert.equal(mp3, true, `${word.name} ${accent}`)
    }
  }

  assert.deepEqual([...files].sort(), [...referenced].sort())
  assert.ok(referenced.size > 0)
})
