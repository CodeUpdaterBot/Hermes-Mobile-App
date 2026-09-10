import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Plus, X } from 'lucide-react'

import { errorMessage } from '../connection-state'
import { useEdgeSwipeBack } from '../edge-swipe'
import { createCronJob, instantiateCronBlueprint, loadCronBlueprints, loadCronDeliveryTargets, loadModelOptions, type AutomationBlueprint, type CronDeliveryTarget, type LiveProfile, type ModelOptions } from '../hermes'

type Props = { profiles: LiveProfile[]; onClose: () => void; onCreated: () => Promise<void> }
const frequencies = [{ id: 'daily', label: 'Daily at 9:00 AM', schedule: '0 9 * * *' }, { id: 'weekdays', label: 'Weekdays at 9:00 AM', schedule: '0 9 * * 1-5' }, { id: 'hourly', label: 'Every hour', schedule: '0 * * * *' }, { id: 'every-15', label: 'Every 15 minutes', schedule: '*/15 * * * *' }, { id: 'custom', label: 'Custom schedule', schedule: '' }]
const titleizeBot = (value: string) => value.split(/[-_\s]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

export function NewTaskSheet({ profiles, onClose, onCreated }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, onClose)
  const [blueprints, setBlueprints] = useState<AutomationBlueprint[]>([])
  const [targets, setTargets] = useState<CronDeliveryTarget[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOptions>({})
  const [template, setTemplate] = useState('custom')
  const [bot, setBot] = useState(profiles[0]?.name || '')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState('daily')
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [deliver, setDeliver] = useState<string[]>(() => profiles[0] ? [`bot-chat:${profiles[0].name}`] : [])
  const [modelChoice, setModelChoice] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedBlueprint = blueprints.find(item => item.key === template)
  const modelOptionsFlat = useMemo(() => (modelOptions.providers || []).flatMap(provider => (provider.featured_models?.length ? provider.featured_models : provider.models || []).map(model => ({ model, provider: provider.slug, label: `${provider.name} · ${model}` }))), [modelOptions])
  const botDeliveryTargets = useMemo(() => {
    const profileByName = new Map(profiles.map(profile => [profile.name, profile]))
    const discovered = targets.filter(target => target.id.startsWith('bot-chat:'))
    const source = discovered.length ? discovered : profiles.map(profile => ({ id: `bot-chat:${profile.name}`, name: profile.name, home_target_set: true }))
    return source.map(target => {
      const profileName = target.id.slice('bot-chat:'.length)
      const profile = profileByName.get(profileName)
      return { ...target, name: profile?.display_name || titleizeBot(profileName) }
    })
  }, [profiles, targets])

  useEffect(() => { let active = true; void Promise.all([loadCronBlueprints(), loadCronDeliveryTargets(), loadModelOptions(bot)]).then(([nextBlueprints, nextTargets, nextModels]) => { if (!active) return; setBlueprints(nextBlueprints); setTargets(nextTargets); setModelOptions(nextModels) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load New Task options.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [bot])
  useEffect(() => { if (!selectedBlueprint) return; const seeded: Record<string, string> = {}; selectedBlueprint.fields.forEach(field => { seeded[field.name] = field.name === 'deliver' ? (bot ? `bot-chat:${bot}` : '') : field.default || '' }); setValues(seeded) }, [selectedBlueprint, bot])
  const submit = async () => {
    setSaving(true); setError('')
    try {
      if (!bot) throw new Error('Choose a Bot for this task.')
      const selectedDeliveries = selectedBlueprint ? (values.deliver || '').split(',').filter(Boolean) : deliver
      if (!selectedDeliveries.length) throw new Error('Select at least one Bot to receive this task.')
      if (selectedBlueprint) { await instantiateCronBlueprint(bot, selectedBlueprint.key, { ...values, deliver: selectedDeliveries.join(',') }) }
      else {
        if (!prompt.trim()) throw new Error('Prompt is required.')
        if (!schedule.trim()) throw new Error('Schedule is required.')
        const [provider, ...modelParts] = modelChoice.split(':'); const model = modelParts.join(':')
        await createCronJob(bot, { name: name.trim() || undefined, prompt: prompt.trim(), schedule: schedule.trim(), deliver: selectedDeliveries.join(','), ...(model ? { model, provider } : {}) })
      }
      await onCreated(); onClose()
    } catch (reason) { setError(errorMessage(reason, 'Hermes could not create this task.')) } finally { setSaving(false) }
  }
  const toggleDelivery = (id: string) => setDeliver(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  return <main ref={shellRef} className="app task-create-sheet"><header className="task-create-head"><button className="round-control" onClick={onClose} aria-label="Close new task"><ArrowLeft size={18}/></button><span><b>New task</b><small>Schedule an automated Hermes prompt</small></span><button className="round-control" onClick={onClose} aria-label="Close new task"><X size={17}/></button></header><div className="task-create-scroll">
    <FormLabel title="Start from" hint="Use a Hermes template or configure a custom task."><select value={template} onChange={event => setTemplate(event.target.value)}><option value="custom">Custom</option>{blueprints.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></FormLabel>
    <FormLabel title="Bot" hint="The task will be stored in this Bot’s cron schedule."><select value={bot} onChange={event => { const next = event.target.value; setBot(next); setDeliver(next ? [`bot-chat:${next}`] : []); setValues(current => ({ ...current, deliver: next ? `bot-chat:${next}` : '' })) }}>{profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.display_name || titleizeBot(profile.name)}</option>)}</select></FormLabel>
    {selectedBlueprint ? <section className="task-template-note"><b>{selectedBlueprint.title}</b><span>{selectedBlueprint.description}</span></section> : <><FormLabel title="Name" optional><input value={name} onChange={event => setName(event.target.value)} placeholder="Morning briefing" /></FormLabel><FormLabel title="Prompt" hint="This is what Hermes runs on each scheduled execution."><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Summarize my unread Slack threads and email me the top 5…" /></FormLabel></>}
    {selectedBlueprint ? <section className="task-slot-section"><h3>Template options</h3>{selectedBlueprint.fields.filter(field => field.name !== 'deliver').map(field => <FormLabel key={field.name} title={field.label} optional={field.optional} hint={field.help}><Slot field={field} value={values[field.name] || ''} onChange={value => setValues(current => ({ ...current, [field.name]: value }))}/></FormLabel>)}</section> : <FormLabel title="Frequency"><select value={frequency} onChange={event => { const next = event.target.value; setFrequency(next); const found = frequencies.find(item => item.id === next); if (found?.schedule) setSchedule(found.schedule) }}>{frequencies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{frequency === 'custom' && <input className="schedule-input" value={schedule} onChange={event => setSchedule(event.target.value)} placeholder="0 9 * * * or weekdays at 9am" />}<small className="field-help">Cron expression or phrases like “every hour” or “weekdays at 9am”.</small></FormLabel>}
    <section className="task-form-section"><h3>Deliver to</h3><div className="task-delivery-list">{botDeliveryTargets.map(target => { const selected = selectedBlueprint ? (values.deliver || '').split(',').includes(target.id) : deliver.includes(target.id); return <label key={target.id}><input type="checkbox" checked={selected} onChange={() => selectedBlueprint ? setValues(current => ({ ...current, deliver: target.id })) : toggleDelivery(target.id)} /><span><b>{target.name}</b></span>{selected && <Check size={15}/>}</label> })}</div>{!botDeliveryTargets.length && <p className="management-error">No Bots are available to receive this task.</p>}</section>
    {!selectedBlueprint && <FormLabel title="Model" optional><select value={modelChoice} onChange={event => setModelChoice(event.target.value)}><option value="">Default (global model)</option>{modelOptionsFlat.map(option => <option key={`${option.provider}:${option.model}`} value={`${option.provider}:${option.model}`}>{option.label}</option>)}</select></FormLabel>}
    {error && <p className="management-error">{error}</p>}
  </div><footer className="task-create-footer"><button onClick={onClose}>Cancel</button><button className="create" disabled={saving || loading} onClick={() => void submit()}><Plus size={15}/>{saving ? 'Creating…' : 'Create task'}</button></footer></main>
}
function FormLabel({ title, hint, optional, children }: { title: string; hint?: string; optional?: boolean; children: ReactNode }) { return <label className="task-form-label"><span>{title}{optional && <em>Optional</em>}</span>{children}{hint && <small className="field-help">{hint}</small>}</label> }
function Slot({ field, value, onChange }: { field: AutomationBlueprint['fields'][number]; value: string; onChange: (value: string) => void }) { if (field.type === 'enum' || field.type === 'weekdays') return <select value={value} onChange={event => onChange(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>; return <input type={field.type === 'time' ? 'time' : 'text'} value={value} onChange={event => onChange(event.target.value)} placeholder={field.help || field.label}/> }
