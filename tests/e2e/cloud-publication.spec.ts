import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test.use({ channel: 'chrome' })
const origin = process.env.CLOUD_PREVIEW_URL || 'http://127.0.0.1:5190'

for (const book of [3, 4, 5, 11]) {
  test(`cloud C${book}: real original audio advances and matches after next-word shortcut`, async ({ page }) => {
    const words = JSON.parse(readFileSync(path.resolve(`public/dicts/IELTS_WANG_${book}.json`), 'utf8'))
    const events: any[] = []
    const providers: string[] = []
    const pageErrors: string[] = []
    const loopbackRequests: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => {
      if (request.url().includes('127.0.0.1:8787')) loopbackRequests.push(request.url())
      if (request.url() === `${origin}/events`) events.push(request.postDataJSON())
    })
    page.on('response', response => {
      if (response.url().startsWith(`${origin}/audio?`)) providers.push(response.headers()['x-pronunciation-provider'])
    })
    await page.addInitScript(book => {
      localStorage.setItem('currentDict', JSON.stringify(`ieltsWang${book}`))
      localStorage.setItem('currentChapter', '0')
    }, book)
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '开始', exact: true }).click()
    for (let index = 0; index < 2; index++) {
      if (index) await page.keyboard.press('Control+Shift+ArrowRight')
      await expect(page.locator('div[lang="en"]')).toContainText(words[index].name.replace(/ /g, '␣'))
      const hash = createHash('sha256').update(words[index].name).digest('hex')
      await expect.poll(() => events.some(event => event.event === 'played' && event.word === hash)).toBe(true)
      expect(events.some(event => event.event === 'fallback_started' && event.word === hash)).toBe(false)
    }
    expect(providers).toContain('local')
    expect(loopbackRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test('export/import migrates dynamic book and history across browser origins', async ({ browser }) => {
  const source = await browser.newContext({ acceptDownloads: true })
  const target = await browser.newContext()
  try {
    const page = await source.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
      localStorage.setItem('currentChapter', '0')
    })
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '开始', exact: true }).click()
    await page.keyboard.press('x')
    await page.waitForTimeout(400)
    await page.keyboard.type('ability', { delay: 15 })
    await page.getByTitle('打开设置对话框').click()
    await page.getByRole('tab', { name: '数据' }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出数据', exact: true }).click()
    const filename = await (await downloadPromise).path()
    const migrated = await target.newPage()
    await migrated.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
    await migrated.getByTitle('打开设置对话框').click()
    await migrated.getByRole('tab', { name: '数据' }).click()
    const chooserPromise = migrated.waitForEvent('filechooser')
    await migrated.getByRole('button', { name: '导入数据', exact: true }).click()
    await (await chooserPromise).setFiles(filename!)
    await expect.poll(() => migrated.evaluate(() => new Promise(resolve => {
      const open = indexedDB.open('RecordDB')
      open.onsuccess = () => {
        const db = open.result
        const read = db.transaction('dynamicWords').objectStore('dynamicWords').getAll()
        read.onsuccess = () => { db.close(); resolve(read.result.map(row => row.word.name)) }
      }
    }))).toEqual(['ability'])
    const history = await migrated.evaluate(() => new Promise<any[]>(resolve => {
      const open = indexedDB.open('RecordDB')
      open.onsuccess = () => {
        const db = open.result
        const read = db.transaction('wordRecords').objectStore('wordRecords').getAll()
        read.onsuccess = () => { db.close(); resolve(read.result) }
      }
    }))
    expect(history.some(row => row.word === 'ability' && row.wrongCount > 0)).toBe(true)
  } finally { await source.close(); await target.close() }
})
