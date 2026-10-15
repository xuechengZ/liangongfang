export function localAudioQuery(localAudio) {
  return localAudio ? `&localAudio=${encodeURIComponent(localAudio)}` : ''
}
