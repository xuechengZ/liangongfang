import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const localAudioPattern = /^(?:ieltsWang(?:3|4|5|11)\/\d{4}(?:-original)?|JobHunt_Must\/\d{4}-(?:us|uk))\.mp3$/

export async function loadLocalPronunciation(localAudio, root) {
  if (!localAudioPattern.test(localAudio)) throw new Error('invalid-local-audio')

  try {
    return {
      body: await readFile(join(root, localAudio)),
      contentType: 'audio/mpeg',
      provider: 'local',
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

