# Dictionary (F4)

Stub only. Dict selection and dict JSON are not moved in this phase.

`localAudio` on a word is a dictionary resource. It lives on `public/dicts/*.json` and points at a clip under `public/local-pronunciation/`. Those files stay out of `src/features`.

Pronunciation (F5) may read `name`, phones, and optional `localAudio` when it plays a word. It does not write the field and does not decide whether a practice attempt was correct. Deleting `localAudio` from one entry changes only that word's audio source.
