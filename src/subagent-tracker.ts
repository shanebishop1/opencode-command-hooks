export type ActiveSubagentTracker = {
  begin: (sessionId: string, callId?: string) => void
  end: (sessionId: string, callId?: string) => void
  hasActive: (sessionId: string) => boolean
}

type ActiveCalls = {
  ids: Set<string>
  anonymous: number
}

export const createActiveSubagentTracker = (): ActiveSubagentTracker => {
  const sessions = new Map<string, ActiveCalls>()

  const state = (sessionId: string): ActiveCalls => {
    const existing = sessions.get(sessionId)
    if (existing) return existing
    const created = { ids: new Set<string>(), anonymous: 0 }
    sessions.set(sessionId, created)
    return created
  }

  return {
    begin: (sessionId, callId) => {
      const active = state(sessionId)
      if (callId) active.ids.add(callId)
      else active.anonymous += 1
    },
    end: (sessionId, callId) => {
      const active = sessions.get(sessionId)
      if (!active) return
      if (callId) active.ids.delete(callId)
      else active.anonymous = Math.max(0, active.anonymous - 1)
      if (active.ids.size === 0 && active.anonymous === 0) sessions.delete(sessionId)
    },
    hasActive: sessionId => {
      const active = sessions.get(sessionId)
      return active !== undefined && (active.ids.size > 0 || active.anonymous > 0)
    },
  }
}
