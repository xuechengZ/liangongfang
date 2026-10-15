import { assembleDictationAttemptFacts } from '@/features/practice/dictation-facts'
import {
  shouldCollectDynamicWordOnFinish,
  shouldCollectDynamicWordOnMistake,
  shouldRemoveDynamicWordAfterDictation,
} from '@/features/ranking'
import assert from 'node:assert/strict'
import test from 'node:test'

const rankingDictId = 'dynamic-errors'

test('fully hidden dictation that never saw the answer is not collected on a slip or on finish', () => {
  const facts = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: undefined,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 1,
    dictId: 'cet4',
  })
  assert.equal(facts.answerSeen, false)
  assert.equal(facts.hidesEntireWord, true)
  assert.equal(shouldCollectDynamicWordOnMistake(facts.dictationOpen, facts.answerSeen), false)
  assert.equal(shouldCollectDynamicWordOnFinish(facts), false)
  assert.equal(shouldRemoveDynamicWordAfterDictation(facts), false)
})

test('seeing the answer then finishing with zero mistakes collects once', () => {
  const facts = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: true,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 0,
    dictId: 'cet4',
  })
  assert.equal(shouldCollectDynamicWordOnFinish(facts), true)
})

test('seeing the answer then mistyping collects immediately and finish does not collect again', () => {
  const slipped = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: true,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 0,
    dictId: 'cet4',
  })
  assert.equal(shouldCollectDynamicWordOnMistake(slipped.dictationOpen, slipped.answerSeen), true)
  const finished = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: true,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: true,
    wrongCount: 1,
    dictId: 'cet4',
  })
  assert.equal(shouldCollectDynamicWordOnFinish(finished), false)
})

test('ranking dictation removes a word only when the answer was never seen and the spelling is finished in dictation', () => {
  const unseen = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: false,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 2,
    dictId: rankingDictId,
  })
  assert.equal(unseen.isDynamicPractice, true)
  assert.equal(shouldRemoveDynamicWordAfterDictation(unseen), true)
  const seen = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideAll',
    answerSeen: true,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 0,
    dictId: rankingDictId,
  })
  assert.equal(shouldRemoveDynamicWordAfterDictation(seen), false)
})

test('partial hide is not treated as a fully hidden completion write', () => {
  const facts = assembleDictationAttemptFacts({
    dictationOpen: true,
    dictationType: 'hideVowel',
    answerSeen: true,
    isDictationAttempt: true,
    alreadyCollectedThisAttempt: false,
    wrongCount: 0,
    dictId: 'cet4',
  })
  assert.equal(facts.hidesEntireWord, false)
  assert.equal(shouldCollectDynamicWordOnFinish(facts), false)
})
