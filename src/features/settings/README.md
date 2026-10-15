# Settings (F8)

The typing-page settings dialog and the local practice-data export/import. This feature reads and writes existing atoms. It does not own those atoms, and it does not own the Dexie schema.

## Boundary

- `Setting/` is the dialog (formerly `src/pages/Typing/components/Setting`): 音效设置, 高级设置, 显示设置, and 数据设置. Switches, sliders, and labels stay the same.
- Sound settings still write `pronunciationConfigAtom` through `@/features/pronunciation`. That atom and its storage key stay in `src/store`. This feature does not copy them.
- View, advanced, key-sound, and hint-sound atoms stay in `src/store`. Default values and key names stay the same.
- `data-export.ts` still gzip-exports and gzip-imports the same Dexie database. `db` stays in `src/utils/db/index.ts`. `getCurrentDate` and `recordDataAction` stay in `src/utils`.
- Does not change practice judgment, pronunciation playback, ranking, dictionary selection, analysis, error-book, or review rules.

## Imports

Import the dialog from `@/features/settings`:

```ts
import { Setting } from '@/features/settings'
```

`DataSetting` imports `exportDatabase` and `importDatabase` from `../data-export`. The Switcher on the typing page imports `Setting` from this feature.

## Re-exports

During the move these paths re-export this feature:

- `src/pages/Typing/components/Setting`
- `src/utils/db/data-export.ts`
