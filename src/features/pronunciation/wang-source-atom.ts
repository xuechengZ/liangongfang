import { DEFAULT_WANG_PRONUNCIATION_SOURCE, WANG_PRONUNCIATION_SOURCE_STORAGE_KEY } from './wang-source.mjs'
import { atomWithStorage } from 'jotai/utils'

export type WangPronunciationSource = 'wang' | 'youdao'

export const wangPronunciationSourceAtom = atomWithStorage<WangPronunciationSource>(
  WANG_PRONUNCIATION_SOURCE_STORAGE_KEY,
  DEFAULT_WANG_PRONUNCIATION_SOURCE,
)
