export type Question = { n: number; title: string; body: string; suggested: string }

export type RunState = 'starting' | 'running' | 'paused' | 'done' | 'failed' | 'interrupted' | 'stopped'

export type Run = {
  slug: string
  worktree: string
  state: RunState
  stage: string
  agent: string
  attempt: string
  agentStarted: string
  runStarted: string
  updated: string
  pid: number
  files: string[]
  tests: { passed: number; failed: number; total: number } | null
  tail: string[]
  questions: Question[]
  // false for a pipeline started by hand with scripts/sdlc.sh: it has no wrapper record, so no Stop or Resume
  managed: boolean
  // why the wrapper refused to start it (already merged, cap reached, no brief)
  message: string
}

export type PendingItem = { slug: string; type: string; priority: string; title: string }

// discarded: slug -> the command that brings its discarded branch back (kept by sdlc-mod.sh discard)
export type Snapshot = { now: number; runs: Run[]; pending: PendingItem[]; discarded: Record<string, string> }

export type AgentRow = {
  id: string
  label: string
  status: string
  tools: number
  lastTool: string
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'sdlc-monitor': {
      snapshot: Snapshot
      agents: Record<string, AgentRow>
      // which pipeline the pane shows: '' is the overview
      view: string
      selected: Record<string, boolean>
      queue: string[]
      // the slug whose Stop button is waiting for a second press
      confirmStop: string
      // the slug whose Discard and restart button is waiting for a second press
      confirmDiscard: string
      // slug -> when Start was pressed, so a second press does not start it twice
      launching: Record<string, number>
      // answers typed for a paused run, keyed `<slug>:<question number>`
      draft: Record<string, string>
      notice: string
    }
  }
}
