import type React from 'react'
import { Link } from 'react-router-dom'

const Footer: React.FC = () => {
  return (
    <footer className="mb-1 mt-4 flex w-full flex-wrap items-center justify-center gap-2.5 text-sm ease-in" onClick={(e) => e.currentTarget.blur()}>
      <Link to="/dynamic-wordbook" className="text-indigo-500 hover:underline">
        错词排行
      </Link>
      <span className="text-gray-500 dark:text-gray-400">阿成的练功房</span>
      <a href="https://github.com/RealKai42/qwerty-learner" target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:underline">
        基于 Qwerty Learner · GPLv3
      </a>
      <span className="select-none rounded bg-slate-200 px-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        Build <span className="select-all">{LATEST_COMMIT_HASH}</span>
      </span>
    </footer>
  )
}

export default Footer
