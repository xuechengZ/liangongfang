import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const manifest = JSON.parse(await readFile('docs/cloud-audio-manifest.json', 'utf8'))
for (const entry of manifest) {
  const body = await readFile(path.join('dist/client/local-pronunciation', entry.path))
  assert.equal(body.length, entry.bytes, entry.path)
  assert.equal(createHash('sha256').update(body).digest('hex'), entry.sha256, entry.path)
}
const assets = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(filename)
    else assets.push(filename)
  }
}
await walk('dist/client')
assert.ok(assets.length <= 20000, 'static asset file limit')
for (const filename of assets) assert.ok((await stat(filename)).size <= 25 * 1024 * 1024, filename)
for (const filename of assets.filter(filename => filename.endsWith('.js'))) {
  assert.ok(!(await readFile(filename, 'utf8')).includes('http://127.0.0.1:8787'), `local endpoint in ${filename}`)
}
for (const book of [3, 4, 5, 11]) {
  const words = JSON.parse(await readFile(`dist/client/dicts/IELTS_WANG_${book}.json`, 'utf8'))
  for (const word of words.filter(word => word.localAudio)) {
    assert.ok(manifest.some(entry => entry.path === word.localAudio), `${book}: ${word.name}`)
  }
}
console.log(JSON.stringify({ originalAudioClips: manifest.length, originalAudioBytes: manifest.reduce((n, entry) => n + entry.bytes, 0), staticAssets: assets.length, originalAudioHashesVerified: true, loopbackEndpointsAbsent: true }))
