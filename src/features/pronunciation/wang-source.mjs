export const WANG_PRONUNCIATION_DICT_IDS = ['ieltsWang3', 'ieltsWang4', 'ieltsWang5', 'ieltsWang11']

export const WANG_PRONUNCIATION_SOURCE_OPTIONS = [
  { value: 'wang', label: '优先王陆语料发音' },
  { value: 'youdao', label: '优先有道词典发音' },
]

export const DEFAULT_WANG_PRONUNCIATION_SOURCE = 'wang'

export const WANG_PRONUNCIATION_SOURCE_STORAGE_KEY = 'wangPronunciationSource'

export function isWangPronunciationDict(dictId) {
  return WANG_PRONUNCIATION_DICT_IDS.includes(dictId)
}

function playbackKeepsLocalAudio(dictId, source) {
  return !(source === 'youdao' && isWangPronunciationDict(dictId))
}

/**
 * Drop localAudio only for the four Wang books when the listener prefers Youdao.
 * Other books keep localAudio. A missing clip stays missing so playback uses the remote path.
 * Anything other than "youdao" keeps today's Wang-corpus behavior.
 */
export function resolvePlaybackLocalAudio(localAudio, dictId, source = DEFAULT_WANG_PRONUNCIATION_SOURCE) {
  if (!playbackKeepsLocalAudio(dictId, source)) return undefined
  return localAudio
}

/**
 * 「发音可能有误」 warns about a Wang corpus clip.
 * Hide it when playback will not use that clip, even if the entry still has localAudioUncertain.
 */
export function showLocalAudioUncertainWarning(localAudioUncertain, dictId, source = DEFAULT_WANG_PRONUNCIATION_SOURCE) {
  return Boolean(localAudioUncertain) && playbackKeepsLocalAudio(dictId, source)
}
