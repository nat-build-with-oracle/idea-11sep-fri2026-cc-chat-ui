import type { Message, Tool, Usage } from './types'

export interface ActivityResult {
  content: unknown
  isError: boolean
}

export interface ActivityTool extends Tool {
  result?: ActivityResult
  /** A result without its tool call in the loaded history. */
  resultOnly?: boolean
}

export interface ConversationMessageItem {
  type: 'message'
  key: string
  message: Message
}

export interface ConversationActivityItem {
  type: 'activity'
  key: string
  tools: ActivityTool[]
  usageEntries?: Array<{ messageId: string; usage: Usage }>
}

export type ConversationItem = ConversationMessageItem | ConversationActivityItem

function ownedDisplayItem(owner: { current: ConversationItem | undefined }): ConversationItem | undefined {
  return owner.current
}

export function activitySummary(tools: readonly ActivityTool[]) {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return [...counts].map(([name, count]) => {
    if (name === 'Read') return `Read ${count} ${count === 1 ? 'file' : 'files'}`
    if (name === 'Write') return `Wrote ${count} ${count === 1 ? 'file' : 'files'}`
    if (name === 'Edit') return `Edited ${count} ${count === 1 ? 'file' : 'files'}`
    if (name === 'Bash') return `Ran ${count} ${count === 1 ? 'command' : 'commands'}`
    return `${name} ${count}`
  }).join(' · ')
}

function displayMessage(message: Message, content: string, status?: Message['status']): Message {
  const history = message.history
    ? { ...message.history, blocks: content ? [{ type: 'text' as const, text: content }] : [] }
    : undefined
  return { ...message, content, status, history, tools: undefined, usage: undefined }
}

/**
 * Flattens native history and live messages into display-order conversation items.
 * Adjacent tool calls/results are one activity item, even when the result arrives in
 * the following native message. Text is always an ordering boundary.
 */
export function buildConversationItems(messages: readonly Message[]): ConversationItem[] {
  const items: ConversationItem[] = []
  let activity: ConversationActivityItem | undefined
  const displayOwner: { current: ConversationItem | undefined } = { current: undefined }
  let sequence = 0

  const flushActivity = () => { if (activity) { items.push(activity); activity = undefined } }
  const addMessage = (message: Message, content: string, status?: Message['status']) => {
    flushActivity()
    const item: ConversationMessageItem = {
      type: 'message', key: `${message.id}:message:${sequence++}`, message: displayMessage(message, content, status),
    }
    items.push(item)
    displayOwner.current = item
  }
  const currentActivity = (message: Message) => {
    if (!activity) activity = { type: 'activity', key: `${message.id}:activity:${sequence++}`, tools: [] }
    displayOwner.current = activity
    return activity
  }
  const addTool = (message: Message, tool: Tool) => {
    currentActivity(message).tools.push({ ...tool })
  }
  const addResult = (message: Message, toolUseId: string, content: unknown, isError = false) => {
    const group = currentActivity(message)
    const tool = [...group.tools].reverse().find(candidate => candidate.id === toolUseId && candidate.result === undefined && !candidate.resultOnly)
    if (tool) {
      tool.result = { content, isError }
      tool.status = 'complete'
      return
    }
    group.tools.push({
      id: toolUseId,
      name: 'Tool result',
      input: undefined,
      status: 'complete',
      result: { content, isError },
      resultOnly: true,
    })
  }

  for (const message of messages) {
    displayOwner.current = undefined
    if (message.history?.blocks.length) {
      for (const block of message.history.blocks) {
        if (block.type === 'text') addMessage(message, block.text)
        else if (block.type === 'tool') addTool(message, block)
        else addResult(message, block.toolUseId, block.content, Boolean(block.isError))
      }
    } else {
      // Live tools are deliberately displayed before streamed content, matching the
      // order in which the existing UI exposes them.
      for (const tool of message.tools ?? []) addTool(message, tool)
      if (message.content) addMessage(message, message.content, message.status === 'streaming' ? 'streaming' : undefined)
    }

    if (message.status === 'error' || message.status === 'interrupted') {
      addMessage(message, '', message.status)
    } else if (!message.history && !message.content && !(message.tools?.length)) {
      addMessage(message, '', message.status)
    }

    const owner = ownedDisplayItem(displayOwner)
    if (message.role === 'assistant' && message.usage && owner) {
      if (owner.type === 'message') {
        owner.message.usage = message.usage
      } else {
        owner.usageEntries = [
          ...(owner.usageEntries ?? []),
          { messageId: message.id, usage: message.usage },
        ]
      }
    }
  }

  flushActivity()
  return items
}
