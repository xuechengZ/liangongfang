import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const origin = 'http://127.0.0.1:5190'
const words = JSON.parse(readFileSync('public/dicts/IELTS_WANG_3.json', 'utf8')).slice(0, 3)

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('currentDict')) {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', '0')
      localStorage.setItem('isTransVisible', 'false')
      localStorage.setItem('loopWordConfig', JSON.stringify({ times: 3 }))
      localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: true, type: 'hideAll', openBy: 'user' }))
    }
  })
  await context.route('https://**/*', route => route.abort())
  await context.route('**/dicts/IELTS_WANG_3.json', route => route.fulfill({ json: words }))
  await context.route('**/audio?**', route => route.fulfill({ contentType: 'audio/wav', body: readFileSync('public/sounds/correct.wav') }))
  await context.route('**/events', route => route.fulfill({ status: 204 }))
})

test('Chinese and its matched noun part of speech stay visible across three hidden dictation repetitions, without revealing the next word', async ({ page }) => {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  const current = page.locator('div[lang="en"]')
  const definition = current.locator('..').getByText('能力', { exact: true })
  const pos = current.locator('..').getByText('n.', { exact: true })
  await expect(definition).toHaveCount(0)
  await expect(pos).toHaveCount(0)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.type('ability', { delay: 15 })
    await expect(definition).toBeVisible()
    await expect(pos).toBeVisible()
    if (i < 2) {
      await page.waitForTimeout(1200)
      await expect(definition).toBeVisible()
      await expect(pos).toBeVisible()
      await expect(current.locator('.tooltip-info > div').first()).toHaveText('_______')
    }
  }
  await expect(current.locator('.tooltip-info > div').first()).toHaveText('________')
  await expect(definition).toHaveCount(0)
  await expect(pos).toHaveCount(0)
  await expect(page.getByText('摘要', { exact: true })).toHaveCount(0)
  await expect(page.getByText('能力', { exact: true })).toBeVisible()
  await expect(page.getByText('n.', { exact: true })).toBeVisible()
})

test('adjective meanings show adj and unsupported phrase meanings explicitly show missing part of speech', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('currentDict', JSON.stringify('ieltsWang4')); localStorage.setItem('isTransVisible', 'true') })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  const current = page.locator('div[lang="en"]')
  await expect(current.locator('..').getByText('adj.', { exact: true })).toBeVisible()
  await expect(current.locator('..').getByText('不正常的', { exact: true })).toBeVisible()
  await page.route('**/dicts/IELTS_WANG_5.json', route => route.fulfill({ json: [{ name: 'unmatched test phrase', trans: ['短语释义'], usphone: '', ukphone: '' }] }))
  await page.addInitScript(() => { localStorage.setItem('currentDict', JSON.stringify('ieltsWang5')); localStorage.setItem('isTransVisible', 'true') })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(current.locator('..').getByText('词性待补充', { exact: true })).toBeVisible()
})
