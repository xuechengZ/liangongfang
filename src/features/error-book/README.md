# Error book (F3)

Groups practice records with `wrongCount > 0` for the `/error-book` screen and the per-dictionary error list. This feature does not decide whether a practice attempt was correct, does not write `wordRecords`, and does not own ranking rules.

## Boundary

- Reads `db.wordRecords` where `wrongCount > 0` and groups them by word.
- Deletes rows only through `useDeleteWordRecord` in `src/utils/db`. The Dexie shell stays there.
- Does not write `dynamicWords` and does not call `collectDynamicWord`.
- Does not change ranking include/remove rules. Those stay in `src/features/ranking`.
- Does not change the review list order. `generateNewWordReviewRecord` stays in `src/utils/db/review-record.ts` and only consumes `TErrorWordData`.
- `recordErrorBookAction` stays in `src/utils/mixpanel.ts`.

## Page

`pages/` is the `/error-book` screen (formerly `src/pages/ErrorBook`). It still loads every `wordRecords` row with `wrongCount > 0`, groups rows that share a word and a dictionary, and sums `wrongCount` for the sort. The header cycles ascending, descending, then unsorted. The detail panel still shows average time, practice count, correct count, and wrong count. Export still writes `.xlsx` and `.csv`. Delete still calls `useDeleteWordRecord` and reloads the same query.

Import `ErrorBook` from `@/features/error-book`. `src/pages/ErrorBook` re-exports the page. The `/error-book` URL stays the same.

The dictionary error table and the typing-page entry move here in this phase.
