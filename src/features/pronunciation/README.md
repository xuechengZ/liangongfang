# Pronunciation (F5)

Playback for word audio. Phase B moves the player here. On/off, accent, volume, rate, loop, and the local-then-online-then-speech fallback stay the same.

## What lives here

- `usePronunciation.ts` — play, stop, prefetch, and speech fallback
- `sound-src.ts` — `playWordPronunciation` / `generateWordSoundSrc`
- `local-audio-query.mjs` — adds `localAudio` to the request only when the entry has one
- `WordPronunciationIcon/` — the speaker control
- `PronunciationSwitcher/` — on/off and accent switcher used on the typing page
- `pronunciationTelemetry.ts` — playback diagnostics only

Import these from `@/features/pronunciation`.

`playWordPronunciation({ name, usphone, ukphone, localAudio }, accent)` builds the same request as before. It reads the headword, the accent, and optional `localAudio`. Phones may be passed with the dictionary entry; they are not added to the request. It does not read `answerSeen` or `wrongCount`.

Open state and accent are the existing atoms, re-exported from here:

- `pronunciationConfigAtom` (includes `isOpen`, `type`, `name`, volume, rate, loop)
- `pronunciationIsOpenAtom`
- `pronunciationIsTransReadAtom`

The atom storage key stays `pronunciation` in `src/store`. This feature does not copy that state.

雅思 wang C3 / C4 / C5 / C11 (`ieltsWang3`, `ieltsWang4`, `ieltsWang5`, `ieltsWang11`) can prefer the Wang corpus or Youdao. `PronunciationSwitcher` shows that choice only for those four books. `wangPronunciationSourceAtom` stores `wang` or `youdao` under localStorage key `wangPronunciationSource`, default `wang`. The atom stays in this feature and is not part of `pronunciationConfigAtom`, so the US/UK accent switch is unchanged.

`resolvePlaybackLocalAudio` drops `localAudio` only when the current book is one of those four and the preference is `youdao`. Play and prefetch both use that result. A missing `localAudio` still falls through to the online request. Other books always keep `localAudio`.

`showLocalAudioUncertainWarning` uses that same gate for the 「发音可能有误」 badge. Youdao on a Wang book hides the badge even when the entry still has `localAudioUncertain`. Wang playback still shows it when that flag is true. The dictionary JSON is left unchanged.

## Resource boundary

`localAudio` is an F4 dictionary field on dict JSON. It names a file under `public/local-pronunciation/`. Playback only reads it. Removing it from one word makes that word fall back to online audio, then system speech. Neighbor words keep their own `localAudio`. This feature does not edit dict JSON and does not move the mp3 package.

Practice correct/wrong logic stays in the typing `Word` component. Word only calls play (`WordPronunciationIcon` / the Ctrl+J and autoplay `play()` calls) and reads whether pronunciation is open.

## Left in place

`src/hooks/useSpeech.ts` stays. Translation speech (释义朗读) is the only caller, and that path is not word playback. Moving it would mix glossary reading into F5.

Old paths re-export this feature during the move:

- `src/hooks/usePronunciation.ts`
- `src/utils/pronunciationTelemetry.ts`
- `src/components/WordPronunciationIcon/`
- `src/pages/Typing/components/PronunciationSwitcher/`

## Listening check

On/off and accent switching should sound the same as before this move. A word with no `localAudio` should not request that word's local file.
