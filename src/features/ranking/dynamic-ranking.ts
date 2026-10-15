/** Skip a ranking write only while a dictation word has not been revealed. */
export function shouldCollectDynamicWordOnMistake(dictation: boolean, answerSeen: boolean): boolean {
  return !(dictation && !answerSeen)
}

/**
 * Drop a ranking entry when dictation practice finishes without the answer ever being shown.
 * Mid-word typos still count as mastered once the final spelling is correct.
 */
export function shouldRemoveDynamicWordAfterDictation(input: {
  isDynamicPractice: boolean
  isDictation: boolean
  answerSeen: boolean
}): boolean {
  return input.isDynamicPractice && input.isDictation && !input.answerSeen
}

/**
 * Record a finished dictation word when the spelling was revealed.
 * wrongCount is part of the decision so a perfect spelling is not skipped,
 * and so an earlier unseen slip does not block the write. A post-reveal
 * mistake already called collectDynamicWord, so that attempt is not counted again.
 * Partial-hide modes mark the answer seen as soon as the word appears; only
 * fully hidden dictation uses this completion write.
 */
export function shouldCollectDynamicWordOnFinish(input: {
  isDictation: boolean
  answerSeen: boolean
  hidesEntireWord: boolean
  alreadyCollectedThisAttempt: boolean
  wrongCount: number
}): boolean {
  return input.isDictation && input.hidesEntireWord && input.answerSeen && !input.alreadyCollectedThisAttempt && input.wrongCount >= 0
}
