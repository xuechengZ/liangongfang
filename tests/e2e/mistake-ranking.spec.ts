import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const origin = 'http://127.0.0.1:5190'
const words = JSON.parse(readFileSync('public/dicts/IELTS_WANG_3.json', 'utf8')).slice(0, 3)

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('currentDict')) {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', '0')
      localStorage.setItem('isTransVisible', 'true')
    }
  })
  await context.route('**/dicts/IELTS_WANG_3.json', route => route.fulfill({ json: words }))
  await context.route('https://**/*', route => route.abort())
  await context.route('**/audio?**', route => route.fulfill({ contentType: 'audio/wav', body: readFileSync('public/sounds/correct.wav') }))
  await context.route('**/events', route => route.fulfill({ status: 204 }))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeVisible()
})

test('legacy mistakes rank by cumulative count and the frozen dictation follows that order', async ({ page }) => {
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.keyboard.press('x')
  await page.waitForTimeout(400)
  await page.evaluate(words => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('RecordDB')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['dynamicWords', 'wordRecords'], 'readwrite')
      tx.objectStore('dynamicWords').clear()
      tx.objectStore('wordRecords').clear()
      for (const [i, count] of [2, 5, 5].entries()) {
        tx.objectStore('dynamicWords').put({ name: words[i].name, word: words[i], dict: 'ieltsWang3', timeStamp: i + 1 })
        tx.objectStore('wordRecords').add({ word: words[i].name, dict: 'ieltsWang3', wrongCount: count, chapter: 0, timeStamp: 1, timing: [], mistakes: {} })
      }
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  }), words)
  await page.evaluate(() => localStorage.setItem('randomConfig', JSON.stringify({ isOpen: true })))
  await page.context().addInitScript(() => { Math.random = () => 0.99 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '错词排行', exact: true }).click()
  await expect(page.getByRole('heading', { name: '错词排行' })).toBeVisible()
  const rows = page.getByRole('listitem')
  await expect(rows.nth(0)).toContainText('abstract')
  await expect(rows.nth(0)).toContainText('错 5 次')
  await expect(rows.nth(1)).toContainText('accountant')
  await expect(rows.nth(2)).toContainText('ability')
  await page.getByRole('button', { name: '开始默写' }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  const current = page.locator('div[lang="en"] .tooltip-info > div').first()
  await expect(current).toHaveText('________')
  await page.getByRole('button', { name: '暂停', exact: true }).hover()
  await page.getByRole('button', { name: '重新开始', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
  await expect(current).toHaveText('________')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('randomConfig')!).isOpen)).toBe(true)
  await page.keyboard.type('abstract', { delay: 15 })
  await expect(current).toHaveText('__________')
  await page.getByRole('link', { name: '错词排行', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('accountant')
})

test('mistakes are counted even when skipped and closing returns to the previous page', async ({ page }) => {
  await page.getByRole('button', { name: '开始', exact: true }).click()
  for (let i = 0; i < 2; i++) { await page.keyboard.press('x'); await page.waitForTimeout(400) }
  await page.keyboard.press('Control+Shift+ArrowRight')
  for (let i = 0; i < 3; i++) { await page.keyboard.press('x'); await page.waitForTimeout(400) }
  await page.getByRole('link', { name: '错词排行', exact: true }).click()
  await expect(page.getByRole('listitem').first()).toContainText('abstract')
  await expect(page.getByRole('listitem').first()).toContainText('错 3 次')
  await expect(page.getByRole('listitem').nth(1)).toContainText('错 2 次')
  await page.getByRole('button', { name: '关闭错词排行' }).click()
  await expect(page).toHaveURL(`${origin}/`)
  await page.goto(`${origin}/gallery`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '错词排行', exact: true }).click()
  await page.getByRole('button', { name: '关闭错词排行' }).click()
  await expect(page).toHaveURL(`${origin}/gallery`)
})

test('direct opening can close to the practice page instead of leaving the website', async ({ page }) => {
  await page.goto(`${origin}/dynamic-wordbook`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '关闭错词排行' }).click()
  await expect(page).toHaveURL(`${origin}/`)
})
