import { staticClipFallbackSrc } from './accent-local-audio.mjs'
import { reportPronunciationEvent } from './pronunciationTelemetry'
import { playWordPronunciation } from './sound-src'
import { wangPronunciationSourceAtom } from './wang-source-atom'
import { resolvePlaybackLocalAudio } from './wang-source.mjs'
import { currentDictInfoAtom, pronunciationConfigAtom } from '@/store'
import type { LocalAudioSource, PronunciationType } from '@/typings'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type { PronunciationPlayInput } from './sound-src'
export { generateWordSoundSrc, playWordPronunciation } from './sound-src'

export type PronunciationStatus = 'idle' | 'loading' | 'playing' | 'fallback' | 'error' | 'no-progress'

function getSpeechLanguage(pronunciation: Exclude<PronunciationType, false>) {
  switch (pronunciation) {
    case 'uk':
      return 'en-GB'
    case 'us':
      return 'en-US'
    case 'romaji':
    case 'ja':
      return 'ja-JP'
    case 'zh':
      return 'zh-CN'
    case 'de':
      return 'de-DE'
    case 'id':
      return 'id-ID'
    default:
      return 'ru-RU'
  }
}

function usePlaybackLocalAudio(localAudio?: LocalAudioSource) {
  const dictId = useAtomValue(currentDictInfoAtom).id
  const source = useAtomValue(wangPronunciationSourceAtom)
  return resolvePlaybackLocalAudio(localAudio, dictId, source)
}

export default function usePronunciationSound(word: string, isLoop?: boolean, localAudio?: LocalAudioSource) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const playbackLocalAudio = usePlaybackLocalAudio(localAudio)
  const loop = useMemo(() => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop), [isLoop, pronunciationConfig.isLoop])
  const [isPlaying, setIsPlaying] = useState(false)
  const [status, setStatus] = useState<PronunciationStatus>('idle')
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const progressTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const progressCheckTimerRef = useRef<ReturnType<typeof setInterval>>()
  const startedAtRef = useRef(0)
  const playIdRef = useRef(0)
  const reportedPlayRef = useRef(false)
  const fallbackStartedRef = useRef(false)
  const staticFallbackTriedRef = useRef(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance>()

  const soundUrl = useMemo(
    () => playWordPronunciation({ name: word, localAudio: playbackLocalAudio }, pronunciationConfig.type),
    [playbackLocalAudio, pronunciationConfig.type, word],
  )
  const fallbackSoundUrl = useMemo(
    () => staticClipFallbackSrc(soundUrl, playWordPronunciation({ name: word }, pronunciationConfig.type)),
    [pronunciationConfig.type, soundUrl, word],
  )
  const audioRef = useRef<HTMLAudioElement>()

  useEffect(() => {
    staticFallbackTriedRef.current = false
    const audio = new Audio(soundUrl)
    audio.preload = 'auto'
    audio.volume = pronunciationConfig.volume
    audio.playbackRate = pronunciationConfig.rate
    audio.loop = loop
    const reportPlaybackProgress = () => {
      if (audioRef.current !== audio || reportedPlayRef.current || audio.currentTime <= 0.05) return
      reportedPlayRef.current = true
      clearTimeout(progressTimerRef.current)
      clearInterval(progressCheckTimerRef.current)
      void reportPronunciationEvent({
        event: 'played',
        word,
        pronunciation: pronunciationConfig.type,
        elapsedMs: Date.now() - startedAtRef.current,
        retryCount: 0,
      })
    }
    audio.onplay = () => {
      if (audioRef.current !== audio) return
      clearTimeout(loadingTimerRef.current)
      setIsPlaying(true)
      setStatus('playing')
      clearInterval(progressCheckTimerRef.current)
      progressCheckTimerRef.current = setInterval(reportPlaybackProgress, 100)
    }
    audio.ontimeupdate = reportPlaybackProgress
    audio.onended = () => {
      if (audioRef.current === audio) {
        reportPlaybackProgress()
        clearTimeout(progressTimerRef.current)
        clearInterval(progressCheckTimerRef.current)
        setIsPlaying(false)
        setStatus('idle')
      }
    }
    audio.onpause = () => {
      if (audioRef.current !== audio) return
      setIsPlaying(false)
      setStatus('idle')
      clearTimeout(progressTimerRef.current)
      clearInterval(progressCheckTimerRef.current)
    }
    const reportAudioError = () => {
      clearTimeout(progressTimerRef.current)
      clearInterval(progressCheckTimerRef.current)
      setStatus('error')
      console.warn('[pronunciation] audio request failed', { word, soundUrl })
      void reportPronunciationEvent({
        event: 'request_error',
        word,
        pronunciation: pronunciationConfig.type,
        elapsedMs: Date.now() - startedAtRef.current,
        retryCount: 0,
        error: 'audio-error',
      })
    }
    const onAudioError = () => {
      if (audioRef.current !== audio) return
      if (
        fallbackSoundUrl &&
        !staticFallbackTriedRef.current &&
        startedAtRef.current !== 0 &&
        soundUrl.startsWith('/local-pronunciation/')
      ) {
        staticFallbackTriedRef.current = true
        audio.onerror = null
        audio.src = fallbackSoundUrl
        audio.load()
        audio.onerror = onAudioError
        void audio.play()?.catch(() => {
          if (audioRef.current !== audio) return
          reportAudioError()
        })
        return
      }
      if (startedAtRef.current === 0) return
      reportAudioError()
    }
    audio.onerror = onAudioError
    audioRef.current = audio

    return () => {
      playIdRef.current += 1
      clearTimeout(loadingTimerRef.current)
      clearTimeout(progressTimerRef.current)
      clearInterval(progressCheckTimerRef.current)
      if (utteranceRef.current) window.speechSynthesis.cancel()
      audio.pause()
      audio.src = ''
      audioRef.current = undefined
      startedAtRef.current = 0
      setIsPlaying(false)
      setStatus('idle')
    }
  }, [fallbackSoundUrl, loop, pronunciationConfig.rate, pronunciationConfig.type, pronunciationConfig.volume, soundUrl, word])

  const stop = useCallback(() => {
    playIdRef.current += 1
    clearTimeout(loadingTimerRef.current)
    clearTimeout(progressTimerRef.current)
    clearInterval(progressCheckTimerRef.current)
    if (utteranceRef.current) {
      window.speechSynthesis.cancel()
      utteranceRef.current = undefined
    }
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.currentTime = 0
    startedAtRef.current = 0
  }, [])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    stop()
    const playId = playIdRef.current
    reportedPlayRef.current = false
    fallbackStartedRef.current = false
    staticFallbackTriedRef.current = false
    startedAtRef.current = Date.now()
    setStatus('loading')
    if (soundUrl.startsWith('/local-pronunciation/')) {
      const preferred = new URL(soundUrl, window.location.href).href
      if (audio.currentSrc !== preferred) {
        audio.src = soundUrl
        audio.load()
      }
    }
    if (audio.error) {
      let nextSrc = soundUrl
      if (fallbackSoundUrl && soundUrl.startsWith('/local-pronunciation/')) {
        nextSrc = fallbackSoundUrl
        staticFallbackTriedRef.current = true
      }
      const handler = audio.onerror
      audio.onerror = null
      audio.src = nextSrc
      audio.load()
      audio.onerror = handler
    }
    clearTimeout(loadingTimerRef.current)
    clearTimeout(progressTimerRef.current)
    clearInterval(progressCheckTimerRef.current)
    loadingTimerRef.current = setTimeout(() => {
      if (audioRef.current === audio) {
        console.info('[pronunciation] audio still loading after 500ms', { word, soundUrl })
        void reportPronunciationEvent({
          event: 'loading_slow',
          word,
          pronunciation: pronunciationConfig.type,
          elapsedMs: Date.now() - startedAtRef.current,
          retryCount: 0,
        })
      }
    }, 500)
    const playFallback = () => {
      if (fallbackStartedRef.current || playIdRef.current !== playId || !('speechSynthesis' in window)) return
      fallbackStartedRef.current = true
      clearTimeout(loadingTimerRef.current)
      clearTimeout(progressTimerRef.current)
      clearInterval(progressCheckTimerRef.current)
      audio.pause()

      const utterance = new SpeechSynthesisUtterance(word)
      utterance.lang = getSpeechLanguage(pronunciationConfig.type)
      const voices = window.speechSynthesis.getVoices()
      const expectedLanguage = utterance.lang.toLocaleLowerCase()
      const preferredVoice =
        voices.find((voice) => voice.lang.toLocaleLowerCase() === expectedLanguage && voice.name === 'Daniel') ||
        voices.find((voice) => voice.lang.toLocaleLowerCase() === expectedLanguage && voice.localService) ||
        voices.find((voice) => voice.lang.toLocaleLowerCase() === expectedLanguage)
      if (preferredVoice) utterance.voice = preferredVoice
      utterance.volume = pronunciationConfig.volume
      utterance.rate = pronunciationConfig.rate
      utterance.onstart = () => {
        if (utteranceRef.current !== utterance || playIdRef.current !== playId) return
        setIsPlaying(true)
        setStatus('fallback')
        void reportPronunciationEvent({
          event: 'fallback_started',
          word,
          pronunciation: pronunciationConfig.type,
          elapsedMs: Date.now() - startedAtRef.current,
          retryCount: 0,
        })
      }
      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return
        utteranceRef.current = undefined
        setIsPlaying(false)
        setStatus('idle')
      }
      utterance.onerror = () => {
        if (utteranceRef.current !== utterance) return
        utteranceRef.current = undefined
        setIsPlaying(false)
        setStatus('error')
        void reportPronunciationEvent({
          event: 'fallback_error',
          word,
          pronunciation: pronunciationConfig.type,
          elapsedMs: Date.now() - startedAtRef.current,
          retryCount: 0,
          error: 'speech-synthesis-error',
        })
      }
      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    }
    progressTimerRef.current = setTimeout(() => {
      if (audioRef.current !== audio || reportedPlayRef.current || audio.currentTime > 0.05) return
      setStatus('no-progress')
      console.warn('[pronunciation] audio made no playback progress', { word, soundUrl })
      void reportPronunciationEvent({
        event: 'playback_no_progress',
        word,
        pronunciation: pronunciationConfig.type,
        elapsedMs: Date.now() - startedAtRef.current,
        retryCount: 0,
        error: 'no-progress',
      })
      playFallback()
    }, 1500)

    const promise = audio.play()
    promise?.catch(() => {
      if (audioRef.current !== audio || playIdRef.current !== playId) return
      clearTimeout(loadingTimerRef.current)
      setStatus('error')
      console.warn('[pronunciation] online audio playback failed', { word, soundUrl })
      void reportPronunciationEvent({
        event: 'playback_error',
        word,
        pronunciation: pronunciationConfig.type,
        elapsedMs: Date.now() - startedAtRef.current,
        retryCount: 0,
        error: 'play-rejected',
      })
      playFallback()
    })
  }, [fallbackSoundUrl, pronunciationConfig.rate, pronunciationConfig.type, pronunciationConfig.volume, soundUrl, stop, word])

  return { play, stop, isPlaying, status }
}

export function usePrefetchPronunciationSound(word: string | undefined, localAudio?: LocalAudioSource) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const playbackLocalAudio = usePlaybackLocalAudio(localAudio)

  useEffect(() => {
    if (!word) return

    const played = playWordPronunciation({ name: word, localAudio: playbackLocalAudio }, pronunciationConfig.type)
    const soundUrl = played.startsWith('/local-pronunciation/') ? played : `${played}&prefetch=1`
    if (soundUrl === '') return

    const head = document.head
    const isPrefetch = (Array.from(head.querySelectorAll('audio[src]')) as HTMLAudioElement[]).some((el) => el.src === soundUrl)

    if (!isPrefetch) {
      const audio = new Audio()
      audio.src = soundUrl
      audio.preload = 'auto'

      // gpt 说这这两行能尽可能规避下载插件被触发问题。 本地测试不加也可以，考虑到别的插件可能有问题，所以加上保险
      audio.crossOrigin = 'anonymous'
      audio.style.display = 'none'

      head.appendChild(audio)

      return () => {
        head.removeChild(audio)
      }
    }
  }, [playbackLocalAudio, pronunciationConfig.type, word])
}
