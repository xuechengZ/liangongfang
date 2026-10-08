import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

test.use({ channel: 'chrome' })
const url = `http://127.0.0.1:5173/@fs${path.resolve('.data/local-pronunciation/review/index.html')}`

test('review decisions survive reload and export only explicitly reviewed words', async ({ page }) => {
  await page.goto(url)
  await expect(page.getByRole('heading', { name: '本地音频待确认' })).toBeVisible()
  const card = page.locator('[data-review-id]').first()
  const id = await card.getAttribute('data-review-id')
  await card.getByRole('button', { name: '确认此片段' }).first().click()
  await expect(card.getByText('已确认候选', { exact: true })).toBeVisible()
  await page.reload()
  await page.locator('#status').selectOption('confirmed')
  await expect(page.locator('[data-review-id]')).toHaveCount(1)
  await expect(page.locator('[data-review-id]')).toHaveAttribute('data-review-id', id!)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出确认结果' }).click()
  const download = await downloaded
  const result = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(result.decisions).toHaveLength(1)
  expect(result.decisions[0]).toMatchObject({ id, status: 'confirmed' })
  expect(result.decisions[0].clipId).toMatch(/^[a-f0-9]{64}$/)
  expect(result.reportId).toMatch(/^[a-f0-9]{64}$/)
})

test('unlocated words offer context playback but cannot approve a context as the word', async ({ page }) => {
  await page.goto(url)
  await page.locator('#category').selectOption('no-independent-segment')
  const card = page.locator('[data-review-id]').first()
  await expect(card.getByRole('button', { name: '确认此片段' })).toHaveCount(0)
  const audio = card.locator('audio').first()
  await audio.evaluate((element: HTMLAudioElement) => element.play())
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.2)
  await card.getByRole('button', { name: '暂不确定' }).click()
  await page.locator('#status').selectOption('uncertain')
  await expect(page.locator('[data-review-id]')).toHaveCount(1)
})

test('a word heard in context is exported for recutting, never approved as a whole context clip', async ({ page }) => {
  await page.goto(url)
  await page.locator('#category').selectOption('no-independent-segment')
  const card = page.locator('[data-review-id]').first()
  await card.locator('summary').click()
  await card.getByRole('button', { name: '对照里听到目标词，需重新切分' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出确认结果' }).click()
  const download = await downloaded
  const result = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(result.decisions).toHaveLength(1)
  expect(result.decisions[0].status).toBe('needs-cut')
  expect(result.decisions[0].clipId).toBeUndefined()
})

test('a shared segment cannot be confirmed for two different target words', async ({ page }) => {
  await page.goto(url)
  await page.locator('#book').selectOption('C11')
  await page.locator('#category').selectOption('ambiguous-window')
  const waterproof = page.locator('[data-review-id="C11-0406"]')
  await waterproof.getByRole('button', { name: '确认此片段' }).click()
  await page.locator('#category').selectOption('representation-candidate')
  const rollercoaster = page.locator('[data-review-id="C11-0407"]')
  await rollercoaster.getByRole('button', { name: '确认此片段' }).click()
  await expect(page.getByRole('status')).toContainText('已确认给另一个词')
  await expect(rollercoaster.getByText('待确认', { exact: true })).toBeVisible()
  await expect(page.locator('#progress')).toContainText('已确认 1 项')
})

test('shrinking the review queue preserves decisions saved by the previous page', async ({ page }) => {
  const previous = await readFile(path.resolve('.data/local-pronunciation/review/pre-order-index.html'), 'utf8')
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: previous }))
  await page.goto(url)
  const card = page.locator('[data-review-id]').first()
  const id = await card.getAttribute('data-review-id')
  await card.getByRole('button', { name: '确认此片段' }).first().click()
  await page.unroute(url)
  await page.reload()
  await page.locator('#status').selectOption('confirmed')
  await expect(page.locator('[data-review-id]')).toHaveAttribute('data-review-id', id!)
  await expect(page.locator('#progress')).toContainText('已确认 1 项')
  await expect(page.locator('#auto')).toContainText('自动处理 18 项')
})
