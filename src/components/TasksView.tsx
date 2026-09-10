import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarClock, ChevronRight, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'

import { NewTaskSheet } from './NewTaskSheet'
import { loadCronJob, loadCronJobs, loadCronRuns, triggerCronJob, updateCronPrompt, updateCronJob, type CronJob, type CronRun, type LiveProfile } from '../hermes'
import { useEdgeSwipeBack } from '../edge-swipe'

type Props = { back: () => void; profiles: LiveProfile[] }
const jobTitle = (job: CronJob) => (job.name || 'Untitled task').replace(/^\[bot:[^\]]+\]\s*/i, '')
const stateOf = (job: CronJob) => job.state === 'paused' || job.enabled === false ? 'paused' : job.state === 'running' ? 'running' : job.last_error ? 'error' : 'scheduled'
const dateLabel = (value?: number | string) => { if (!value) return '—'; const date = new Date(typeof value === 'number' ? value * 1000 : value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export function reconcileTaskJobs(serverJobs: CronJob[], optimisticJobs: ReadonlyMap<string, CronJob>): { jobs: CronJob[]; pending: Map<string, CronJob> } {
  const merged = new Map(serverJobs.map(job => [job.job_id, job]))
  const pending = new Map<string, CronJob>()
  optimisticJobs.forEach((desired, jobId) => {
    const observed = merged.get(jobId)
    if (!observed || stateOf(observed) !== stateOf(desired)) {
      merged.set(jobId, desired)
      pending.set(jobId, desired)
    }
  })
  return { jobs: [...merged.values()], pending }
}

type TaskFilter = 'all' | 'running' | 'scheduled'

export function deriveTaskSections(jobs: CronJob[], filter: TaskFilter) {
  const running = jobs.filter(job => stateOf(job) === 'running')
  const scheduled = filter === 'running' ? [] : jobs.filter(job => stateOf(job) === 'scheduled')
  // Keep paused/error jobs visible beside Scheduled work so their only action,
  // Resume, is never hidden by the very filter that exposed the task before pause.
  const attention = filter === 'running' ? [] : jobs.filter(job => !['running', 'scheduled'].includes(stateOf(job)))
  return { running, scheduled, attention }
}

export function TasksView({ back, profiles }: Props) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [selected, setSelected] = useState<CronJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<CronJob | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const scrollRef = useRef<HTMLElement | null>(null)
  const pullStartRef = useRef<number | null>(null)
  useEdgeSwipeBack(scrollRef, back, !selected && !createOpen)
  const optimisticJobsRef = useRef(new Map<string, CronJob>())
  const scopeKey = profiles.map(profile => profile.name).sort().join('|')
  const refresh = async () => {
    setLoading(true); setError('')
    const scopes = profiles.map(profile => profile.name)
    const results = await Promise.allSettled((scopes.length ? scopes : [undefined]).map(scope => loadCronJobs(scope)))
    const successful = results.filter((result): result is PromiseFulfilledResult<CronJob[]> => result.status === 'fulfilled')
    const failures = results.filter(result => result.status === 'rejected')
    if (successful.length) {
      const serverJobs = successful.flatMap(result => result.value)
      const reconciled = reconcileTaskJobs(serverJobs, optimisticJobsRef.current)
      optimisticJobsRef.current = reconciled.pending
      setJobs(reconciled.jobs)
      setSelected(current => current ? (reconciled.jobs.find(job => job.job_id === current.job_id) || current) : null)
      if (failures.length) setError('Some Bot task lists could not refresh; showing the last confirmed state for those tasks.')
    } else if (!jobs.length && failures.length) {
      setError('Could not load Hermes scheduled tasks.')
    }
    setLoading(false)
  }
  const pullRefresh = async () => {
    setPullRefreshing(true)
    try { await refresh() } finally { setPullRefreshing(false) }
  }
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      if (selected) { event.preventDefault(); setSelected(null) }
      else if (createOpen) { event.preventDefault(); setCreateOpen(false) }
      else { event.preventDefault(); back() }
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [selected, createOpen, back])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 20_000); return () => window.clearInterval(timer) }, [scopeKey])
  const { running, scheduled, attention } = useMemo(() => deriveTaskSections(jobs, filter), [jobs, filter])
  const toggle = async (job: CronJob) => {
    const action = stateOf(job) === 'paused' ? 'resume' : 'pause'
    const desired: CronJob = { ...job, enabled: action === 'resume', state: action === 'resume' ? 'scheduled' : 'paused' }
    optimisticJobsRef.current.set(job.job_id, desired)
    setJobs(current => current.map(item => item.job_id === job.job_id ? desired : item))
    setSelected(current => current?.job_id === job.job_id ? desired : current)
    setBusy(`${job.job_id}:toggle`); setError('')
    try { await updateCronJob(job.job_id, action, job.profile); await refresh() }
    catch (reason) { optimisticJobsRef.current.delete(job.job_id); setJobs(current => current.map(item => item.job_id === job.job_id ? job : item)); setSelected(current => current?.job_id === job.job_id ? job : current); setError(reason instanceof Error ? reason.message : `Could not ${action} this task.`) }
    finally { setBusy('') }
  }
  const trigger = async (job: CronJob) => { setBusy(`${job.job_id}:trigger`); setError(''); try { await triggerCronJob(job.job_id, job.profile); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not trigger this task.') } finally { setBusy('') } }
  const remove = async (job: CronJob) => {
    setBusy(`${job.job_id}:remove`); setError('')
    try {
      await updateCronJob(job.job_id, 'remove', job.profile)
      optimisticJobsRef.current.delete(job.job_id)
      setJobs(current => current.filter(item => item.job_id !== job.job_id))
      setSelected(current => current?.job_id === job.job_id ? null : current)
      setDeleteCandidate(null)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hermes could not delete this task.')
    } finally { setBusy('') }
  }
  const openTask = async (job: CronJob) => {
    setSelected(job)
    try { setSelected(await loadCronJob(job.job_id, job.profile)) }
    catch { /* Keep the list payload visible; the full prompt remains available when the gateway supports the detail route. */ }
  }
  if (selected) return <TaskDetail job={selected} busy={busy} back={() => setSelected(null)} onRefresh={refresh} onToggle={toggle} onTrigger={trigger}/>
  if (createOpen) return <NewTaskSheet profiles={profiles} onClose={() => setCreateOpen(false)} onCreated={refresh}/>
  const showRunning = running.length > 0
  const showScheduled = scheduled.length > 0
  const showOther = attention.length > 0
  const pullActive = pullDistance > 8 || pullRefreshing
  return <main className="app tasks-sheet" ref={scrollRef} onTouchStart={event => { if (scrollRef.current?.scrollTop === 0) pullStartRef.current = event.touches[0].clientY }} onTouchMove={event => { if (pullStartRef.current == null || scrollRef.current?.scrollTop !== 0) return; const distance = Math.min(76, Math.max(0, event.touches[0].clientY - pullStartRef.current)); if (distance > 0) event.preventDefault(); setPullDistance(distance) }} onTouchEnd={() => { const shouldRefresh = pullDistance >= 56; pullStartRef.current = null; setPullDistance(0); if (shouldRefresh) void pullRefresh() }}>
    <header className="tasks-head"><button className="back-button" onClick={back} aria-label="Back to Bots"><ArrowLeft size={18}/></button><b>Tasks</b><button className="icon-button" onClick={() => setCreateOpen(true)} aria-label="New task"><Plus size={18}/></button></header>
    {pullActive && <div className="pull-refresh-cue" style={{ height: `${pullRefreshing ? 46 : pullDistance}px` }}><RefreshCw size={15} className={pullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{pullRefreshing ? 'Refreshing…' : pullDistance >= 56 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
    <button className="tasks-running" onClick={() => document.getElementById('running-tasks')?.scrollIntoView({ behavior: 'smooth' })}><Zap size={17}/><span>Running now</span><b>{running.length}</b><ChevronRight size={16}/></button>
    <button className="tasks-stat tasks-scheduled" onClick={() => { setFilter('scheduled'); document.getElementById('scheduled-tasks')?.scrollIntoView({ behavior: 'smooth' }) }}><CalendarClock size={17}/><span>Scheduled</span><b>{scheduled.length}</b><ChevronRight size={16}/></button>
    {error && <p className="management-error">{error}</p>}
    {loading && !jobs.length ? <p className="management-empty">Loading scheduled tasks…</p> : !jobs.length ? <section className="tasks-empty"><CalendarClock size={28}/><b>No scheduled tasks</b><p>Scheduled jobs created in Hermes Desktop will appear here.</p></section> : <>{showRunning && <TaskSection id="running-tasks" label="Running" jobs={running} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>} {showScheduled && <TaskSection id="scheduled-tasks" label="Scheduled jobs" jobs={scheduled} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>} {showOther && <TaskSection label="Paused / attention" jobs={attention} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>}</>}
    {deleteCandidate && <DeleteTaskModal job={deleteCandidate} deleting={busy === `${deleteCandidate.job_id}:remove`} onCancel={() => setDeleteCandidate(null)} onConfirm={() => void remove(deleteCandidate)}/>}
  </main>
}

function TaskSection({ id, label, jobs, busy, onOpen, onToggle, onTrigger, onDelete }: { id?: string; label: string; jobs: CronJob[]; busy: string; onOpen: (job: CronJob) => void; onToggle: (job: CronJob) => void; onTrigger: (job: CronJob) => void; onDelete: (job: CronJob) => void }) {
  if (!jobs.length) return null
  return <section className="task-section" id={id}><div className="task-section-head">{label}<small>{jobs.length}</small></div>{jobs.map(job => <TaskCard busy={busy} job={job} key={job.job_id} onOpen={onOpen} onToggle={onToggle} onTrigger={onTrigger} onDelete={onDelete}/>)}</section>
}
function TaskCard({ busy, job, onOpen, onToggle, onTrigger, onDelete }: { busy: string; job: CronJob; onOpen: (job: CronJob) => void; onToggle: (job: CronJob) => void; onTrigger: (job: CronJob) => void; onDelete: (job: CronJob) => void }) { const state = stateOf(job); const paused = state === 'paused'; return <article className="task-card"><button className="task-card-summary" onClick={() => onOpen(job)} aria-label={`Open ${jobTitle(job)} details`}><div className="task-title"><span><i className={state}/><b>{jobTitle(job)}</b></span><em className={state}>{state}</em></div><p>{job.prompt_preview || job.prompt || 'Scheduled Hermes automation'}</p><TaskMetadata job={job}/></button><div className="task-card-actions"><button className="task-toggle" disabled={busy === `${job.job_id}:toggle`} onClick={() => void onToggle(job)}>{paused ? <><Play size={14}/> Resume</> : <><Pause size={14}/> Pause</>}</button><button className="task-trigger task-trigger-card" disabled={paused || busy === `${job.job_id}:trigger`} onClick={() => void onTrigger(job)}><Zap size={14}/>{busy === `${job.job_id}:trigger` ? 'Running…' : 'Trigger now'}</button><button className="task-delete-icon" disabled={Boolean(busy)} onClick={() => onDelete(job)} aria-label={`Delete ${jobTitle(job)}`} title="Delete task"><Trash2 size={17}/></button></div></article> }
function TaskMetadata({ job }: { job: CronJob }) { const paused = stateOf(job) === 'paused'; return <dl><div><dt>Schedule</dt><dd>{job.schedule || '—'}</dd></div><div><dt>Next</dt><dd>{paused ? 'Paused' : dateLabel(job.next_run_at)}</dd></div><div><dt>Last</dt><dd>{dateLabel(job.last_run_at)}</dd></div>{job.deliver && <div><dt>Deliver</dt><dd>{job.deliver}</dd></div>}{job.model && <div><dt>Model</dt><dd>{job.model}</dd></div>}</dl> }
function DeleteTaskModal({ job, deleting, onCancel, onConfirm }: { job: CronJob; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (!deleting && event.target === event.currentTarget) onCancel() }}><section className="task-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-message"><Trash2 size={22}/><h2 id="delete-task-title">Delete scheduled task?</h2><p id="delete-task-message">Delete “{jobTitle(job)}”? This will remove its schedule and prevent future runs.</p><footer><button disabled={deleting} onClick={onCancel}>Keep task</button><button className="delete" disabled={deleting} onClick={onConfirm}><Trash2 size={15}/>{deleting ? 'Deleting…' : 'Delete task'}</button></footer></section></div>
}
function TaskDetail({ job, busy, back, onRefresh, onToggle, onTrigger }: { job: CronJob; busy: string; back: () => void; onRefresh: () => Promise<void>; onToggle: (job: CronJob) => Promise<void>; onTrigger: (job: CronJob) => Promise<void> }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const [runs, setRuns] = useState<CronRun[] | null>(null)
  const [error, setError] = useState('')
  const [editPromptOpen, setEditPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(job.prompt || job.prompt_preview || '')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const state = stateOf(job); const paused = state === 'paused'; const triggering = busy === `${job.job_id}:trigger`
  useEffect(() => { setPromptDraft(job.prompt || job.prompt_preview || '') }, [job.job_id, job.prompt, job.prompt_preview])
  useEffect(() => { let active = true; void loadCronRuns(job.job_id, job.profile).then(value => { if (active) setRuns(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load run history.') }); return () => { active = false } }, [job.job_id, job.profile])
  const savePrompt = async () => { if (promptDraft === (job.prompt || job.prompt_preview || '')) { setEditPromptOpen(false); return }; setSavingPrompt(true); setError(''); try { await updateCronPrompt(job.job_id, promptDraft, job.profile); setEditPromptOpen(false); await onRefresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not save this prompt.') } finally { setSavingPrompt(false) } }
  const trigger = async () => { setError(''); try { await onTrigger(job); setRuns(await loadCronRuns(job.job_id, job.profile)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not trigger this task.') } }
  const toggle = async () => { setError(''); try { await onToggle(job) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not update this task.') } }
  return <main ref={shellRef} className="app task-detail"><header className="tasks-head"><button className="round-control" onClick={back} aria-label="Back to Tasks"><ArrowLeft size={18}/></button><b>Task details</b><button className="round-control" onClick={() => void onRefresh()} aria-label="Refresh task"><RefreshCw size={17}/></button></header><section className="task-detail-title"><div><i className={state}/><h1>{jobTitle(job)}</h1><em className={state}>{state}</em></div><div className="task-detail-actions"><button className="task-toggle" disabled={busy === `${job.job_id}:toggle`} onClick={() => void toggle()}>{paused ? <><Play size={14}/> Resume</> : <><Pause size={14}/> Pause</>}</button><button className="task-trigger" disabled={triggering} onClick={() => void trigger()}><Zap size={15}/>{triggering ? 'Running…' : 'Trigger now'}</button></div></section>{error && <p className="management-error">{error}</p>}<section className="task-detail-section"><b>Schedule</b><TaskMetadata job={job}/></section><section className="task-detail-section"><div className="task-detail-section-head"><b>Prompt</b><button className="prompt-edit-button" disabled={!job.prompt || savingPrompt} onClick={() => setEditPromptOpen(true)} aria-label={job.prompt ? 'Edit prompt' : 'Loading full prompt'}><Pencil size={14}/></button></div><pre>{job.prompt || job.prompt_preview || 'No prompt was provided.'}</pre></section><section className="task-detail-section"><b>Run history {runs ? `· ${runs.length}` : ''}</b>{runs === null ? <p>Loading run history…</p> : runs.length ? <div className="task-runs">{runs.map(run => <div key={run.id}><span>{run.title || run.preview || run.id}</span><small>{dateLabel(run.last_active || run.started_at)}</small></div>)}</div> : <p>No completed runs yet.</p>}</section>{editPromptOpen && <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditPromptOpen(false) }}><section className="task-prompt-modal" role="dialog" aria-modal="true" aria-label="Edit task prompt"><header><b>Edit prompt</b><button onClick={() => setEditPromptOpen(false)} aria-label="Close prompt editor">×</button></header><textarea autoFocus value={promptDraft} onChange={event => setPromptDraft(event.target.value)} /><footer><button onClick={() => { setPromptDraft(job.prompt || job.prompt_preview || ''); setEditPromptOpen(false) }}>Cancel</button><button className="save" disabled={savingPrompt || !promptDraft.trim()} onClick={() => void savePrompt()}>{savingPrompt ? 'Saving…' : 'Save prompt'}</button></footer></section></div>}</main>
}
