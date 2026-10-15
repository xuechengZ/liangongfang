import { getRankedDynamicWords } from './dynamic-words'
import Layout from '@/components/Layout'
import { DYNAMIC_DICT_ID } from '@/constants'
import { enterReviewMode, setCurrentSelection } from '@/features/dictionary'
import { idDictionaryMap } from '@/resources/dictionary'
import { wordDictationConfigAtom } from '@/store'
import { ReviewRecord } from '@/utils/db/record'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSetAtom } from 'jotai'
import { Link, useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

export default function DynamicWordBook() {
  const entries = useLiveQuery(getRankedDynamicWords)
  const setDictation = useSetAtom(wordDictationConfigAtom)
  const navigate = useNavigate()

  const startPractice = async () => {
    // Freeze this round's list: deleting mastered words must not shift the active word index.
    const pending = await getRankedDynamicWords()
    if (!pending.length) return
    const reviewRecord = new ReviewRecord(
      DYNAMIC_DICT_ID,
      pending.map((entry) => ({ ...entry.word, sourceDict: entry.dict })),
    )
    setCurrentSelection({ dictId: DYNAMIC_DICT_ID, chapter: 0 })
    enterReviewMode(reviewRecord)
    setDictation((old) => ({ ...old, isOpen: true, type: 'hideAll', openBy: 'user' }))
    navigate('/')
  }

  return (
    <Layout>
      <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-8 pt-16 dark:text-gray-300">
        <button
          type="button"
          aria-label="关闭错词排行"
          title="关闭错词排行"
          className="absolute right-8 top-6 text-gray-400 hover:text-indigo-500"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))}
        >
          <IconX className="h-7 w-7" />
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">错词排行</h1>
          <Link to="/gallery" className="text-indigo-500 hover:underline">
            选择其它词书
          </Link>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          其它英语词书中拼错的词自动收录；默写时若始终没看答案，中途打错再改对不会收录。同一拼写只保留一次，按累计拼写错误次数从高到低默写。在这里默写时，只要没看过答案并最终拼对就会移除（中途打错也算）；看过答案、跳过或未完成则保留。历史记录不删除。
        </p>
        <div className="my-6 flex items-center justify-between">
          <span role="status">{entries ? `待复习 ${entries.length} 词` : '加载中…'}</span>
          <button className="my-btn-primary disabled:opacity-50" disabled={!entries?.length} onClick={startPractice}>
            开始默写
          </button>
        </div>
        {entries?.length === 0 && <p className="py-12 text-center text-gray-500">暂无待复习单词</p>}
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {entries?.map((entry) => (
            <li key={entry.name} className="py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-lg font-medium">{entry.word.name}</span>
                <span className="text-xs text-gray-500">
                  错 {entry.wrongCount} 次 · {idDictionaryMap[entry.dict]?.name ?? entry.dict}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{entry.word.trans.join('；')}</p>
            </li>
          ))}
        </ul>
      </div>
    </Layout>
  )
}
