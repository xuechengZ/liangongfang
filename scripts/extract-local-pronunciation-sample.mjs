import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { speechIntervalsFromSilences } from './lib/pronunciationSegments.mjs'

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing --${name}`)
  return process.argv[index + 1]
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`)
  return result
}

function parseSilences(log) {
  const silences = []
  let pendingStart
  for (const line of log.split('\n')) {
    const start = line.match(/silence_start: ([\d.]+)/)
    if (start) pendingStart = Number(start[1])
    const end = line.match(/silence_end: ([\d.]+)/)
    if (end && pendingStart !== undefined) {
      silences.push({ start: pendingStart, end: Number(end[1]) })
      pendingStart = undefined
    }
  }
  return silences
}

const input = option('input')
const wordsPath = option('words')
const output = option('output')
const startAt = Number(option('start-at'))
const count = Number(option('count'))
const words = JSON.parse(await readFile(wordsPath, 'utf8')).slice(0, count).map((word) => (typeof word === 'string' ? word : word.name))

if (words.length !== count || words.some((word) => !word)) throw new Error(`Expected ${count} words`)

const detection = run('ffmpeg', [
  '-nostdin',
  '-hide_banner',
  '-nostats',
  '-i',
  input,
  '-map',
  '0:a:0',
  '-af',
  'silencedetect=noise=-35dB:d=1.2',
  '-f',
  'null',
  '-',
])
const intervals = speechIntervalsFromSilences(parseSilences(detection.stderr), startAt, count)
if (intervals.length !== count) throw new Error(`Found ${intervals.length} speech intervals; expected ${count}`)

await mkdir(output, { recursive: true })
const manifest = []
for (let index = 0; index < count; index += 1) {
  const interval = intervals[index]
  const file = `${String(index).padStart(4, '0')}-original.mp3`
  // Keep silent preroll so MP3 frame dependencies settle before the word.
  const start = Math.max(0, interval.start - 0.25)
  const end = interval.end + 0.08
  run('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(start),
    '-to',
    String(end),
    '-i',
    input,
    '-map',
    '0:a:0',
    '-c:a',
    'copy',
    join(output, file),
  ])
  manifest.push({ word: words[index], file, start, end, duration: end - start })
}

await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
