import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ channel: 'chrome' })
test.setTimeout(90_000)
const origin = 'http://127.0.0.1:5190'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('ieltsWang3'))
    localStorage.setItem('currentChapter', '0')
  })
  await context.route('https://**/*', route => route.abort())
})

test('desktop personal branding keeps the dynamic book but removes promotional footer controls', async ({ page }) => {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '阿成的练功房', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('阿成的练功房')
  const logo = page.getByRole('img', { name: '阿成的练功房 Logo' })
  await expect(logo).toHaveAttribute('src', '/acheng-logo.png')
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1254)
  await expect(page.locator('header a').first()).toHaveAttribute('href', '/')
  await expect(page.getByRole('link', { name: '动态词本', exact: true })).toBeVisible()
  await expect(page.locator('footer button')).toHaveCount(0)
  await expect(page.locator('a[href*="xiaohongshu"],a[href*="twitter.com"],a[href*="gitee.io"],a[href^="mailto:me@kaiyi"]')).toHaveCount(0)
  await expect(page.locator('footer')).not.toContainText('鲁ICP备')
})

test('mobile uses the provided logo and personal title without upstream advertising or redirects', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/mobile`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '阿成的练功房', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('阿成的练功房')
  const logo = page.getByRole('img', { name: '阿成的练功房 Logo' })
  await expect(logo).toHaveAttribute('src', '/acheng-logo.png')
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1254)).toBe(true)
  await expect(page.locator('a[href*="qwerty.kaiyi.cool"],a[href*="marketplace.visualstudio.com"]')).toHaveCount(0)
  await expect(page.getByText('GitHub 全球趋势榜第一名', { exact: true })).toHaveCount(0)
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', '/acheng-logo.png')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('chapter results retain practice controls without donation or social promotions', async ({ context, page }) => {
  const words = JSON.parse(readFileSync('public/dicts/IELTS_WANG_3.json', 'utf8')).slice(0, 1)
  await context.addInitScript(() => { localStorage.setItem('currentDict', JSON.stringify('ieltsWang3')); localStorage.setItem('currentChapter', '0') })
  await context.route('**/dicts/IELTS_WANG_3.json', route => route.fulfill({ json: words }))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.keyboard.type('ability', { delay: 30 })
  await expect(page.getByRole('button', { name: '重复本章节', exact: true })).toBeVisible()
  await expect(page.getByTitle('分享你的成绩给朋友')).toBeVisible()
  await expect(page.getByTitle('捐赠我们的项目')).toHaveCount(0)
  await expect(page.getByTitle('加入我们的社区')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '默写本章节', exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.locator('svg.cursor-pointer.text-gray-500').click()
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/)
})
