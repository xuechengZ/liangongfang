# Dictionary (F4)

Owns the current book and chapter, the optional review word list, and dictionary metadata. Practice reads that selection. It does not import the gallery page.

## Selection

`selection.ts` is the read/write API. Atoms stay in `src/store` (`currentDictIdAtom`, `currentChapterAtom`, `reviewModeInfoAtom`). This feature is the only place that should write them.

```ts
type CurrentSelection = {
  dictId: string
  chapter: number
  reviewWordList?: Word[]
}
```

- `getCurrentSelection()` / `useCurrentSelection()` project those atoms. `reviewWordList` is set only while review mode is on, and it is `reviewRecord.words`.
- `setCurrentSelection({ dictId, chapter })` writes the book and chapter and leaves the review record alone.
- `setCurrentSelection({ dictId, chapter, reviewWordList: null })` leaves review mode and keeps the stored record.
- `setCurrentChapter` changes only the chapter (typing listbox and next chapter).
- `enterReviewMode(record)` stores the existing review record unchanged. After that, `reviewWordList` is `record.words`.
- `setReviewCursor` and `markReviewRecordFinished` update progress on that record. They do not replace the word list.

Gallery and the old gallery cards call `setCurrentSelection`. Typing reads the selection and changes chapters through `setCurrentChapter` or `setCurrentSelection`. The ranking screen starts a round with `setCurrentSelection` plus `enterReviewMode`. It does not change ranking rules.

`useCurrentDictInfo()` is the derived dictionary (unknown ids still fall back to CET-4).

## Gallery

The `/gallery` page lives in `gallery/` (formerly `src/pages/Gallery-N`). The route is unchanged.

During the move these paths re-export the feature:

- `src/pages/Gallery-N`
- `src/resources/dictionary.ts` re-exports `catalog.ts`

`src/pages/Gallery` is the unused previous page. It also writes through the selection API. It is not the `/gallery` route.

`useErrorWords` and ErrorTable live in `@/features/error-book`. These paths re-export that feature:

- `src/features/dictionary/gallery/hooks/useErrorWords.ts`
- `src/features/dictionary/gallery/ErrorTable`
- `src/pages/Gallery-N/hooks/useErrorWords.ts`

They still read and delete the same `wordRecords` rows.

## Metadata and audio

`catalog.ts` is the dictionary list (`dictionaries`, `dictionaryResources`, `idDictionaryMap`). Word lists stay in `public/dicts/*.json`. `public/local-pronunciation/` stays put.

`localAudio` on a word is a dictionary field. It points at a clip under `public/local-pronunciation/`. Pronunciation (F5) may read `name`, phones, and optional `localAudio` when it plays a word. Playback does not write the field and does not decide whether a practice attempt was correct.
