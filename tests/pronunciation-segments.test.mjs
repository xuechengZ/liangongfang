import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

let speechIntervalsFromSilences
try {
  ;({ speechIntervalsFromSilences } = await import('../scripts/lib/pronunciationSegments.mjs'))
} catch {}

test('skips the recording introduction and selects consecutive word intervals', () => {
  assert.equal(typeof speechIntervalsFromSilences, 'function', 'pronunciation segmenter is not implemented')
  const silences = [
    { start: 24.92805, end: 27.934785 },
    { start: 40.142585, end: 44.652018 },
    { start: 46.053356, end: 49.208481 },
    { start: 50.116236, end: 54.196984 },
    { start: 54.921338, end: 59.188073 },
    { start: 60.045533, end: 64.187959 },
  ]

  assert.deepEqual(speechIntervalsFromSilences(silences, 47, 3), [
    { start: 49.208481, end: 50.116236 },
    { start: 54.196984, end: 54.921338 },
    { start: 59.188073, end: 60.045533 },
  ])
})

test('extracts the first ten C3 words into decodable clips', { timeout: 30_000 }, async (context) => {
  const input = '/Users/zxc/Desktop/听力/01点击进入，音频做横向，纵向不用管/Chapter 3 雅思听力特别名词语料库/01 横向测试/01 Test 1-横向测试_对应表3.3-1.mp3'
  try {
    await access(input)
  } catch {
    context.skip('local C3 source recording is unavailable')
    return
  }

  const output = await mkdtemp(join(tmpdir(), 'qwerty-c3-sample-'))
  const result = spawnSync(
    process.execPath,
    [
      resolve('scripts/extract-local-pronunciation-sample.mjs'),
      '--input',
      input,
      '--words',
      resolve('scripts/local-pronunciation/ieltsWang3-test1.words.json'),
      '--output',
      output,
      '--start-at',
      '47',
      '--count',
      '10',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  const expectedWords = ['ability', 'abstract', 'accountant', 'accuracy', 'acid', 'action', 'activity', 'actor', 'adult', 'adventure']
  assert.deepEqual(
    manifest.map((item) => item.word),
    expectedWords,
  )
  assert.equal((await readdir(output)).filter((file) => file.endsWith('.mp3')).length, 10)

  const sourceProbe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', input],
    { encoding: 'utf8' },
  )
  assert.equal(sourceProbe.status, 0, sourceProbe.stderr)
  const sourceStream = JSON.parse(sourceProbe.stdout).streams[0]
  const sourcePackets = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', input],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  assert.equal(sourcePackets.status, 0, sourcePackets.stderr)
  const sourceHashes = JSON.parse(sourcePackets.stdout).packets.map((packet) => packet.data_hash)
  const sourceDecode = spawnSync(
    'ffmpeg',
    ['-nostdin', '-v', 'error', '-i', input, '-map', '0:a:0', '-t', String(manifest.at(-1).end + 0.3), '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  assert.equal(sourceDecode.status, 0, sourceDecode.stderr.toString())

  for (const item of manifest) {
    const clipPath = join(output, item.file)
    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration', '-of', 'json', clipPath],
      { encoding: 'utf8' },
    )
    assert.equal(probe.status, 0, probe.stderr)
    const metadata = JSON.parse(probe.stdout)
    assert.deepEqual(metadata.streams[0], sourceStream, `${item.word} must preserve the original audio format`)
    const duration = Number(metadata.format.duration)
    assert.ok(duration >= 0.3 && duration <= 3, `${item.word} duration ${duration}s is outside the sample range`)

    const clipPackets = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', clipPath],
      { encoding: 'utf8' },
    )
    assert.equal(clipPackets.status, 0, clipPackets.stderr)
    const clipHashes = JSON.parse(clipPackets.stdout).packets.map((packet) => packet.data_hash)
    assert.ok(clipHashes.length > 0, `${item.word} has no audio packets`)
    assert.ok(
      sourceHashes.some((_, offset) => clipHashes.every((hash, index) => hash === sourceHashes[offset + index])),
      `${item.word} audio packets must be copied unchanged from the original recording`,
    )

    const decode = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clipPath, '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(decode.status, 0, decode.stderr)
    assert.equal(decode.stderr, '', `${item.word} has audio decoding errors`)

    const pcm = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clipPath, '-map', '0:a:0', '-f', 'f32le', '-'])
    assert.equal(pcm.status, 0, pcm.stderr.toString())
    // MP3 frames can depend on preceding frames. Exclude only the silent
    // preroll while requiring the complete spoken tail to match the source.
    const prerollBytes = Math.round(Number(sourceStream.sample_rate) * 0.15) * sourceStream.channels * 4
    const spokenTail = pcm.stdout.subarray(prerollBytes)
    assert.ok(spokenTail.length > 0, `${item.word} has no decoded spoken audio`)
    assert.ok(sourceDecode.stdout.indexOf(spokenTail) >= 0, `${item.word} decoded speech must match the original samples`)
  }
})
