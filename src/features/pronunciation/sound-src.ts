import { localAudioQuery } from './local-audio-query.mjs'
import type { PronunciationType } from '@/typings'
import { romajiToHiragana } from '@/utils/kana'

const pronunciationService = import.meta.env.VITE_PRONUNCIATION_ENDPOINT || 'http://127.0.0.1:8787/audio'

export { localAudioQuery } from './local-audio-query.mjs'

/**
 * Fields playback may read from a dictionary entry.
 * Practice state (answerSeen, wrongCount) is not part of this input.
 * Phones are accepted with the entry; the request still uses the headword,
 * accent, and optional localAudio, matching the previous player.
 */
export type PronunciationPlayInput = {
  name: string
  usphone?: string
  ukphone?: string
  localAudio?: string
}

export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>, localAudio?: string): string {
  const audioWord = pronunciation === 'romaji' ? romajiToHiragana(word) : word
  return `${pronunciationService}?word=${encodeURIComponent(audioWord)}&pronunciation=${pronunciation}${localAudioQuery(localAudio)}`
}

export function playWordPronunciation(entry: PronunciationPlayInput, accent: Exclude<PronunciationType, false>): string {
  return generateWordSoundSrc(entry.name, accent, entry.localAudio)
}
