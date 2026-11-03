import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Icon } from './Icon'
import {
  branchHint, chatForWorkspace, countTones, countsLabel, filterGroups, filterTerms, fleetCounts, focusSpaces, groupIsOpen,
  hasActivity, spaceHasSession, tiers, toneLabel, toneOf, withFilter, withFull, withGroup, withQuiet,
  type HerdrCounts, type HerdrTone, type HerdrTreeState,
} from './herdr-tree'
import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from './types'

interface Props {
  nativeSessions: NativeSession[]
  open: boolean
  onToggleSection: () => void
  state: HerdrTreeState
  onState: (next: HerdrTreeState) => void
  currentSessionId?: string | null
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

function Dot({ tone }: { tone: HerdrTone }) {
  return <span className={`herdr-dot tone-${tone}`} aria-hidden="true">{tone === 'done' && <Icon name="check" size={11} />}</span>
}

// Needs input first: it is the one state that waits on you.
function Pips({ counts }: { counts: HerdrCounts }) {
  const tones = (['needs', 'working', 'done'] as const).filter(tone => counts[tone] > 0)
  if (!tones.length) return null
  return <span className="herdr-pips" role="img" aria-label={countsLabel(counts)} title={countsLabel(counts)}>
    {tones.map(tone => <span key={tone} className={`herdr-pip tone-${tone}`}><Dot tone={tone} />{counts[tone]}</span>)}
  </span>
}

interface SpaceProps { group: HerdrTreeGroup; workspace: HerdrTreeWorkspace; child?: boolean; current: boolean; chat?: NativeSession; onOpen: Props['onOpen']; onCopy: Props['onCopy'] }

function Space({ group, workspace, child, current, chat, onOpen, onCopy }: SpaceProps) {
  const tone = toneOf(workspace.status)
  const hint = branchHint(workspace)
  const pane = workspace.agents[0]?.paneId
  const command = `${group.command} pane list --workspace ${workspace.id}`
  const action = chat ? 'Open chat' : 'Copy herdr command'
  const title = [workspace.label, workspace.branch && `branch ${workspace.branch}`, toneLabel[tone], `${workspace.id}${pane ? ` · ${pane}` : ''}`, action].filter(Boolean).join(' · ')
  return <button className={`herdr-space${child ? ' is-child' : ''}`} data-tone={tone} aria-current={current ? 'true' : undefined} title={title}
    aria-label={`${workspace.label}, ${toneLabel[tone]}${workspace.branch ? `, branch ${workspace.branch}` : ''}. ${action}`}
    onClick={() => chat ? onOpen(chat) : onCopy(command, 'herdr command copied')}>
    <Dot tone={tone} />
    <span className="herdr-space-label">{workspace.label}</span>
    {hint && <code className="herdr-branch">{hint}</code>}
    <Icon name={chat ? 'chevron' : 'copy'} size={13} className="herdr-space-action" />
  </button>
}

interface GroupProps { group: HerdrTreeGroup; open: boolean; onToggle: () => void; full: boolean; canFocus: boolean; onFull: (full: boolean) => void; nativeSessions: NativeSession[]; currentSessionId?: string | null; onOpen: Props['onOpen']; onCopy: Props['onCopy'] }

function Group({ group, open, onToggle, full, canFocus, onFull, nativeSessions, currentSessionId, onOpen, onCopy }: GroupProps) {
  const counts = countTones(group.workspaces)
  const spaces = group.workspaces.length
  const focus = focusSpaces(group, currentSessionId, full)
  const focusable = canFocus && full && focusSpaces(group, currentSessionId, false).hidden > 0
  const space = (workspace: HerdrTreeWorkspace, child = false) => <Space key={workspace.id} group={group} workspace={workspace} child={child}
    current={spaceHasSession(workspace, currentSessionId)} chat={chatForWorkspace(group, workspace, nativeSessions)} onOpen={onOpen} onCopy={onCopy} />
  return <div className={`herdr-group${group.reachable ? '' : ' is-offline'}`}>
    <button className="herdr-group-head" aria-expanded={open} onClick={onToggle}
      title={`${group.command} · ${spaces} ${spaces === 1 ? 'space' : 'spaces'}${group.reachable ? '' : ' · not reachable'}`}>
      <Icon name="chevron" size={12} className="herdr-caret" />
      <span className="herdr-group-label">{group.label}</span>
      {group.reachable ? <Pips counts={counts} /> : <span className="herdr-tag">offline</span>}
      {!open && group.reachable && <span className="herdr-group-count" aria-label={`${spaces} ${spaces === 1 ? 'space' : 'spaces'}`}>{spaces}</span>}
    </button>
    {open && (!group.reachable ? <p className="herdr-note">Not reachable right now.</p>
      : !spaces ? <p className="herdr-note">No spaces open.</p>
      : <div className="herdr-spaces">{focus.nodes.map(node => <div className="herdr-node" key={node.workspace.id}>
        {space(node.workspace)}
        {node.children.length > 0 && <div className="herdr-children">{node.children.map(kid => space(kid, true))}</div>}
      </div>)}
        {focus.hidden > 0 && <button className="herdr-group-more" onClick={() => onFull(true)}>Show {focus.hidden} more</button>}
        {focusable && <button className="herdr-group-more" onClick={() => onFull(false)}>Show less</button>}
      </div>)}
  </div>
}

const tierName = { local: 'This Mac', machine: 'Machines' } as const
const quietNoun = (kind: HerdrTreeGroup['kind'], count: number) => kind === 'local' ? (count === 1 ? 'session' : 'sessions') : (count === 1 ? 'machine' : 'machines')

// herdr's own sidebar, inside ours: what is working or waiting on you first, the quiet rest one click away.
export default function HerdrTree({ nativeSessions, open, onToggleSection, state, onState, currentSessionId, onOpen, onCopy }: Props) {
  const [groups, setGroups] = useState<HerdrTreeGroup[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const data = await api.herdrTree(); setGroups(data.groups); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reach herdr') }
  }, [])
  useEffect(() => {
    if (!open) return
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [open, load])
  const terms = filterTerms(state.filter)
  const filtering = terms.length > 0
  const view = groups ? filterGroups(groups, terms) : null
  const fleet = view ? fleetCounts(view) : null
  const offlineNames = view?.filter(group => !group.reachable).map(group => group.label).join(', ')
  const setFilter = (text: string) => onState(withFilter(state, text))
  return <section className="herdr" aria-label="herdr sessions and machines">
    <div className="section-label herdr-head">
      <button className="herdr-head-toggle" aria-expanded={open} onClick={onToggleSection} title={open ? 'Hide herdr' : 'Show herdr'}>
        <span>herdr</span><Icon name="chevron" size={12} className="herdr-caret" />
      </button>
      {fleet && <span className="herdr-head-meta">
        <Pips counts={fleet} />
        {fleet.offline > 0 && <span className="herdr-tag" title={`Not reachable: ${offlineNames}`}>{fleet.offline} offline</span>}
        {!hasActivity(fleet) && !fleet.offline && <span className="herdr-quiet">All quiet</span>}
      </span>}
    </div>
    {open && groups && groups.length > 0 && <div className="herdr-filter-box">
      <input className="repository-filter" value={state.filter} onChange={event => setFilter(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && state.filter) { event.preventDefault(); setFilter('') } }}
        placeholder="Filter: laris-co, nsm…" aria-label="Filter herdr sessions, machines and spaces" spellCheck={false} autoCapitalize="off" autoComplete="off" />
      {state.filter && <button className="herdr-filter-clear" aria-label="Clear the herdr filter" title="Clear (Esc)" onClick={() => setFilter('')}><Icon name="close" size={14} /></button>}
    </div>}
    {open && (!groups ? (error
      ? <p className="sidebar-empty" role="alert">herdr is not answering.<button onClick={() => void load()}>Try again <Icon name="refresh" size={12} /></button></p>
      : <div className="skeleton-lines herdr-skeleton" aria-label="Loading herdr"><i /><i /><i /></div>)
      : !groups.length ? <p className="sidebar-empty">No herdr sessions are running.</p>
      : filtering && !view!.length ? <p className="sidebar-empty">No session, machine or space matches “{state.filter.trim()}”.<button onClick={() => setFilter('')}>Clear the filter</button></p>
      : tiers(view!, state, currentSessionId, filtering).map(tier => <div className="herdr-tier" key={tier.kind}>
        <h3 className="herdr-tier-label">{tierName[tier.kind]}</h3>
        {tier.shown.map(group => {
          const isOpen = groupIsOpen(state, group, currentSessionId, filtering)
          return <Group key={group.id} group={group} open={isOpen} onToggle={() => onState(withGroup(state, group.id, !isOpen))}
            full={filtering || state.full[group.id] === true} canFocus={!filtering} onFull={full => onState(withFull(state, group.id, full))}
            nativeSessions={nativeSessions} currentSessionId={currentSessionId} onOpen={onOpen} onCopy={onCopy} />
        })}
        {tier.hidden > 0 && <button className="repository-more herdr-more" onClick={() => onState(withQuiet(state, tier.kind, true))}>
          Show {tier.hidden} quiet {quietNoun(tier.kind, tier.hidden)}
        </button>}
        {state.quiet[tier.kind] && tier.quiet > 0 && <button className="repository-more herdr-more" onClick={() => onState(withQuiet(state, tier.kind, false))}>
          Hide {tier.quiet} quiet {quietNoun(tier.kind, tier.quiet)}
        </button>}
      </div>))}
  </section>
}
