const jobHuntStaticClip = /^JobHunt_Must\/\d{4}-(?:us|uk)\.mp3$/

export function clipForAccent(localAudio, accent) {
  if (!localAudio) return undefined
  if (typeof localAudio === 'string') return localAudio || undefined
  if (accent !== 'us' && accent !== 'uk') return undefined
  const clip = localAudio[accent]
  return typeof clip === 'string' && clip ? clip : undefined
}

export function isJobHuntStaticClip(clip) {
  return typeof clip === 'string' && jobHuntStaticClip.test(clip)
}

export function directStaticPronunciationSrc(localAudio, accent) {
  const clip = clipForAccent(localAudio, accent)
  return isJobHuntStaticClip(clip) ? `/local-pronunciation/${clip}` : ''
}

export function staticClipFallbackSrc(primarySrc, onlineSrc) {
  if (typeof primarySrc !== 'string' || !primarySrc.startsWith('/local-pronunciation/')) return undefined
  if (typeof onlineSrc !== 'string' || !onlineSrc || onlineSrc.startsWith('/local-pronunciation/')) return undefined
  return onlineSrc
}
