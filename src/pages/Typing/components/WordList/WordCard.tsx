import { TypingContext, TypingStateActionType } from '../../store'
import type { WordPronunciationIconRef } from '@/features/pronunciation'
import { WordPronunciationIcon } from '@/features/pronunciation'
import { currentDictInfoAtom } from '@/store'
import type { Word } from '@/typings'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect, useRef } from 'react'

export default function WordCard({ word, isActive, index, isOpen }: { word: Word; isActive: boolean; index: number; isOpen: boolean }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { dispatch } = useContext(TypingContext)!
  const cardRef = useRef<HTMLDivElement>(null)
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)
  const currentLanguage = useAtomValue(currentDictInfoAtom).language

  useEffect(() => {
    if (!isOpen || !cardRef.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        dispatch({ type: TypingStateActionType.MARK_WORD_ANSWER_SEEN, index })
        observer.disconnect()
      }
    })
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [dispatch, index, isOpen])

  const handlePlay = useCallback(() => {
    wordPronunciationIconRef.current?.play()
  }, [])

  return (
    <div
      ref={cardRef}
      className={`mb-2 flex cursor-pointer select-text items-center rounded-xl p-4 shadow focus:outline-none ${
        isActive ? 'bg-indigo-50 dark:bg-indigo-800 dark:bg-opacity-20' : 'bg-white dark:bg-gray-700 dark:bg-opacity-20'
      }   `}
      key={word.name}
      onClick={handlePlay}
    >
      <div className="flex-1">
        <p className="select-all font-mono text-xl font-normal leading-6 dark:text-gray-50">
          {['romaji', 'hapin'].includes(currentLanguage) ? word.notation : word.name}
        </p>
        <div className="mt-2 max-w-sm font-sans text-sm text-gray-400">{word.trans.join('；')}</div>
      </div>
      <WordPronunciationIcon word={word} lang={currentLanguage} className="h-8 w-8" ref={wordPronunciationIconRef} />
    </div>
  )
}
