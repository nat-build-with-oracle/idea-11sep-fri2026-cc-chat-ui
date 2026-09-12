import { execFileSync } from 'node:child_process'

export type BuildMode = 'development' | 'production'

export interface BuildInfo {
  version: string
  builtAt: string
  revision: string
  id: string
  mode: BuildMode
}

type Execute = (command: string, args: string[]) => string

const bangkokClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: '2-digit',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

function clockPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value
  if (value === undefined) throw new Error(`Missing ${type} from Bangkok build clock`)
  return Number(value)
}

export function createBuildInfo({
  now = new Date(),
  revision = readGitRevision(),
  mode = 'development',
}: {
  now?: Date
  revision?: string
  mode?: BuildMode
} = {}): BuildInfo {
  if (Number.isNaN(now.getTime())) throw new Error('Build time must be a valid date')
  const parts = bangkokClock.formatToParts(now)
  const year = clockPart(parts, 'year')
  const month = clockPart(parts, 'month')
  const day = clockPart(parts, 'day')
  const hour = clockPart(parts, 'hour')
  const minute = clockPart(parts, 'minute')
  const stamp = now.toISOString().replace(/[-:.]/g, '')

  return {
    version: `v${year}.${month}.${day}-alpha.${hour * 100 + minute}`,
    builtAt: now.toISOString(),
    revision,
    id: `${stamp}-${revision}`,
    mode,
  }
}

export function readGitRevision({
  cwd = process.cwd(),
  execute = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8' }),
}: {
  cwd?: string
  execute?: Execute
} = {}): string {
  try {
    const revision = execute('git', ['rev-parse', '--short', 'HEAD']).trim()
    if (!revision) return 'unknown'
    const dirty = execute('git', ['status', '--porcelain']).trim().length > 0
    return `${revision}${dirty ? '-dirty' : ''}`
  } catch {
    return 'unknown'
  }
}
