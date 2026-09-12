import assert from 'node:assert/strict'
import test from 'node:test'
import {
  insertSlashCommand,
  matchSlashCommands,
  slashCommandQueryAtCaret,
  SLASH_COMMANDS,
} from '../src/slash-commands.ts'

test('slash commands trigger only at the start with optional leading whitespace', () => {
  assert.deepEqual(slashCommandQueryAtCaret('/re', 3), { start: 0, end: 3, fragment: 're' })
  assert.deepEqual(slashCommandQueryAtCaret('  /list', 7), { start: 2, end: 7, fragment: 'list' })
  assert.equal(slashCommandQueryAtCaret('say /rename', 11), null)
  assert.equal(slashCommandQueryAtCaret('/rename title', 13), null)
  assert.equal(slashCommandQueryAtCaret(' /rename ', 9), null)
})

test('filtering exposes only the two supported commands with explicit descriptions', () => {
  assert.deepEqual(matchSlashCommands('').map(command => command.token), ['/rename', '/list-agents'])
  assert.deepEqual(matchSlashCommands('list').map(command => command.token), ['/list-agents'])
  assert.deepEqual(matchSlashCommands('ren'), [{ token: '/rename', description: 'Rename this conversation' }])
  assert.equal(SLASH_COMMANDS[1].description, 'Find running Claude agents')
})

test('selection inserts a trailing space and closes the query so later Enter can submit', () => {
  const query = slashCommandQueryAtCaret('  /ren', 6)
  const inserted = insertSlashCommand('  /ren', query, SLASH_COMMANDS[0])
  assert.deepEqual(inserted, { text: '  /rename ', caret: 10 })
  assert.equal(slashCommandQueryAtCaret(inserted.text, inserted.caret), null)
})

test('selection replaces the entire command token when the caret is in its middle', () => {
  const text = '/rename'
  const query = slashCommandQueryAtCaret(text, 3)
  assert.deepEqual(query, { start: 0, end: 7, fragment: 're' })
  assert.deepEqual(insertSlashCommand(text, query, SLASH_COMMANDS[0]), {
    text: '/rename ',
    caret: 8,
  })
})

test('middle-caret replacement preserves arguments with exactly one separator', () => {
  const text = '/rename actual title'
  const query = slashCommandQueryAtCaret(text, 3)
  assert.deepEqual(query, { start: 0, end: 7, fragment: 're' })
  assert.deepEqual(insertSlashCommand(text, query, SLASH_COMMANDS[0]), {
    text: '/rename actual title',
    caret: 8,
  })
})
