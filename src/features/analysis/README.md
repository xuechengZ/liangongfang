# Analysis (F6)

Read-only aggregation of practice history for the `/analysis` screen. This feature does not decide whether a practice attempt was correct, does not write `wordRecords`, and does not own ranking or error-book rules.

## Boundary

- Reads `db.wordRecords` only, using the fields the analysis page already uses (`timeStamp`, `word`, `timing`, `wrongCount`, `mistakes`).
- Does not call `collectDynamicWord`.
- Does not change dictation, ranking, or error-book rules.
- Does not share code with the donate card counter. `src/components/DonateCard/hooks/useWordStats.ts` stays there.
- Dexie table definitions stay in `src/utils/db/index.ts`. `src/utils/db/record.ts` stays put.
- `recordAnalysisAction` stays in `src/utils/mixpanel.ts`.

The page, charts, and the typing-page entry move here in this phase. The `/analysis` URL stays the same. Formulas and the one-year window stay the same.
