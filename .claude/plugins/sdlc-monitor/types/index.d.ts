export type Question = { n: number; title: string; body: string; suggested: string }

export type RunState = 'starting' | 'running' | 'paused' | 'done' | 'failed' | 'interrupted' | 'stopped'

// An action the pipeline's agent was refused (from Docs/backlog/<slug>/logs/permissions.json).
export type PermissionAsk = {
  stage: string
  tool: string
  detail: string
  rule: string
  // a path under .claude/: no allow rule lifts that refusal, only running the stage without permission checks
  protected: boolean
}

export type Run = {
  // files each stage changed, by stage name (from logs/stage-files.json); empty for a run that predates it
  stageFiles: Record<string, string[]>
  // actions refused and not decided yet; a paused run with these waits for Allow or Deny, then resumes at the stage
  permissions: PermissionAsk[]
  // the last lines of the failed stage's log, else of run.out; empty unless the run failed or stopped
  reason: string[]
  slug: string
  worktree: string
  state: RunState
  stage: string
  agent: string
  // Model and effort of the running agent, and of every stage (from status.json; empty for runs started before this was recorded).
  model: string
  effort: string
  models: Record<string, { model: string; effort: string }>
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
  // files changed in the pipeline's own worktree (sdlc-mod.sh changes); null when unavailable (unmanaged, discarded, call failed)
  changes: { changed: number; uncommitted: number } | null
  // the base branch from the run record, '' when it has none
  base: string
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

export type ConfigProvider = { endpoint: string; api_key_env: string; models: string[]; effort: boolean; key_set: boolean }
export type ConfigForm = { provider: string; endpoint: string; keyEnv: string; models: string; effort: boolean }

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
      // index of the first board column drawn
      boardOffset: number
      notice: string
      // what a button press is working on; '' when idle
      busy: string
      // key of the button whose action is running (its label is a spinner); '' when none
      working: string
      // the spinner frame shown beside it
      frame: number
      // true while any refresh runs: the Refresh button spins and takes no press
      refreshing: boolean
      // the last `model list --json` result; null when never loaded or the last load failed
      configList: Record<string, ConfigProvider> | null
      // the message line of a failed `model list --json`; '' otherwise
      configError: string
      // the four form values stored by Enter
      configForm: ConfigForm
      // the provider whose Remove waits for a second press; '' when none
      // which CONFIG page is drawn: the provider list or the add / edit form
      configView: 'list' | 'form'
      // the provider the form edits; '' for a new one
      configEditing: string
      configConfirmProvider: string
      // the model whose Remove waits for a second press
      configConfirmModel: { provider: string; model: string } | null
    }
  }
}
