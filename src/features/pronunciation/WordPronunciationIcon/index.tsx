import { SoundIcon } from './SoundIcon'
import usePronunciationSound from '../usePronunciation'
import type { Word } from '@/typings'
import { useCallback, useEffect, useImperativeHandle } from 'react'
import React from 'react'

export const WordPronunciationIcon = React.forwardRef<
  WordPronunciationIconRef,
  { word: Word; lang: string; className?: string; iconClassName?: string }
>(({ word, lang, className, iconClassName }, ref) => {
  const currentWord = () => {
    if (lang === 'hapin') {
      if (/[\u0400-\u04FF]/.test(word.notation || '')) {
        // 哈萨克语西里尔文字
        return word.notation || ''
      } else {
        // 哈萨克语老文字
        return word.trans[2]
      }
    } else {
      return word.name
    }
  }
  const { play, stop, isPlaying, status } = usePronunciationSound(currentWord(), undefined, word.localAudio)

  const playSound = useCallback(() => {
    stop()
    play()
  }, [play, stop])

  useEffect(() => {
    return stop
  }, [word, stop])

  useImperativeHandle(
    ref,
    () => ({
      play: playSound,
    }),
    [playSound],
  )

  const statusText =
    status === 'loading'
      ? '发音加载中…'
      : status === 'fallback'
        ? '在线发音较慢，已切换系统语音'
        : status === 'no-progress'
          ? '音频未开始播放，点击重试'
          : status === 'error'
            ? '发音加载失败，点击重试'
            : ''

  return (
    <>
      <SoundIcon
        animated={isPlaying}
        onClick={playSound}
        title={statusText || '播放发音'}
        className={`cursor-pointer text-gray-600 ${className}`}
        iconClassName={iconClassName}
      />
      {statusText && <span className="pointer-events-none absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap text-[10px] text-gray-400">{statusText}</span>}
    </>
  )
})

WordPronunciationIcon.displayName = 'WordPronunciationIcon'

export type WordPronunciationIconRef = {
  play: () => void
}
