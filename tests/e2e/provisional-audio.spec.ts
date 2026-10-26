import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })

for (const width of [1280, 768]) {
  test.describe(`viewport ${width}`, () => {
    test.use({ viewport: { width, height: 844 } })
    test('uncertain label follows the current word without changing playback', async ({ page }) => {
      const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
      words[0].localAudioUncertain = true
      delete words[1].localAudioUncertain
      const audio = readFileSync(path.resolve('public/sounds/correct.wav'))
      const requests: string[] = []
      await page.addInitScript(() => {
        localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
        localStorage.setItem('currentChapter', JSON.stringify(0))
      })
      await page.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
      await page.route('http://127.0.0.1:8787/audio**', (route) => {
        requests.push(route.request().url())
        return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
      })
      await page.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
      await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '开始' }).click()
      await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
      await expect.poll(() => requests.some((r) => new URL(r).searchParams.get('localAudio') === words[0].localAudio)).toBe(true)
      await page.keyboard.press('Control+Shift+ArrowRight')
      await expect(page.getByText('发音可能有误', { exact: true })).toHaveCount(0)
      await expect
        .poll(() =>
          requests.some((r) => {
            const url = new URL(r)
            return url.searchParams.get('localAudio') === words[1].localAudio && url.searchParams.get('prefetch') !== '1'
          }),
        )
        .toBe(true)
      await page.keyboard.press('Control+Shift+ArrowLeft')
      await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
    })
  })
}

test('Youdao preference hides the uncertain label and does not play the Wang clip', async ({ page }) => {
  const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
  words[0].localAudioUncertain = true
  const audio = readFileSync(path.resolve('public/sounds/correct.wav'))
  const requests: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem('wangPronunciationSource', JSON.stringify('youdao'))
  })
  await page.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  await page.route('http://127.0.0.1:8787/audio**', (route) => {
    requests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
  })
  await page.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByText('发音可能有误', { exact: true })).toHaveCount(0)
  await expect
    .poll(() =>
      requests.some((requestUrl) => {
        const url = new URL(requestUrl)
        return url.searchParams.get('word') === words[0].name && url.searchParams.get('prefetch') !== '1'
      }),
    )
    .toBe(true)
  expect(requests.some((requestUrl) => new URL(requestUrl).searchParams.get('localAudio') === words[0].localAudio)).toBe(false)
})

test('Wang preference keeps the uncertain label while the local clip plays', async ({ page }) => {
  const words = JSON.parse(readFileSync(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
  words[0].localAudioUncertain = true
  const audio = readFileSync(path.resolve('public/sounds/correct.wav'))
  const requests: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem('wangPronunciationSource', JSON.stringify('wang'))
  })
  await page.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  await page.route('http://127.0.0.1:8787/audio**', (route) => {
    requests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
  })
  await page.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()
  await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
  await expect
    .poll(() => requests.some((requestUrl) => new URL(requestUrl).searchParams.get('localAudio') === words[0].localAudio))
    .toBe(true)
  await page.getByRole('button', { name: '美音' }).click()
  await page.getByRole('radio', { name: '优先有道词典发音' }).click()
  await expect(page.getByText('发音可能有误', { exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: '优先王陆语料发音' }).click()
  await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
})

for (const book of ['C3', 'C4', 'C5', 'C11']) {
  test(`provisional candidate one plays original local audio with a warning in ${book}`, async ({ page }) => {
    const review = JSON.parse(readFileSync(path.resolve('.data/local-pronunciation/review/review-report.json'), 'utf8'))
    const row = review.rows.find((row: { book: string; candidates: unknown[] }) => row.book === book && row.candidates.length)
    const chapter = book.slice(1)
    const words = JSON.parse(readFileSync(path.resolve(`public/dicts/IELTS_WANG_${chapter}.json`), 'utf8'))
    const word = words[row.index]
    expect(word.localAudioUncertain).toBe(true)
    const original = readFileSync(path.resolve('.data/local-pronunciation/review', row.candidates[0].audio))
    expect(readFileSync(path.resolve('.data/local-pronunciation', word.localAudio))).toEqual(original)
    const events: Array<{ event: string; word: string }> = []
    const providers: string[] = []
    await page.addInitScript(
      ({ book, index }) => {
        localStorage.setItem('currentDict', JSON.stringify(book))
        localStorage.setItem('currentChapter', JSON.stringify(Math.floor(index / 20)))
      },
      { book: `ieltsWang${chapter}`, index: row.index },
    )
    page.on('response', (response) => {
      if (
        response.url().startsWith('http://127.0.0.1:8787/audio') &&
        new URL(response.url()).searchParams.get('localAudio') === word.localAudio
      ) {
        providers.push(response.headers()['x-pronunciation-provider'])
      }
    })
    await page.route('http://127.0.0.1:8787/events', (route) => {
      events.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    })
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '开始' }).click()
    for (let offset = 0; offset < row.index % 20; offset += 1) await page.keyboard.press('Control+Shift+ArrowRight')
    await expect(page.getByText('发音可能有误', { exact: true })).toBeVisible()
    await expect.poll(() => providers.includes('local')).toBe(true)
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(word.name).digest('hex')
    await expect.poll(() => events.some((event) => event.event === 'played' && event.word === hash)).toBe(true)
    expect(events.some((event) => event.event === 'fallback_started' && event.word === hash)).toBe(false)
  })
}

test('all 315 provisional mappings serve candidate one unchanged and remain pending review', async ({ request }) => {
  test.setTimeout(60_000)
  const root = path.resolve('.data/local-pronunciation')
  const review = JSON.parse(readFileSync(path.join(root, 'review/review-report.json'), 'utf8'))
  const previous = JSON.parse(readFileSync(path.join(root, 'review/pre-order-review-report.json'), 'utf8'))
  expect(review.reportId).toBe(previous.reportId)
  expect(review.total).toBe(352)
  expect(review.provisionalCount).toBe(315)
  const reports = JSON.parse(readFileSync(path.join(root, 'batch-report.json'), 'utf8'))
  const dictionaries = Object.fromEntries(
    ['C3', 'C4', 'C5', 'C11'].map((book) => [
      book,
      JSON.parse(readFileSync(path.resolve(`public/dicts/IELTS_WANG_${book.slice(1)}.json`), 'utf8')),
    ]),
  )
  let provisional = 0
  let fallback = 0
  for (const row of review.rows) {
    const word = dictionaries[row.book][row.index]
    const record = reports[row.book].records[row.index]
    expect(record.status).toBe('unmatched')
    if (!row.candidates.length) {
      expect(word.localAudio).toBeUndefined()
      expect(word.localAudioUncertain).toBeUndefined()
      fallback += 1
      continue
    }
    expect(row.provisionalClipId).toBe(row.candidates[0].clipId)
    expect(word.localAudioUncertain).toBe(true)
    expect(record.qualityVerified).toBe(true)
    const expected = readFileSync(path.join(root, 'review', row.candidates[0].audio))
    expect(readFileSync(path.join(root, word.localAudio))).toEqual(expected)
    const params = new URLSearchParams({ word: word.name.split('=')[0], pronunciation: 'uk', localAudio: word.localAudio })
    const response = await request.get(`http://127.0.0.1:8787/audio?${params}`)
    expect(response.status(), row.id).toBe(200)
    expect(response.headers()['x-pronunciation-provider'], row.id).toBe('local')
    expect(await response.body(), row.id).toEqual(expected)
    await response.dispose()
    provisional += 1
  }
  expect(provisional).toBe(315)
  expect(fallback).toBe(37)
})
