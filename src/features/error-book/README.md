# Error book (F3)

Groups practice records with `wrongCount > 0` for the `/error-book` screen and the per-dictionary error list. This feature does not decide whether a practice attempt was correct, does not write `wordRecords`, and does not own ranking rules.

## Boundary

- Reads `db.wordRecords` where `wrongCount > 0` and groups them by word.
- Deletes rows only through `useDeleteWordRecord` in `src/utils/db`. The Dexie shell stays there.
- Does not write `dynamicWords` and does not call `collectDynamicWord`.
- Does not change ranking include/remove rules. Those stay in `src/features/ranking`.
- Does not change the review list order. `generateNewWordReviewRecord` stays in `src/utils/db/review-record.ts` and only consumes `TErrorWordData`.
- `recordErrorBookAction` stays in `src/utils/mixpanel.ts`.

The page, the dictionary error table, and the typing-page entry move here in this phase. The `/error-book` URL stays the same. Aggregation and sort stay the same.
