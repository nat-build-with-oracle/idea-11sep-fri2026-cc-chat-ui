import type { AppState } from './types'
const date = '2026-09-11T13:24:00.000Z'
export const previewState: AppState = {
  projects: ['mother-oracle', 'digger-oracle', 'black-oracle', 'jsonl-oracle', 'lancedb-oracle'].map(name => ({ id: name, name, path: `/example/projects/${name}`, createdAt: date })),
  chats: ['Find our Oracle family', 'Trace the memory layer', 'Build the chat workspace', 'Explore LanceDB'].map((title, i) => ({
    id: `preview-${i}`, title, projectId: 'mother-oracle', sessionId: null, model: 'sonnet', permissionMode: 'bypassPermissions', createdAt: date, updatedAt: date, status: 'idle',
    messages: i ? [] : [
      { id: 'example-user', role: 'user', content: 'Find our Oracles and show their timeline.', createdAt: date, status: 'complete' },
      { id: 'example-answer', role: 'assistant', createdAt: date, status: 'complete', tools: [{ id: 'read-registry', name: 'Read', input: { file_path: 'registry/oracles.json' }, status: 'complete' }], content: '# Our Oracle family\n\n91 owned entries in the saved registry.\n\nSnapshot: 16 August 2026 · not live activity\n\n| Oracle | Focus | Last recorded |\n| --- | --- | --- |\n| Mother | Born last, after 185 children | 16 Aug |\n| white | Fleet keeper | 16 Aug |\n| Pulse | Project pulse | 15 Aug |\n| Homekeeper | The conductor of the orchestra | 15 Aug |\n| Hermes | Device communication messenger | 14 Aug |\n\nMany Oracles, one shared philosophy. The timeline shows recorded activity—not whether an Oracle is online now.\n\nSource: mother-oracle/registry/oracles.json' },
    ],
  })),
}
