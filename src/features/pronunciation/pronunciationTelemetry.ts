type PronunciationEvent = {
  event: 'loading_slow' | 'request_error' | 'playback_error' | 'playback_no_progress' | 'played' | 'fallback_started' | 'fallback_error'
  word: string
  pronunciation: string
  elapsedMs: number
  retryCount: number
  error?: string
}

const endpoint = import.meta.env.VITE_TELEMETRY_ENDPOINT || 'http://127.0.0.1:8787/events'

async function hashWord(word: string) {
  const bytes = new TextEncoder().encode(word)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function reportPronunciationEvent(event: PronunciationEvent) {
  try {
    const word = await hashWord(event.word)
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...event, word, timestamp: new Date().toISOString() }),
      keepalive: true,
    })
  } catch {
    // Diagnostics must never interrupt pronunciation.
  }
}
