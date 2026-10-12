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
