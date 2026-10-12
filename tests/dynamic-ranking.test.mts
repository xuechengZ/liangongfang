import { shouldCollectDynamicWordOnMistake, shouldRemoveDynamicWordAfterDictation } from '../src/utils/db/dynamic-ranking.ts'
import assert from 'node:assert/strict'
import test from 'node:test'

test('an unseen dictation mistake does not enter the ranking', () => {
  assert.equal(shouldCollectDynamicWordOnMistake(true, false), false)
})

test('a dictation mistake after the answer was seen still enters the ranking', () => {
  assert.equal(shouldCollectDynamicWordOnMistake(true, true), true)
})

test('a non-dictation mistake still enters the ranking', () => {
  assert.equal(shouldCollectDynamicWordOnMistake(false, false), true)
  assert.equal(shouldCollectDynamicWordOnMistake(false, true), true)
})

test('finishing an unseen dictation word from the ranking removes it', () => {
  assert.equal(shouldRemoveDynamicWordAfterDictation({ isDynamicPractice: true, isDictation: true, answerSeen: false }), true)
})

test('finishing a revealed dictation word from the ranking keeps it', () => {
  assert.equal(shouldRemoveDynamicWordAfterDictation({ isDynamicPractice: true, isDictation: true, answerSeen: true }), false)
})

test('a finished word outside dictation or outside the ranking is not removed', () => {
  assert.equal(shouldRemoveDynamicWordAfterDictation({ isDynamicPractice: true, isDictation: false, answerSeen: false }), false)
  assert.equal(shouldRemoveDynamicWordAfterDictation({ isDynamicPractice: false, isDictation: true, answerSeen: false }), false)
})
