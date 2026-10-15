# Ranking (F2)

Home for the mistake ranking feature (错词排行). Phase A moves the rules, storage accessors, and the ranking screen here. Behavior matches the slip-exempt and answer-seen collect rules already on main.

Dexie table definitions stay in `src/utils/db/index.ts`. This feature does not own the database shell.

## Decisions

Import these from `@/features/ranking`:

- `shouldCollectDynamicWordOnMistake`
- `shouldCollectDynamicWordOnFinish`
- `shouldRemoveDynamicWordAfterDictation`

The barrel exports only these pure functions. Storage stays on its own module because it reads the Dexie shell.

## Storage

`dynamic-words.ts` collects and lists `dynamicWords` rows. Schema and the word-record transaction stay in `src/utils/db/index.ts`.

## UI

`DynamicWordBook` is the screen for `/dynamic-wordbook`. The route URL is unchanged.

During the move, these paths re-export the new modules:

- `src/utils/db/dynamic-ranking.ts`
- `src/utils/db/dynamic-words.ts`
- `src/pages/DynamicWordBook`
