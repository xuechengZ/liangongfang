import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

test.use({ channel: 'chrome' })

for (const chapter of [3, 4, 5, 11]) {
  test(`plays a real original-quality local recording from C${chapter}`, async ({ page }) => {
    const words = JSON.parse(await readFile(path.resolve(`public/dicts/IELTS_WANG_${chapter}.json`), 'utf8'))
    const index = words.findIndex((word: { localAudio?: string }) => word.localAudio)
    expect(index, 'This book must have an approved local recording').toBeGreaterThanOrEqual(0)
    const word = words[index]
    const wordHash = createHash('sha256').update(word.name).digest('hex')
    const events: Array<{ event: string; word: string }> = []
    const providers: string[] = []
    await page.addInitScript(
      ({ book, chapterIndex }) => {
        localStorage.setItem('currentDict', JSON.stringify(book))
        localStorage.setItem('currentChapter', JSON.stringify(chapterIndex))
      },
      { book: `ieltsWang${chapter}`, chapterIndex: Math.floor(index / 20) },
    )
    page.on('response', (response) => {
      if (!response.url().startsWith('http://127.0.0.1:8787/audio')) return
      const url = new URL(response.url())
      if (url.searchParams.get('localAudio') === word.localAudio && url.searchParams.get('prefetch') !== '1') {
        providers.push(response.headers()['x-pronunciation-provider'])
      }
    })
    await page.route('http://127.0.0.1:8787/events', (route) => {
      events.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    })
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '开始' }).click()
    for (let offset = 0; offset < index % 20; offset += 1) await page.keyboard.press('Control+Shift+ArrowRight')
    await expect.poll(() => providers.includes('local')).toBe(true)
    await expect.poll(() => events.some((event) => event.event === 'played' && event.word === wordHash)).toBe(true)
    expect(events.some((event) => event.event === 'fallback_started' && event.word === wordHash)).toBe(false)
  })
}

test('uses a word local recording before online pronunciation sources', async ({ page }) => {
  const audio = await readFile(path.resolve('public/sounds/correct.wav'))
  const words = JSON.parse(await readFile(path.resolve('public/dicts/IELTS_WANG_3.json'), 'utf8'))
  words[0].localAudio = 'ieltsWang3/0000-original.mp3'
  const audioRequests: string[] = []

  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })
  await page.route('**/dicts/IELTS_WANG_3.json', (route) => route.fulfill({ json: words }))
  await page.route('http://127.0.0.1:8787/audio**', (route) => {
    audioRequests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
  })
  await page.route('http://127.0.0.1:8787/events', (route) => route.fulfill({ status: 204 }))

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()

  await expect
    .poll(() => audioRequests.some((requestUrl) => new URL(requestUrl).searchParams.get('localAudio') === 'ieltsWang3/0000-original.mp3'))
    .toBe(true)

  await page.keyboard.press('Control+Shift+ArrowRight')
  await expect
    .poll(() =>
      audioRequests.some((requestUrl) => {
        const url = new URL(requestUrl)
        return url.searchParams.get('localAudio') === 'ieltsWang3/0001-original.mp3' && url.searchParams.get('prefetch') !== '1'
      }),
    )
    .toBe(true)
})

test('reports playback only after audio time advances', async ({ page }) => {
  const events: Array<{ event: string }> = []
  const audio = await readFile(path.resolve('public/sounds/correct.wav'))

  await page.route('http://127.0.0.1:8787/audio**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: audio }),
  )
  await page.route('http://127.0.0.1:8787/events', async (route) => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 204 })
  })

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始' }).click()
  await page.getByRole('button', { name: '播放发音' }).click()

  await expect.poll(() => events.some((event) => event.event === 'played')).toBe(true)
})

test('falls back to system speech when online audio makes no progress', async ({ page }) => {
  const events: Array<{ event: string }> = []
  const audio = await readFile(path.resolve('public/sounds/correct.wav'))

  await page.addInitScript(() => {
    class MockUtterance {
      lang = ''
      volume = 1
      rate = 1
      voice = null
      onstart?: () => void
      onend?: () => void
      onerror?: () => void
      addEventListener(name: string, listener: () => void) {
        Object.assign(this, { [`on${name}`]: listener })
      }
      removeEventListener(name: string) {
        Object.assign(this, { [`on${name}`]: undefined })
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance })
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel() {},
        getVoices() {
          return []
        },
        speak(utterance: MockUtterance) {
          utterance.onstart?.()
        },
      },
    })
    HTMLMediaElement.prototype.play = () => Promise.resolve()
  })
  await page.route('http://127.0.0.1:8787/audio**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: audio }),
  )
  await page.route('http://127.0.0.1:8787/events', async (route) => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 204 })
  })

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '开始' }).click({ force: true })

  await expect.poll(() => events.some((event) => event.event === 'playback_no_progress')).toBe(true)
  await expect.poll(() => events.some((event) => event.event === 'fallback_started')).toBe(true)
})
