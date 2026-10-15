# Analysis (F6)

Read-only aggregation of practice history for the `/analysis` screen. This feature does not decide whether a practice attempt was correct, does not write `wordRecords`, and does not own ranking or error-book rules.

## Boundary

- Reads `db.wordRecords` only, using the fields the analysis page already uses (`timeStamp`, `word`, `timing`, `wrongCount`, `mistakes`).
- Does not call `collectDynamicWord`.
- Does not change dictation, ranking, or error-book rules.
- Does not share code with the donate card counter. `src/components/DonateCard/hooks/useWordStats.ts` stays there.
- Dexie table definitions stay in `src/utils/db/index.ts`. `src/utils/db/record.ts` stays put.
- `recordAnalysisAction` stays in `src/utils/mixpanel.ts`.

## Page

`pages/` is the `/analysis` screen (formerly `src/pages/Analysis`): heatmaps, WPM, accuracy, and mistake-key charts. `pages/hooks/useWordStats.ts` reads `wordRecords` between the two timestamps the page passes in. The page still asks for the last year (`dayjs().subtract(1, 'year')` through now). Empty history still renders “暂无练习数据”.

Import `useWordStats` from `@/features/analysis`. The route loads `pages/` on its own so the typing page does not pull the charts.

During the move, `src/pages/Analysis` re-exports the page. The `/analysis` URL stays the same. Formulas and the one-year window stay the same. The typing-page entry stays in Typing until it is colocated with this feature.
