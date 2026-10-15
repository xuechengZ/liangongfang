# Smart review (F7)

Builds a practice list from one dictionary's error-book rows and shows the gallery "错题回顾" panel. This feature does not decide whether a practice attempt was correct, and it does not own the current book selection.

## Boundary

- `ReviewDetail` starts or continues a review. It still calls `setCurrentSelection({ dictId, chapter: -1 })` and `enterReviewMode` from `@/features/dictionary`, then navigates to `/`.
- `enterReviewMode`, `setReviewCursor`, and `markReviewRecordFinished` stay in dictionary selection (F4). `reviewModeInfoAtom` stays in `src/store/reviewInfoAtom.ts`.
- `ReviewRecord` and the `reviewRecords` Dexie table stay in `src/utils/db`. This feature only reads and writes rows through that shell.
- `TErrorWordData` stays in `@/features/error-book`. This feature does not relocate it.
- Ranking (F2) still starts its own round with `setCurrentSelection` plus `enterReviewMode`. That path is unchanged.

## Ordering

`review-record.ts` exports `generateNewWordReviewRecord`, `useGetLatestReviewRecord`, and `putWordReviewRecord`.

`generateNewWordReviewRecord` still ranks `TErrorWordData[]` with error-count weight `0.6` and latest-error-time weight `0.4`, stores a `ReviewRecord`, and returns it. `useGetLatestReviewRecord` still returns the newest unfinished record for that dictionary, or `undefined` when the latest record is finished. `putWordReviewRecord` still writes the record the review atom already holds.

## Panel

`ReviewDetail/` is the panel inside dictionary detail (formerly `src/features/dictionary/gallery/ReviewDetail`). With no unfinished record it shows the error-word count and "开始复习". With an unfinished record it shows the same progress bar, created-at time, "继续当前进度", and "开始新的复习".

Import `ReviewDetail` from `@/features/review`. Gallery dictionary detail does that. The old gallery path re-exports the component.

## Re-exports

During the move these paths re-export this feature:

- `src/utils/db/review-record.ts`
- `src/features/dictionary/gallery/ReviewDetail`

`src/store/reviewInfoAtom.ts` still imports `putWordReviewRecord` from `@/utils/db/review-record`.
