import { coarsestPieces, concatMp3s, resolvePhraseAudio } from '../scripts/fetch-jobhunt-youdao-audio.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const clip = Buffer.from([0xff, 0xfb, 0x90, 0x64])

test('splits on spaces before hyphens or slashes', () => {
  assert.deepEqual(coarsestPieces('cross-functional delivery'), ['cross-functional', 'delivery'])
  assert.deepEqual(coarsestPieces('flat-price meal pass'), ['flat-price', 'meal', 'pass'])
  assert.deepEqual(coarsestPieces('a/b testing'), ['a/b', 'testing'])
  assert.deepEqual(coarsestPieces('referral-led'), ['referral', 'led'])
  assert.deepEqual(coarsestPieces('0-to-1'), ['0', 'to', '1'])
  assert.deepEqual(coarsestPieces('a/b'), ['a', 'b'])
  assert.equal(coarsestPieces('passholder'), null)
  assert.equal(coarsestPieces('  touchpoint '), null)
})

test('keeps a whole phrase when Youdao already has it', async () => {
  const calls = []
  const result = await resolvePhraseAudio('order frequency', 'us', async (phrase) => {
    calls.push(phrase)
    return phrase === 'order frequency' ? { ok: true, body: clip } : { ok: false, reason: 'no-audio' }
  })
  assert.equal(result.ok, true)
  assert.equal(result.concatenated, false)
  assert.deepEqual(result.tokens, ['order frequency'])
  assert.deepEqual(calls, ['order frequency'])
})

test('keeps a known hyphenated compound and concatenates the remaining words', async () => {
  const calls = []
  const known = new Set(['cross-functional', 'delivery'])
  const result = await resolvePhraseAudio('cross-functional delivery', 'uk', async (phrase) => {
    calls.push(phrase)
    return known.has(phrase) ? { ok: true, body: clip } : { ok: false, reason: 'no-audio' }
  })
  assert.equal(result.ok, true)
  assert.equal(result.concatenated, true)
  assert.deepEqual(result.tokens, ['cross-functional', 'delivery'])
  assert.deepEqual(calls, ['cross-functional delivery', 'cross-functional', 'delivery'])
})

test('splits a failed slash token inside a phrase', async () => {
  const known = new Set(['a', 'b', 'testing'])
  const result = await resolvePhraseAudio('a/b testing', 'us', async (phrase) => {
    return known.has(phrase) ? { ok: true, body: clip } : { ok: false, reason: 'no-audio' }
  })
  assert.deepEqual(result.tokens, ['a', 'b', 'testing'])
  assert.equal(result.concatenated, true)
})

test('a missing token leaves the accent unresolved', async () => {
  const calls = []
  const result = await resolvePhraseAudio('bestseller group buy', 'us', async (phrase) => {
    calls.push(phrase)
    if (phrase === 'group' || phrase === 'buy') return { ok: true, body: clip }
    return { ok: false, reason: 'no-audio' }
  })
  assert.equal(result.ok, false)
  assert.equal(result.failedToken, 'bestseller')
  assert.equal(calls.includes('group'), false)
  assert.equal(calls.includes('buy'), false)
})

test('a single word with no separator stays unresolved when Youdao has no clip', async () => {
  const result = await resolvePhraseAudio('passholder', 'uk', async () => ({ ok: false, reason: 'no-audio', status: 500 }))
  assert.equal(result.ok, false)
  assert.equal(result.failedToken, 'passholder')
  assert.equal(result.reason, 'no-audio')
})

test('concatenates mixed-rate clips into one decodable mp3', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobhunt-tone-'))
  try {
    const first = path.join(directory, 'a.mp3')
    const second = path.join(directory, 'b.mp3')
    const tone = (file, rate, layout, seconds) => {
      const result = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=440:sample_rate=${rate}:duration=${seconds}`,
          '-ac',
          layout === 'stereo' ? '2' : '1',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '96k',
          file,
        ],
        { encoding: 'utf8' },
      )
      assert.equal(result.status, 0, result.stderr)
    }
    tone(first, 48000, 'stereo', 0.4)
    tone(second, 24000, 'mono', 0.5)
    const mp3 = await concatMp3s([await readFile(first), await readFile(second)])
    const output = path.join(directory, 'out.mp3')
    await writeFile(output, mp3)
    const probe = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,sample_rate,channels:format=duration',
        '-of',
        'json',
        output,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(probe.status, 0, probe.stderr)
    const metadata = JSON.parse(probe.stdout)
    assert.equal(metadata.streams[0].codec_name, 'mp3')
    assert.equal(metadata.streams[0].sample_rate, '24000')
    assert.equal(metadata.streams[0].channels, 1)
    const duration = Number(metadata.format.duration)
    assert.ok(duration > 0.7 && duration < 1.2, `duration ${duration}`)
    const decode = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', output, '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(decode.status, 0, decode.stderr)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
