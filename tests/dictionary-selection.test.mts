import { createMemorySelectionStore, getCurrentSelection, setCurrentSelection } from '../src/features/dictionary/selection-model.ts'
import type { Word } from '../src/typings/index.ts'
import assert from 'node:assert/strict'
import test from 'node:test'

const word: Word = { name: 'alpha', trans: ['α'], usphone: 'æ', ukphone: 'æ' }

test('set then get returns the same dict and chapter', () => {
  const store = createMemorySelectionStore({ dictId: 'cet4', chapter: 0, isReviewMode: false })
  setCurrentSelection(store, { dictId: 'cet6', chapter: 3 })
  assert.deepEqual(getCurrentSelection(store), { dictId: 'cet6', chapter: 3 })
})

test('a review word list round-trips and a later chapter write keeps it', () => {
  const store = createMemorySelectionStore({ dictId: 'cet4', chapter: 0, isReviewMode: false })
  setCurrentSelection(store, { dictId: 'cet6', chapter: -1, reviewWordList: [word] })
  assert.deepEqual(getCurrentSelection(store), { dictId: 'cet6', chapter: -1, reviewWordList: [word] })

  setCurrentSelection(store, { dictId: 'cet6', chapter: 4 })
  assert.deepEqual(getCurrentSelection(store), { dictId: 'cet6', chapter: 4, reviewWordList: [word] })
})

test('clearing the review list hides it and keeps the stored words', () => {
  const store = createMemorySelectionStore({ dictId: 'cet4', chapter: 0, isReviewMode: false })
  setCurrentSelection(store, { dictId: 'cet6', chapter: -1, reviewWordList: [word] })
  setCurrentSelection(store, { dictId: 'kaoyan', chapter: 1, reviewWordList: null })
  assert.deepEqual(getCurrentSelection(store), { dictId: 'kaoyan', chapter: 1 })
  assert.deepEqual(store.getSnapshot().reviewWords, [word])
  assert.equal(store.getSnapshot().isReviewMode, false)
})
