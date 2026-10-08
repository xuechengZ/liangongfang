import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })
const url = 'http://127.0.0.1:5173/'
const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8')).slice(0, 20)

async function tableRows(page: Page, table: string) {
  return page.evaluate(
    (table) =>
      new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open('RecordDB')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const connection = request.result
          const query = connection.transaction(table).objectStore(table).getAll()
          query.onerror = () => {
            connection.close()
            reject(query.error)
          }
          query.onsuccess = () => {
            connection.close()
            resolve(query.result)
          }
        }
      }),
    table,
  )
}
async function entries(page: Page) {
  return tableRows(page, 'dynamicWords')
}
async function mistake(page: Page) {
  await page.keyboard.press('x')
  await page.waitForTimeout(400)
}
async function openBook(page: Page) {
  await page.getByRole('link', { name: '动态词本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '动态词本' })).toBeVisible()
}
async function practice(page: Page) {
  await openBook(page)
  await page.getByRole('button', { name: '开始默写' }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"] .tooltip-info > div').first()).toHaveText('_'.repeat(7))
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('currentDict')) {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', '0')
      localStorage.setItem('isTransVisible', 'true')
      localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: false, type: 'hideAll', openBy: 'user' }))
    }
  })
  await context.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  await context.route('**/dicts/IELTS_WANG_4.json', (route) => route.fulfill({ json: words }))
  await context.route('http://127.0.0.1:8787/audio**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: readFileSync(path.resolve('public/sounds/correct.wav')) }),
  )
  await context.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"]')).toContainText('ability')
})

test('first typo is collected even if skipped, deduplicated, and persisted with local pronunciation', async ({ page }) => {
  await mistake(page)
  await mistake(page)
  await page.keyboard.press('Control+Shift+ArrowRight')
  await expect(page.locator('div[lang="en"]')).toContainText('abstract')
  await openBook(page)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('listitem')).toContainText('ability')
  await expect(page.getByRole('listitem')).toContainText(words[0].trans[0])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('listitem')).toHaveCount(1)
  const stored = await entries(page)
  expect(stored[0].word.localAudio).toBe(words[0].localAudio)
  expect(stored[0].dict).toBe('ieltsWang3')
})

test('mastering removes only membership, retains history, and does not skip the next word', async ({ page }) => {
  await mistake(page)
  await page.keyboard.type('ability', { delay: 15 })
  await expect(page.locator('div[lang="en"]')).toContainText('abstract')
  await mistake(page)
  await practice(page)
  await page.keyboard.type('ability', { delay: 15 })
  await expect.poll(async () => (await entries(page)).map((row) => row.word.name)).toEqual(['abstract'])
  await expect(page.locator('div[lang="en"] .tooltip-info > div').first()).toHaveText('________')
  await page.keyboard.type('abstract', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
  const history = (await tableRows(page, 'wordRecords')).filter((row) => row.word === 'ability' && row.dict === 'ieltsWang3')
  expect(history).toHaveLength(2)
  expect(history[0].wrongCount).toBeGreaterThan(0)
})

test('wrong then corrected dictation stays in the book; a new clean attempt removes it', async ({ page }) => {
  await mistake(page)
  await practice(page)
  await mistake(page)
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: '开始默写' }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
})

test('visible spelling practice inside the dynamic book does not remove membership', async ({ page }) => {
  await mistake(page)
  await practice(page)
  await page.keyboard.press('Control+v')
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
})

test('turning dictation on after visible input does not count as a clean dictation attempt', async ({ page }) => {
  await mistake(page)
  await practice(page)
  await page.keyboard.press('Control+v')
  await page.keyboard.type('a')
  await page.keyboard.press('Control+v')
  await page.keyboard.type('bility', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
})

test('correct spelling elsewhere does not remove it, and later mistakes recollect mastered words', async ({ page }) => {
  await mistake(page)
  await page.keyboard.type('ability', { delay: 15 })
  await expect(page.locator('div[lang="en"]')).toContainText('abstract')
  await page.keyboard.press('Control+Shift+ArrowLeft')
  await page.keyboard.type('ability', { delay: 15 })
  await expect(page.locator('div[lang="en"]')).toContainText('abstract')
  await practice(page)
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: false }))
    localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: false, type: 'hideAll', openBy: 'user' }))
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"]')).toContainText('ability')
  await mistake(page)
  await openBook(page)
  await expect(page.getByRole('listitem')).toHaveCount(1)
})

test('same spelling in different English dictionaries remains one entry', async ({ page }) => {
  await mistake(page)
  await page.evaluate(() => localStorage.setItem('currentDict', JSON.stringify('ieltsWang4')))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"]')).toContainText('ability')
  await mistake(page)
  await openBook(page)
  await expect(page.getByRole('listitem')).toHaveCount(1)
})

test('empty book cannot start a session and offers dictionary selection', async ({ page }) => {
  await openBook(page)
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始默写' })).toBeDisabled()
  await page.getByRole('link', { name: '选择其它词书' }).click()
  await expect(page).toHaveURL(/\/gallery$/)
})

test('reload keeps the remaining word in a frozen session after removing the first word', async ({ page }) => {
  await mistake(page)
  await page.keyboard.press('Control+Shift+ArrowRight')
  await expect(page.locator('div[lang="en"]')).toContainText('abstract')
  await mistake(page)
  await practice(page)
  await page.keyboard.type('ability', { delay: 15 })
  await expect(page.locator('div[lang="en"] .tooltip-info > div').first()).toHaveText('________')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"] .tooltip-info > div').first()).toHaveText('________')
  await page.keyboard.type('abstract', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
})

test('retains the original provisional audio warning inside dynamic practice', async ({ page, context }) => {
  await context.unroute('**/dicts/IELTS_WANG_3.json')
  await context.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: [{ ...words[0], localAudioUncertain: true }] }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="en"]')).toContainText('ability')
  await mistake(page)
  await practice(page)
  await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
})

test('non-English spelling mistakes do not enter the English dynamic book', async ({ page, context }) => {
  await context.route('**/dicts/german2en.json', (route) =>
    route.fulfill({ json: [{ name: 'hallo', trans: ['你好'], usphone: '', ukphone: '' }] }),
  )
  await page.evaluate(() => localStorage.setItem('currentDict', JSON.stringify('german2en')))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.locator('div[lang="de"]')).toContainText('hallo')
  await mistake(page)
  await openBook(page)
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
})

test('upgrading an existing v3 database preserves historical records and adds an empty dynamic book', async ({ page }) => {
  await page.route('**/?seed', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Database setup</body></html>' }))
  await page.goto(url + '?seed')
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase('RecordDB')
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => reject(deletion.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB', 30)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        const schema = {
          wordRecords: ['word', 'timeStamp', 'dict', 'chapter', 'wrongCount', '[dict+chapter]'],
          chapterRecords: ['timeStamp', 'dict', 'chapter', 'time', '[dict+chapter]'],
          reviewRecords: ['dict', 'createTime', 'isFinished'],
        }
        for (const [table, indexes] of Object.entries(schema)) {
          const store = request.result.createObjectStore(table, { keyPath: 'id', autoIncrement: true })
          for (const index of indexes) store.createIndex(index, index === '[dict+chapter]' ? ['dict', 'chapter'] : index)
        }
        request.transaction!.objectStore('wordRecords').add({
          word: 'ability',
          dict: 'ieltsWang3',
          chapter: 0,
          timeStamp: 123,
          wrongCount: 2,
          timing: [120],
          mistakes: { 0: ['x'] },
        })
        request.transaction!.objectStore('chapterRecords').add({ dict: 'ieltsWang3', chapter: 0, timeStamp: 123, time: 42 })
        request
          .transaction!.objectStore('reviewRecords')
          .add({ dict: 'ieltsWang3', createTime: 123, isFinished: false, index: 0, words: [] })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
  })
  await page.goto(url + 'dynamic-wordbook', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
  expect(await tableRows(page, 'wordRecords')).toMatchObject([{ word: 'ability', wrongCount: 2, timing: [120] }])
  expect(await tableRows(page, 'chapterRecords')).toMatchObject([{ time: 42 }])
  expect(await tableRows(page, 'reviewRecords')).toMatchObject([{ index: 0, isFinished: false }])
})

test('dynamic practice mistakes remain readable in the original historical error book after mastery', async ({ page }) => {
  await mistake(page)
  await practice(page)
  await mistake(page)
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await page.getByRole('button', { name: '开始默写' }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.keyboard.type('ability', { delay: 15 })
  await page.getByRole('button', { name: '返回动态词本' }).click()
  await expect(page.getByText('暂无待复习单词')).toBeVisible()
  await page.goto(url + 'error-book', { waitUntil: 'domcontentloaded' })
  const row = page.getByRole('listitem').filter({ hasText: 'ability' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(words[0].trans[0])
  await expect(row).toContainText('雅思wang C3')
})
