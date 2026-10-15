import {
  type CurrentSelection,
  type SelectionSnapshot,
  type SelectionStore,
  type SelectionWrite,
  readSelection,
  getCurrentSelection as readStoreSelection,
  setCurrentSelection as writeStoreSelection,
} from './selection-model'
import { currentChapterAtom, currentDictIdAtom, currentDictInfoAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { ReviewRecord } from '@/utils/db/record'
import { getDefaultStore, useAtomValue } from 'jotai'
import { useMemo } from 'react'

export type { CurrentSelection, SelectionWrite } from './selection-model'

const jotaiSelectionStore: SelectionStore = {
  getSnapshot() {
    const jotai = getDefaultStore()
    const review = jotai.get(reviewModeInfoAtom)
    return {
      dictId: jotai.get(currentDictIdAtom),
      chapter: jotai.get(currentChapterAtom),
      isReviewMode: review.isReviewMode,
      reviewWords: review.reviewRecord?.words,
    }
  },
  commit(next: SelectionSnapshot, write: SelectionWrite) {
    const jotai = getDefaultStore()
    jotai.set(currentDictIdAtom, next.dictId)
    jotai.set(currentChapterAtom, next.chapter)
    if (write.reviewWordList === undefined) return

    const current = jotai.get(reviewModeInfoAtom)
    if (write.reviewWordList === null) {
      jotai.set(reviewModeInfoAtom, { ...current, isReviewMode: false })
      return
    }
    if (current.reviewRecord && current.reviewRecord.words === write.reviewWordList) {
      jotai.set(reviewModeInfoAtom, { isReviewMode: true, reviewRecord: current.reviewRecord })
      return
    }
    jotai.set(reviewModeInfoAtom, {
      isReviewMode: true,
      reviewRecord: new ReviewRecord(next.dictId, write.reviewWordList),
    })
  },
}

/** Read the current book, chapter, and optional review list from the existing atoms. */
export function getCurrentSelection(): CurrentSelection {
  return readStoreSelection(jotaiSelectionStore)
}

/** Write book + chapter. Pass `reviewWordList: null` to leave review mode without deleting the record. */
export function setCurrentSelection(write: SelectionWrite): void {
  writeStoreSelection(jotaiSelectionStore, write)
}

/** Chapter-only write used by the typing chapter switcher and chapter advance. */
export function setCurrentChapter(next: number | ((chapter: number) => number)): void {
  const jotai = getDefaultStore()
  const chapter = jotai.get(currentChapterAtom)
  jotai.set(currentChapterAtom, typeof next === 'function' ? next(chapter) : next)
}

/**
 * Install a review record as the active review list.
 * `getCurrentSelection().reviewWordList` then returns `record.words`.
 * The record object (index, id, createTime) is stored unchanged.
 */
export function enterReviewMode(record: ReviewRecord | undefined): void {
  getDefaultStore().set(reviewModeInfoAtom, { isReviewMode: true, reviewRecord: record })
}

/** Practice moves the cursor inside the active review record. The word list stays the same. */
export function setReviewCursor(index: number): void {
  getDefaultStore().set(reviewModeInfoAtom, (old) => ({
    ...old,
    reviewRecord: old.reviewRecord ? { ...old.reviewRecord, index } : undefined,
  }))
}

/** Practice marks the active review record finished without changing its word list. */
export function markReviewRecordFinished(): void {
  getDefaultStore().set(reviewModeInfoAtom, (old) => ({
    ...old,
    reviewRecord: old.reviewRecord ? { ...old.reviewRecord, isFinished: true } : undefined,
  }))
}

export function useCurrentSelection(): CurrentSelection {
  const dictId = useAtomValue(currentDictIdAtom)
  const chapter = useAtomValue(currentChapterAtom)
  const review = useAtomValue(reviewModeInfoAtom)
  return useMemo(
    () =>
      readSelection({
        dictId,
        chapter,
        isReviewMode: review.isReviewMode,
        reviewWords: review.reviewRecord?.words,
      }),
    [chapter, dictId, review.isReviewMode, review.reviewRecord?.words],
  )
}

export function useCurrentDictInfo(): Dictionary {
  return useAtomValue(currentDictInfoAtom)
}
