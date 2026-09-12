import type { Message } from './types'

export interface HistoryPage {
  messages: Message[]
  nextOffset: number | null
}

export interface HistoryLoadProgress {
  pages: number
  messages: number
  nextOffset: number | null
}

export type HistoryLoadResult =
  | { complete: true; pages: number }
  | { complete: false; reason: 'limit' | 'cancelled'; pages: number }

interface LoadRemainingHistoryOptions {
  offset: number
  loadPage: (offset: number) => Promise<HistoryPage>
  onPage: (page: HistoryPage) => void
  signal: AbortSignal
  onProgress?: (progress: HistoryLoadProgress) => void
}

const MAX_PAGES_PER_BATCH = 100

function validCursor(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

export async function loadRemainingHistory({ offset, loadPage, onPage, signal, onProgress }: LoadRemainingHistoryOptions): Promise<HistoryLoadResult> {
  if (!validCursor(offset)) throw new Error('History offset must be a non-negative safe integer.')

  let cursor = offset
  let pages = 0
  let messages = 0

  while (pages < MAX_PAGES_PER_BATCH) {
    if (signal.aborted) return { complete: false, reason: 'cancelled', pages }

    let page: HistoryPage
    try {
      page = await loadPage(cursor)
    } catch (error) {
      if (signal.aborted) return { complete: false, reason: 'cancelled', pages }
      throw error
    }

    if (signal.aborted) return { complete: false, reason: 'cancelled', pages }
    if (page.nextOffset !== null && (!validCursor(page.nextOffset) || page.nextOffset <= cursor)) {
      throw new Error(`History pagination returned an invalid next offset: ${String(page.nextOffset)}.`)
    }

    onPage(page)
    pages += 1
    messages += page.messages.length
    onProgress?.({ pages, messages, nextOffset: page.nextOffset })

    if (page.nextOffset === null) return { complete: true, pages }
    cursor = page.nextOffset
  }

  return { complete: false, reason: 'limit', pages }
}

function sourceUuid(message: Message) {
  const value = message.history?.sourceUuid
  return value ? value : null
}

export function mergeHistoryMessages(current: Message[], incoming: Message[]): Message[] {
  const merged = [...current]
  const byId = new Map<string, number>()
  const bySourceUuid = new Map<string, number>()

  const indexMessage = (message: Message, index: number) => {
    byId.set(message.id, index)
    const uuid = sourceUuid(message)
    if (uuid) bySourceUuid.set(uuid, index)
  }
  merged.forEach(indexMessage)

  for (const message of incoming) {
    const uuid = sourceUuid(message)
    const index = uuid ? bySourceUuid.get(uuid) ?? byId.get(message.id) : byId.get(message.id)
    if (index === undefined) {
      merged.push(message)
      indexMessage(message, merged.length - 1)
      continue
    }

    const previous = merged[index]
    if (byId.get(previous.id) === index) byId.delete(previous.id)
    const previousUuid = sourceUuid(previous)
    if (previousUuid && bySourceUuid.get(previousUuid) === index) bySourceUuid.delete(previousUuid)
    merged[index] = message
    indexMessage(message, index)
  }

  return merged
}
