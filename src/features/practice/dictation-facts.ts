import { DYNAMIC_DICT_ID } from '@/constants'
import type { WordDictationType } from '@/typings'

/** Read-only inputs for ranking decisions. This module does not collect or remove words. */
export type DictationAttemptFacts = {
  dictationOpen: boolean
  answerSeen: boolean
  isDictation: boolean
  hidesEntireWord: boolean
  alreadyCollectedThisAttempt: boolean
  wrongCount: number
  isDynamicPractice: boolean
}

export function assembleDictationAttemptFacts(input: {
  dictationOpen: boolean
  dictationType: WordDictationType
  answerSeen: boolean | undefined
  isDictationAttempt: boolean
  alreadyCollectedThisAttempt: boolean
  wrongCount: number
  dictId: string
}): DictationAttemptFacts {
  const answerSeen = input.answerSeen === true
  return {
    dictationOpen: input.dictationOpen,
    answerSeen,
    isDictation: input.isDictationAttempt && input.dictationOpen,
    hidesEntireWord: input.dictationType === 'hideAll',
    alreadyCollectedThisAttempt: input.alreadyCollectedThisAttempt,
    wrongCount: input.wrongCount,
    isDynamicPractice: input.dictId === DYNAMIC_DICT_ID,
  }
}
