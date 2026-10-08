import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })
const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
  .slice(0, 40)
  .map((word: { name: string; trans: string[] }, index: number) => ({ ...word, trans: [`听写释义${index}`] }))
const url = 'http://127.0.0.1:5173/'

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('currentDict')) {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', JSON.stringify(0))
      localStorage.setItem('isTransVisible', 'false')
      localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: false, type: 'hideAll', openBy: 'user' }))
    }
  })
  await context.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  const audio = readFileSync(path.resolve('public/sounds/correct.wav'))
  await context.route('http://127.0.0.1:8787/audio**', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: audio }))
  await context.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.locator('div[lang="en"]')).toContainText(words[0].name)
})

test('future preview hides English and Chinese even when word dictation is off', async ({ page }) => {
  await expect(page.getByText(words[1].name, { exact: true })).toHaveCount(0)
  await expect(page.getByText('听写释义1', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /开关释义显示/ }).click()
  await expect(page.getByText(words[1].name, { exact: true })).toBeVisible()
  await expect(page.getByText('听写释义1', { exact: true })).toBeVisible()
})

test('correct answer briefly reveals its definition, then keeps it only in the previous preview', async ({ page }) => {
  const current = page.locator('div[lang="en"]')
  await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(current).toContainText(words[0].name)
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await expect(current).toContainText(words[1].name)
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toHaveCount(0)
  await expect(page.getByText('听写释义0', { exact: true })).toBeVisible()
  await expect(page.getByText('听写释义1', { exact: true })).toHaveCount(0)
  await expect(page.getByText(words[2].name, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('isTransVisible'))).toBe('false')
})

test('wrong or unfinished answers do not reveal a definition, and feedback ignores extra typing', async ({ page }) => {
  const current = page.locator('div[lang="en"]')
  await page.keyboard.press('x')
  await page.waitForTimeout(400)
  await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.type(words[0].name.slice(0, -1), { delay: 15 })
  await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.type(words[0].name.slice(-1))
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await page.keyboard.press('x')
  await page.waitForTimeout(100)
  await expect(current.locator('.tooltip-info > div').first()).not.toHaveClass(/wrong/)
  await expect(current).toContainText(words[1].name)
})

test('skipping during feedback cancels its timer and revisiting does not reveal or auto-advance', async ({ page }) => {
  const current = page.locator('div[lang="en"]')
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+Shift+ArrowRight')
  await expect(current).toContainText(words[1].name)
  await expect(page.getByText('听写释义1', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+Shift+ArrowLeft')
  await expect(current).toContainText(words[0].name)
  await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(1200)
  await expect(current).toContainText(words[0].name)
})

test('repeated practice clears feedback before each new attempt', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('loopWordConfig', JSON.stringify({ times: 3 })))
  await page.reload()
  await page.getByRole('button', { name: '开始' }).click()
  const current = page.locator('div[lang="en"]')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
    await page.keyboard.type(words[0].name, { delay: 15 })
    await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
    await expect(current.locator('..').getByText('听写释义0', { exact: true })).toHaveCount(0)
    await expect(current).toContainText(words[attempt === 2 ? 1 : 0].name)
  }
})

test('last word shows feedback before finishing and next chapter starts without old definitions', async ({ page }) => {
  for (let index = 0; index < 19; index += 1) await page.keyboard.press('Control+Shift+ArrowRight')
  const current = page.locator('div[lang="en"]')
  await page.keyboard.type(words[19].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义19', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一章节', exact: true }).click()
  await expect(current).toContainText(words[20].name)
  await expect(page.getByText('听写释义19', { exact: true })).toHaveCount(0)
  await expect(page.getByText('听写释义20', { exact: true })).toHaveCount(0)
  await expect(page.getByText(words[21].name, { exact: true })).toHaveCount(0)
})

test('enabled translations retain immediate advancement', async ({ page }) => {
  await page.getByRole('button', { name: /开关释义显示/ }).click()
  await expect(page.getByText('听写释义0', { exact: true })).toBeVisible()
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(page.locator('div[lang="en"]')).toContainText(words[1].name, { timeout: 750 })
  await expect(page.getByText('听写释义1', { exact: true })).toBeVisible()
})

test('restarting during feedback cancels its pending advancement and resets the answer', async ({ page }) => {
  const current = page.locator('div[lang="en"]')
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停', exact: true }).hover()
  await page.getByRole('button', { name: '重新开始', exact: true }).click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1200)
  await expect(current).toContainText(words[0].name)
  await expect(page.getByText('听写释义0', { exact: true })).toHaveCount(0)
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
})

test('pausing during feedback does not advance until typing resumes', async ({ page }) => {
  const current = page.locator('div[lang="en"]')
  await page.keyboard.type(words[0].name, { delay: 15 })
  await expect(current.locator('..').getByText('听写释义0', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  await expect(current).toContainText(words[0].name)
  await page.keyboard.press('Enter')
  await expect(current).toContainText(words[1].name)
})

test('dictation mode shows only the completed word and keeps the new answer masked', async ({ page }) => {
  await page.keyboard.press('Control+V')
  const current = page.locator('div[lang="en"]')
  await expect(current.locator('.tooltip-info > div').first()).toHaveText('_______')
  await page.keyboard.type(words[0].name, { delay: 15 })
  const definition = current.locator('..').getByText('听写释义0', { exact: true })
  await expect(definition).toBeVisible()
  await expect(definition).toHaveCount(0)
  await expect(current.locator('.tooltip-info > div').first()).toHaveText('________')
  await expect(page.getByText('听写释义0', { exact: true })).toBeVisible()
  await expect(page.getByText('听写释义1', { exact: true })).toHaveCount(0)
  await expect(page.getByText(words[2].name, { exact: true })).toHaveCount(0)
})
