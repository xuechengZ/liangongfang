import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })
const audit = JSON.parse(readFileSync(path.resolve('.data/local-pronunciation/ordered-refinement.json'), 'utf8'))
const targets = Object.entries(audit.records).filter(([, record]) => (record as { approvedByRecognition: boolean }).approvedByRecognition)

for (const [id, record] of targets) {
  test(`plays newly ordered-and-context-verified audio ${id}`, async ({ page }) => {
    expect(targets).toHaveLength(18)
    const [book, position] = id.split('-')
    const chapter = Number(book.slice(1))
    const index = Number(position)
    const words = JSON.parse(readFileSync(path.resolve(`public/dicts/IELTS_WANG_${chapter}.json`), 'utf8'))
    const word = words[index]
    expect(word.name).toBe((record as { word: string }).word)
    expect(word.localAudio).toBe(`ieltsWang${chapter}/${position}-original.mp3`)
    const hash = createHash('sha256').update(word.name).digest('hex')
    const events: Array<{ event: string; word: string }> = []
    const localResponses: string[] = []
    await page.addInitScript(
      ({ book, chapterIndex }) => {
        localStorage.setItem('currentDict', JSON.stringify(book))
        localStorage.setItem('currentChapter', JSON.stringify(chapterIndex))
      },
      { book: `ieltsWang${chapter}`, chapterIndex: Math.floor(index / 20) },
    )
    page.on('response', (response) => {
      if (!response.url().startsWith('http://127.0.0.1:8787/audio')) return
      if (new URL(response.url()).searchParams.get('localAudio') === word.localAudio) {
        localResponses.push(response.headers()['x-pronunciation-provider'])
      }
    })
    await page.route('http://127.0.0.1:8787/events', (route) => {
      events.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    })
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '开始' }).click()
    for (let offset = 0; offset < index % 20; offset += 1) await page.keyboard.press('Control+Shift+ArrowRight')
    await expect.poll(() => localResponses.includes('local')).toBe(true)
    await expect.poll(() => events.some((event) => event.event === 'played' && event.word === hash)).toBe(true)
    expect(events.some((event) => event.event === 'fallback_started' && event.word === hash)).toBe(false)
  })
}
