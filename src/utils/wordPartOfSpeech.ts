import matchedPartsOfSpeech from '@/resources/word-parts-of-speech.json'
import type { Word } from '@/typings'

const index: Record<string, string> = matchedPartsOfSpeech

export function getWordPartOfSpeech(word: Word, language: string) {
  if (language !== 'en' || word.trans.some((text) => /\b(n|adj|adv|a|ad|vt|vi|v|prep|pron|conj|num|art|det|interj|int)\./.test(text))) return
  return index[`${word.name.trim().toLowerCase()}\t${word.trans.join('；')}`] ?? '词性待补充'
}
