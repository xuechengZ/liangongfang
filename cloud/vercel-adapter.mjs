import { readFile } from 'node:fs/promises'
import path from 'node:path'
import worker from './worker.mjs'

const localRoot = path.resolve('public/local-pronunciation')

function assetOrigin(request) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return new URL(request.url).origin
}

async function readLocalAudio(pathname) {
  const prefix = '/local-pronunciation/'
  if (!pathname.startsWith(prefix)) return null
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    return null
  }
  if (!relative || relative.includes('\0')) return null
  const file = path.resolve(localRoot, relative)
  if (file !== localRoot && !file.startsWith(localRoot + path.sep)) return null
  try {
    const body = await readFile(file)
    return new Response(body, { headers: { 'content-type': 'audio/mpeg' } })
  } catch {
    return null
  }
}

export function createAssets(request, fetchImpl = fetch) {
  const origin = assetOrigin(request)
  return {
    async fetch(assetRequest) {
      const url = new URL(assetRequest.url)
      const local = await readLocalAudio(url.pathname)
      if (local) return local
      const headers = new Headers()
      const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      if (bypass) headers.set('x-vercel-protection-bypass', bypass)
      return fetchImpl(new URL(url.pathname + url.search, origin), {
        method: assetRequest.method || 'GET',
        headers,
      })
    },
  }
}

// Without BLOB_READ_WRITE_TOKEN, events are recorded in function logs (same outcome as the local telemetry server).
// When that token is set in the Vercel project, events are stored with Vercel Blob instead.
export function createBucket() {
  return {
    async put(key, body, options) {
      const token = process.env.BLOB_READ_WRITE_TOKEN
      if (!token) {
        console.log(JSON.stringify({ event: 'vercel_event_logged', key }))
        return
      }
      const { put } = await import('@vercel/blob')
      const payload = typeof body === 'string' ? body : Buffer.from(body)
      await put(key, payload, {
        access: 'private',
        token,
        contentType: options?.httpMetadata?.contentType || 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      })
    },
  }
}

async function resolveWaitUntil(context) {
  if (context && typeof context.waitUntil === 'function') return context.waitUntil.bind(context)
  if (!process.env.VERCEL) return null
  try {
    const { waitUntil } = await import('@vercel/functions')
    return waitUntil
  } catch {
    return null
  }
}

export async function handleCloudRequest(request, pathname, context, options = {}) {
  const url = new URL(request.url)
  url.pathname = pathname
  const init = { method: request.method, headers: new Headers(request.headers) }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer()
  const forwarded = new Request(url, init)
  const waitUntil = await resolveWaitUntil(context)
  const env = {
    ASSETS: options.assets || createAssets(request, options.fetchImpl),
    BUCKET: options.bucket || createBucket(),
  }
  const ctx = {
    waitUntil(promise) {
      if (!waitUntil) {
        promise.catch(() => {})
        return
      }
      try {
        waitUntil(promise)
      } catch {
        promise.catch(() => {})
      }
    },
  }
  return worker.fetch(forwarded, env, ctx)
}
