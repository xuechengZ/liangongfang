import { db } from '.'
import { DYNAMIC_DICT_ID } from '@/constants'
import { idDictionaryMap } from '@/resources/dictionary'
import type { Word } from '@/typings'

export async function collectDynamicWord(word: Word, dict: string) {
  if (idDictionaryMap[dict]?.language !== 'en') return
  const name = word.name.trim().toLowerCase()
  await db.transaction('rw', db.dynamicWords, db.wordRecords, async () => {
    const previous = await db.dynamicWords.get(name)
    if (dict === DYNAMIC_DICT_ID && !previous) return
    const history = previous?.wrongCount === undefined ? await db.wordRecords.where('word').equalsIgnoreCase(word.name).toArray() : []
    const wrongCount = previous?.wrongCount ?? Math.max(previous ? 1 : 0, history.reduce((sum, record) => sum + record.wrongCount, 0))
    await db.dynamicWords.put({
      name,
      word,
      dict: dict === DYNAMIC_DICT_ID && previous ? previous.dict : dict,
      timeStamp: Date.now(),
      wrongCount: wrongCount + 1,
    })
  })
}

export async function getRankedDynamicWords() {
  return db.transaction('r', db.dynamicWords, db.wordRecords, async () => {
    const entries = await db.dynamicWords.toArray()
    const counts = new Map<string, number>()
    if (entries.some((entry) => entry.wrongCount === undefined)) {
      const history = await db.wordRecords.where('wrongCount').above(0).toArray()
      for (const record of history) {
        const name = record.word.trim().toLowerCase()
        counts.set(name, (counts.get(name) ?? 0) + record.wrongCount)
      }
    }
    return entries
      .map((entry) => ({ ...entry, wrongCount: entry.wrongCount ?? Math.max(1, counts.get(entry.name) ?? 0) }))
      .sort((a, b) => b.wrongCount - a.wrongCount || a.timeStamp - b.timeStamp)
  })
}
