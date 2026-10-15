import { generateNewWordReviewRecord, useGetLatestReviewRecord } from '../review-record'
import { Button } from '@/components/ui/button'
import { enterReviewMode, setCurrentSelection } from '@/features/dictionary'
import type { TErrorWordData } from '@/features/error-book'
import type { Dictionary } from '@/typings'
import { timeStamp2String } from '@/utils'
import * as Progress from '@radix-ui/react-progress'
import { useNavigate } from 'react-router-dom'
import MdiRobotAngry from '~icons/mdi/robot-angry'

export function ReviewDetail({ errorData, dict }: { errorData: TErrorWordData[]; dict: Dictionary }) {
  const latestReviewRecord = useGetLatestReviewRecord(dict.id)
  const navigate = useNavigate()

  const startReview = async () => {
    setCurrentSelection({ dictId: dict.id, chapter: -1 })

    const record = await generateNewWordReviewRecord(dict.id, errorData)
    enterReviewMode(record)
    navigate('/')
  }

  const continueReview = () => {
    setCurrentSelection({ dictId: dict.id, chapter: -1 })

    enterReviewMode(latestReviewRecord)
    navigate('/')
  }

  return (
    <div className="flex h-full flex-col items-center justify-around px-60">
      <div>
        <MdiRobotAngry fontSize={30} className="text-indigo-300 " />
        <blockquote>
          <p className="text-lg font-medium text-gray-600 dark:text-gray-300">
            我们将使用您在该词典的历史练习数据、错误次数、练习时间来智能生成练习列表
            <br />
            目前该生成方式还处于实验阶段，我们会逐步完善该生成方式
          </p>
        </blockquote>
      </div>
      <div className="flex w-full flex-col items-center">
        {latestReviewRecord && (
          <>
            <div className=" ml-10 flex w-full items-center py-0">
              <Progress.Root
                value={latestReviewRecord.index + 1}
                max={latestReviewRecord.words.length}
                className="mr-4 h-2 w-full rounded-full border  border-indigo-400 bg-white"
              >
                <Progress.Indicator
                  className="h-full rounded-full bg-indigo-400 pl-0"
                  style={{ width: `calc(${((latestReviewRecord.index + 1) / latestReviewRecord.words.length) * 100}% )` }}
                />
              </Progress.Root>
              <span className="p-0 text-xs">
                {latestReviewRecord.index + 1}/{latestReviewRecord.words.length}
              </span>
            </div>
            <div className="mt-1 text-sm font-normal text-gray-500">{`( 创建于 ${timeStamp2String(latestReviewRecord.createTime)} )`}</div>
          </>
        )}

        {!latestReviewRecord && <div>当前词典错词数: {errorData.length}</div>}

        <div className="mt-6 flex gap-10">
          {latestReviewRecord && (
            <Button size="sm" onClick={continueReview}>
              继续当前进度
            </Button>
          )}
          <Button size="sm" onClick={startReview}>
            开始{latestReviewRecord && '新的'}复习
          </Button>
        </div>
      </div>
    </div>
  )
}
