import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

test.use({ channel: 'chrome' })

test('JobHunt_Must requests the same-origin static clip before online audio', async ({ page }) => {
  const staticRequests: string[] = []
  const onlineRequests: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('job-hunt-must'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/local-pronunciation/JobHunt_Must/')) staticRequests.push(url)
    if (url.includes(':8787/audio')) onlineRequests.push(url)
  })

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()

  await expect.poll(() => staticRequests.some((url) => url.includes('/local-pronunciation/JobHunt_Must/0000-us.mp3'))).toBe(true)
  expect(onlineRequests.some((url) => new URL(url).searchParams.get('word') === 'product')).toBe(false)
})

test('a missing JobHunt static clip falls back to online pronunciation', async ({ page }) => {
  const audio = await readFile(path.resolve('public/sounds/correct.wav'))
  const onlineRequests: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('job-hunt-must'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })
  await page.route('**/local-pronunciation/JobHunt_Must/0000-us.mp3', (route) => route.fulfill({ status: 404, body: 'missing' }))
  await page.route('http://127.0.0.1:8787/audio**', (route) => {
    onlineRequests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
  })
  await page.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()

  await expect
    .poll(() =>
      onlineRequests.some((url) => {
        const parsed = new URL(url)
        return (
          parsed.searchParams.get('word') === 'product' &&
          parsed.searchParams.get('pronunciation') === 'us' &&
          !parsed.searchParams.get('localAudio')
        )
      }),
    )
    .toBe(true)
})
