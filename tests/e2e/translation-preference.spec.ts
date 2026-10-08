import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })
const url = 'http://127.0.0.1:5173/'
const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
  .slice(0, 40)
  .map((word: { name: string; trans: string[] }, index: number) => ({ ...word, trans: [`测试释义${index}`] }))

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('currentDict')) {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', JSON.stringify(0))
    }
  })
  await context.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  const audio = readFileSync(path.resolve('public/sounds/correct.wav'))
  await context.route('http://127.0.0.1:8787/audio**', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: audio }))
  await context.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByText('测试释义0', { exact: true })).toBeVisible()
})

test('mouse choice survives next word, chapter selection, reload and reopening a tab', async ({ page, context }) => {
  const toggle = page.getByRole('button', { name: /开关释义显示/ })
  await toggle.click()
  await expect(page.getByText('测试释义0', { exact: true })).toHaveCount(0)
  await expect(page.getByText('测试释义1', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+Shift+ArrowRight')
  await expect(page.getByText('测试释义1', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '第 1 章', exact: true }).click()
  await page.getByRole('option', { name: '第 2 章', exact: true }).click()
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByRole('button', { name: '第 2 章', exact: true })).toBeVisible()
  await expect(page.getByText('测试释义20', { exact: true })).toHaveCount(0)
  await expect(page.getByText('测试释义21', { exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByText('测试释义20', { exact: true })).toHaveCount(0)
  const reopened = await context.newPage()
  await page.close()
  await reopened.goto(url, { waitUntil: 'domcontentloaded' })
  await reopened.getByRole('button', { name: '开始' }).click()
  await expect(reopened.getByText('测试释义20', { exact: true })).toHaveCount(0)
  await reopened.getByRole('button', { name: /开关释义显示/ }).click()
  await expect(reopened.getByText('测试释义20', { exact: true })).toBeVisible()
  await reopened.reload()
  await reopened.getByRole('button', { name: '开始' }).click()
  await expect(reopened.getByText('测试释义20', { exact: true })).toBeVisible()
})

test('keyboard toggles persist and temporary Tab reveal does not enable the saved preference', async ({ page }) => {
  await page.keyboard.press('Control+Shift+V')
  await expect(page.getByText('测试释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.down('Tab')
  await expect(page.getByText('测试释义0', { exact: true })).toBeVisible()
  await page.keyboard.up('Tab')
  await expect(page.getByText('测试释义0', { exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByText('测试释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+Shift+V')
  await expect(page.getByText('测试释义0', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+Shift+V')
  await expect(page.getByText('测试释义0', { exact: true })).toHaveCount(0)
})

test('finishing a chapter and choosing next chapter preserves hidden translations', async ({ page }) => {
  await page.getByRole('button', { name: /开关释义显示/ }).click()
  for (let index = 0; index < 19; index += 1) await page.keyboard.press('Control+Shift+ArrowRight')
  await page.keyboard.type(words[19].name, { delay: 15 })
  await page.getByRole('button', { name: '下一章节', exact: true }).click()
  await expect(page.getByRole('button', { name: '第 2 章', exact: true })).toBeVisible()
  await expect(page.locator('div[lang="en"]')).toContainText(words[20].name)
  // New chapter setup can pause typing; this preference must be independent of pause state.
  await expect(page.getByText('测试释义20', { exact: true })).toHaveCount(0)
})
