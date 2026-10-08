import { db } from '.'
import { DYNAMIC_DICT_ID } from '@/constants'
import { idDictionaryMap } from '@/resources/dictionary'
import type { Word } from '@/typings'

export async function collectDynamicWord(word: Word, dict: string) {
  if (dict === DYNAMIC_DICT_ID || idDictionaryMap[dict]?.language !== 'en') return
  await db.dynamicWords.put({ name: word.name.trim().toLowerCase(), word, dict, timeStamp: Date.now() })
}
