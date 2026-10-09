import { TypingContext, TypingStateActionType } from '../../store'
import Tooltip from '@/components/Tooltip'
import { currentDictInfoAtom, isTransVisibleAtom, wordDictationConfigAtom } from '@/store'
import { CTRL } from '@/utils'
import { getWordPartOfSpeech } from '@/utils/wordPartOfSpeech'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect, useMemo } from 'react'
import IconPrev from '~icons/tabler/arrow-narrow-left'
import IconNext from '~icons/tabler/arrow-narrow-right'

export default function PrevAndNextWord({ type }: LastAndNextWordProps) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!

  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const isTransVisible = useAtomValue(isTransVisibleAtom)
  const newIndex = useMemo(() => state.chapterData.index + (type === 'prev' ? -1 : 1), [state.chapterData.index, type])
  const word = state.chapterData.words[newIndex]
  const shortCutKey = useMemo(() => (type === 'prev' ? `${CTRL} + Shift + ArrowLeft` : `${CTRL} + Shift + ArrowRight`), [type])
  const currentLanguage = useAtomValue(currentDictInfoAtom).language
  const partOfSpeech = word && getWordPartOfSpeech(word, currentLanguage)

  const onClickWord = useCallback(() => {
    if (!word) return

    if (type === 'prev') dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex })
    if (type === 'next') dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex })
  }, [type, dispatch, newIndex, word])

  const headWord = useMemo(() => {
    if (!word || (type === 'next' && !isTransVisible)) return ''

    const showWord = ['romaji', 'hapin'].includes(currentLanguage) ? word.notation : word.name

    if (type === 'prev') return showWord

    if (type === 'next') {
      return !wordDictationConfig.isOpen ? showWord : (showWord || '').replace(/./g, '_')
    }
  }, [word, currentLanguage, type, wordDictationConfig.isOpen, isTransVisible])

  useEffect(() => {
    if (state.isTyping && headWord && (type === 'prev' || !wordDictationConfig.isOpen)) {
      dispatch({ type: TypingStateActionType.MARK_WORD_ANSWER_SEEN, index: newIndex })
    }
  }, [
    dispatch,
    headWord,
    newIndex,
    state.isTyping,
    state.chapterData.userInputLogs[newIndex]?.answerSeen,
    type,
    wordDictationConfig.isOpen,
  ])

  return (
    <>
      {word ? (
        <Tooltip content={`快捷键: ${shortCutKey}`}>
          <div
            onClick={onClickWord}
            className="flex max-w-xs cursor-pointer select-none items-center text-gray-700 opacity-60 duration-200 ease-in-out hover:opacity-100 dark:text-gray-400"
          >
            {type === 'prev' && <IconPrev className="mr-4 shrink-0 grow-0 text-2xl" />}

            <div className={`grow-1 flex w-full flex-col ${type === 'next' ? 'items-end text-right' : ''}`}>
              <p
                className={`font-mono text-2xl font-normal text-gray-700 dark:text-gray-400 ${
                  !wordDictationConfig.isOpen ? 'tracking-normal' : 'tracking-wider'
                }`}
              >
                {headWord}
              </p>
              {(isTransVisible || type === 'prev') && (
                <p className="line-clamp-1 max-w-full text-sm font-normal text-gray-600 dark:text-gray-500">
                  {partOfSpeech && <span className="mr-2">{partOfSpeech}</span>}
                  <span>{word.trans.join('；')}</span>
                </p>
              )}
            </div>
            {type === 'next' && <IconNext className="ml-4 shrink-0 grow-0 text-2xl" />}
          </div>
        </Tooltip>
      ) : (
        <div />
      )}
    </>
  )
}

export type LastAndNextWordProps = {
  /** 上一个单词还是下一个单词 */
  type: 'prev' | 'next'
}
