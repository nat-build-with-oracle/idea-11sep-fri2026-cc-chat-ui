import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import {
  fleetCounts, focusedGroups, focusFromFilter, focusSuggestions, groupTone, hasActivity, missingFocus, openGroupId,
  resolveFollow, toggleFocus, toggleOpen, withFocus, type HerdrTreeState,
} from '../herdr-tree'
import type { NativeSession } from '../types'
import { FollowChip, OutlineChip, SuggestChip } from './HerdrChip'
import HerdrGroup from './HerdrGroup'
import HerdrPicker from './HerdrPicker'
import { Chevron, OfflineTag, StatusPips } from './StatusDot'
import { useHerdrTree } from './useHerdrTree'
import { cx, touch } from './ui'

interface Props {
  nativeSessions: NativeSession[]
  open: boolean
  onToggleSection: () => void
  state: HerdrTreeState
  onState: (next: HerdrTreeState) => void
  currentSessionId?: string | null
  // The deployment's default follow list (CC_CHAT_HERDR_FOLLOW), used until the first choice is made.
  defaultFollow?: string[]
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

const idLabel = (id: string) => id.replace(/^(session|machine):/, '')

// herdr inside our sidebar: only the sessions you follow; the whole fleet is summed up in the head.
export default function HerdrSidebar({ nativeSessions, open, onToggleSection, state, onState, currentSessionId, defaultFollow, onOpen, onCopy }: Props) {
  const { groups, error, reload } = useHerdrTree(open)
  const [picking, setPicking] = useState(false)
  // Until the first choice: a filter typed before the picker existed, else the deployment's default follow list.
  useEffect(() => {
    if (!groups || state.focus !== null) return
    if (state.filter.trim()) onState({ ...withFocus(state, focusFromFilter(groups, state.filter)), filter: '' })
    else if (defaultFollow?.length) onState(withFocus(state, resolveFollow(groups, defaultFollow)))
  }, [groups, state, onState, defaultFollow])
  const fleet = groups ? fleetCounts(groups) : null
  const offline = groups?.filter(group => !group.reachable).map(group => group.label).join(', ')
  const focus = state.focus ?? []
  const followed = groups ? focusedGroups(groups, focus) : []
  const gone = groups ? missingFocus(groups, focus) : []
  const openId = openGroupId(state, followed)
  const suggestions = groups ? focusSuggestions(groups, focus, currentSessionId, focus.length ? 3 : 6) : []
  const toggle = (id: string) => onState(toggleFocus(state, id))
  const suggestionChips = suggestions.map(group => <SuggestChip key={group.id} tone={groupTone(group)} label={group.label} onFollow={() => toggle(group.id)} />)
  return <section aria-label="herdr sessions and machines" className="mb-1.5">
    <div className="section-label">
      <button type="button" aria-expanded={open} onClick={onToggleSection} title={open ? 'Hide herdr' : 'Show herdr'}
        className={cx('-ml-1.5 inline-flex min-h-[30px] items-center gap-1.5 rounded-[7px] px-1.5 hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]', touch)}>
        <span>herdr</span><Chevron open={open} />
      </button>
      {fleet && <span title="All sessions and machines" className="inline-flex min-w-0 items-center gap-2.5">
        <StatusPips counts={fleet} />
        {fleet.offline > 0 && <OfflineTag title={`Not reachable: ${offline}`}>{`${fleet.offline} offline`}</OfflineTag>}
        {!hasActivity(fleet) && !fleet.offline && <span className="text-xs text-[var(--color-muted)]">All quiet</span>}
      </span>}
    </div>
    {open && (!groups ? (error
      ? <p className="sidebar-empty" role="alert">herdr is not answering.<button type="button" onClick={() => void reload()}>Try again <Icon name="refresh" size={12} /></button></p>
      : <div className="skeleton-lines px-2.5" aria-label="Loading herdr"><i /><i /><i /></div>)
      : !groups.length ? <p className="sidebar-empty">No herdr sessions are running.</p>
      : <>
        <div role="group" aria-label="Followed herdr sessions" className="mx-2 mb-2.5 flex flex-wrap gap-1.5">
          {followed.map(group => <FollowChip key={group.id} tone={groupTone(group)} label={group.label} title={group.command} onRemove={() => toggle(group.id)} />)}
          {gone.map(id => <FollowChip key={id} gone tone="offline" label={idLabel(id)} title={`${idLabel(id)} is not running right now`} onRemove={() => toggle(id)} />)}
          <OutlineChip accent expanded={picking} onClick={() => setPicking(!picking)}><Icon name="plus" size={12} />{focus.length ? 'Add' : 'Choose sessions'}</OutlineChip>
        </div>
        {picking && <HerdrPicker groups={groups} focus={focus} onToggle={toggle} onClear={() => onState(withFocus(state, []))} onDone={() => setPicking(false)} />}
        {!picking && !focus.length && <div className="mx-2 mb-3">
          <p className="mb-2 text-[13px] leading-normal text-[var(--color-muted)]">Follow only the sessions you care about.{suggestions.length > 0 && ' Busy now:'}</p>
          {suggestions.length > 0 && <div className="flex flex-wrap gap-1.5">{suggestionChips}</div>}
        </div>}
        {!picking && focus.length > 0 && suggestions.length > 0 && <div aria-label="Busy sessions you do not follow" className="mx-2 -mt-0.5 mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-[var(--color-muted)]">Also busy</span>{suggestionChips}
        </div>}
        {followed.map(group => <HerdrGroup key={group.id} group={group} open={group.id === openId} onToggle={() => onState(toggleOpen(state, followed, group.id))}
          nativeSessions={nativeSessions} currentSessionId={currentSessionId} onOpen={onOpen} onCopy={onCopy} />)}
      </>)}
  </section>
}
