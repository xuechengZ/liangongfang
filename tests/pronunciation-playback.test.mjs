import { localAudioQuery } from '../src/features/pronunciation/local-audio-query.mjs'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const words = JSON.parse(await readFile(new URL('../public/dicts/IELTS_WANG_3.json', import.meta.url), 'utf8'))

test('a word without localAudio does not request that local path', () => {
  const gender = words[425]
  assert.equal(gender.name, 'gender')
  assert.equal(Object.hasOwn(gender, 'localAudio'), false)

  const query = localAudioQuery(gender.localAudio)
  assert.equal(query, '')
  assert.equal(query.includes('localAudio'), false)
  assert.equal(query.includes('0425-original'), false)
})

test('only the word that has localAudio adds its own clip', () => {
  assert.equal(words[424].name, 'gasoline')
  assert.equal(localAudioQuery(words[424].localAudio), '')

  assert.equal(words[426].name, 'germ')
  assert.equal(localAudioQuery(words[426].localAudio), '&localAudio=ieltsWang3%2F0426-original.mp3')
  assert.equal(localAudioQuery(undefined), '')
  assert.equal(localAudioQuery(''), '')
})

test('the play request adds localAudio only through the shared query', async () => {
  const source = stripComments(await readFile(new URL('../src/features/pronunciation/sound-src.ts', import.meta.url), 'utf8'))
  const player = stripComments(await readFile(new URL('../src/features/pronunciation/usePronunciation.ts', import.meta.url), 'utf8'))
  assert.equal(
    source.includes('${localAudioQuery(localAudio)}'),
    true,
  )
  assert.equal(source.includes('generateWordSoundSrc(entry.name, accent, entry.localAudio)'), true)
  assert.equal(source.includes('entry.usphone'), false)
  assert.equal(source.includes('entry.ukphone'), false)
  assert.equal(player.includes('playWordPronunciation({ name: word, localAudio }, pronunciationConfig.type)'), true)
})

test('playback code does not read practice correct/wrong state', async () => {
  const root = fileURLToPath(new URL('../src/features/pronunciation/', import.meta.url))
  const files = await sourceFiles(root)
  assert.ok(files.length > 0)
  for (const file of files) {
    const source = stripComments(await readFile(file, 'utf8'))
    assert.equal(source.includes('answerSeen'), false, file)
    assert.equal(source.includes('wrongCount'), false, file)
  }
})

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(fullPath)))
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}
