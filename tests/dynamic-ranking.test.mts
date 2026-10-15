import {
  shouldCollectDynamicWordOnFinish,
  shouldCollectDynamicWordOnMistake,
  shouldRemoveDynamicWordAfterDictation,
} from '../src/utils/db/dynamic-ranking.ts'
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

test('finishing a revealed fully hidden dictation word collects it even when wrongCount is 0', () => {
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: true,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: false,
      wrongCount: 0,
    }),
    true,
  )
})

test('finishing a revealed dictation word still collects it when earlier unseen slips were not recorded', () => {
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: true,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: false,
      wrongCount: 2,
    }),
    true,
  )
})

test('a revealed dictation word already collected from a post-reveal mistake is not collected again on finish', () => {
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: true,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: true,
      wrongCount: 1,
    }),
    false,
  )
})

test('finishing an unseen dictation word does not collect it', () => {
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: false,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: false,
      wrongCount: 0,
    }),
    false,
  )
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: false,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: false,
      wrongCount: 3,
    }),
    false,
  )
})

test('finishing outside fully hidden dictation does not collect a word just because the answer flag is set', () => {
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: false,
      answerSeen: true,
      hidesEntireWord: true,
      alreadyCollectedThisAttempt: false,
      wrongCount: 0,
    }),
    false,
  )
  assert.equal(
    shouldCollectDynamicWordOnFinish({
      isDictation: true,
      answerSeen: true,
      hidesEntireWord: false,
      alreadyCollectedThisAttempt: false,
      wrongCount: 0,
    }),
    false,
  )
})
