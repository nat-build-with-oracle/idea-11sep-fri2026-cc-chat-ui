import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { HerdrTreeGroup } from '../types'

// The herdr tree, polled every 15 s while the section is open.
export function useHerdrTree(open: boolean) {
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
  return { groups, error, reload: load }
}
