import type { Word } from '@/typings'

/**
 * Practice-facing selection. `reviewWordList` is present only while review mode is on.
 * The stored review record (progress, id) stays behind this projection.
 */
export type CurrentSelection = {
  dictId: string
  chapter: number
  reviewWordList?: Word[]
}

export type SelectionSnapshot = {
  dictId: string
  chapter: number
  isReviewMode: boolean
  reviewWords?: Word[]
}

/**
 * `reviewWordList` omitted: leave review mode untouched.
 * `null`: chapter practice; hide the review list but keep the stored record.
 * array: this selection is a review list.
 */
export type SelectionWrite = {
  dictId: string
  chapter: number
  reviewWordList?: Word[] | null
}

export interface SelectionStore {
  getSnapshot(): SelectionSnapshot
  commit(next: SelectionSnapshot, write: SelectionWrite): void
}

export function readSelection(snapshot: SelectionSnapshot): CurrentSelection {
  if (snapshot.isReviewMode) {
    return {
      dictId: snapshot.dictId,
      chapter: snapshot.chapter,
      reviewWordList: snapshot.reviewWords ?? [],
    }
  }
  return {
    dictId: snapshot.dictId,
    chapter: snapshot.chapter,
  }
}

export function applySelection(snapshot: SelectionSnapshot, write: SelectionWrite): SelectionSnapshot {
  const next: SelectionSnapshot = {
    dictId: write.dictId,
    chapter: write.chapter,
    isReviewMode: snapshot.isReviewMode,
    reviewWords: snapshot.reviewWords,
  }
  if (write.reviewWordList === null) {
    next.isReviewMode = false
  } else if (write.reviewWordList !== undefined) {
    next.isReviewMode = true
    next.reviewWords = write.reviewWordList
  }
  return next
}

export function getCurrentSelection(store: SelectionStore): CurrentSelection {
  return readSelection(store.getSnapshot())
}

export function setCurrentSelection(store: SelectionStore, write: SelectionWrite): void {
  store.commit(applySelection(store.getSnapshot(), write), write)
}

export function createMemorySelectionStore(initial: SelectionSnapshot): SelectionStore {
  let snapshot: SelectionSnapshot = initial
  return {
    getSnapshot() {
      return snapshot
    },
    commit(next) {
      snapshot = next
    },
  }
}
