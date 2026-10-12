import { invoke } from '@tauri-apps/api/core'

import { HermesGatewayClient, type GatewayEvent, type ServerRequest, type ServerRequestReply } from './gateway'
import type { RosterProfile } from './live-model'
import type { DisplayObserve, DisplayStatus } from './display'

export type LiveProfile = RosterProfile
export type LiveSession = { id: string; title: string; preview: string; profile: string; model?: string; unread?: boolean; last_active?: number }
export type LiveUsage = { model?: string; input?: number; output?: number; reasoning?: number; prompt?: number; completion?: number; total?: number; calls?: number; avg_tps?: number; avg_latency_s?: number }
export type LiveMessage = { id: number; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; tool_name?: string | null; tool_status?: 'running' | 'done' | 'failed'; duration_s?: number; reasoning?: string | null; timestamp?: number; token_count?: number | null; usage?: LiveUsage }
export type ModelProvider = { name: string; slug: string; models?: string[]; featured_models?: string[]; authenticated?: boolean }
export type ModelOptions = { model?: string; provider?: string; providers?: ModelProvider[] }
export type SlashCompletion = { text: string; display?: string; meta?: string; kind?: 'skill' | 'command' }
export type DisplayThumbnail = { data_url?: string | null; suppressed?: string | null }
export type SlashCompletionResult = { items?: SlashCompletion[]; replace_from?: number }
export type Capability = { name: string; description?: string; label?: string; tool_count?: number; enabled: boolean }
export type ProfileDetails = {
  name: string
  description?: string
  soul?: string
  model?: { provider?: string; default?: string }
  skills?: Capability[]
  toolsets?: Capability[]
}
export type SkillSearchResult = { name: string; description?: string }
export type CronJob = {
  job_id: string
  id?: string
  name?: string
  prompt?: string
  prompt_preview?: string
  schedule?: string
  enabled?: boolean
  state?: string
  next_run_at?: string
  last_run_at?: string
  last_status?: string
  last_error?: string
  deliver?: string
  model?: string
  provider?: string
  profile?: string
}
export type CronList = { jobs?: CronJob[]; scoped?: string }
export type CronRun = { id: string; title?: string; preview?: string; last_active?: number; started_at?: number }
export type CronDeliveryTarget = { id: string; name: string; home_target_set: boolean }
export type AutomationBlueprintField = { name: string; type: 'enum' | 'text' | 'time' | 'weekdays'; label: string; default: string | null; options: string[]; optional: boolean; help: string }
export type AutomationBlueprint = { key: string; title: string; description: string; category: string; tags: string[]; fields: AutomationBlueprintField[] }
type Snapshot = { sessions: { sessions: LiveSession[] } }

export function buildCanonicalSessionParams(profile: string): Record<string, unknown> {
  return {
    profile,
    title: 'Bot Chat',
    hidden: true,
    follow_profile_config: true,
  }
}

export const localHermes = 'http://127.0.0.1:9119'
let activeHermes = localHermes
export function setActiveHermesEndpoint(endpoint: string) { activeHermes = endpoint.replace(/\/$/, '') }

/**
 * The endpoint this client is pointed at, for URLs the native layer does not build.
 * The gateway socket's own URL comes from Rust (`hermes_ws_url`) because it needs a
 * minted ticket; the Bot Desktop socket is authorised by ITS ticket in the query
 * string instead, so its URL is plain string work.
 */
export function activeHermesEndpoint(): string { return activeHermes }

const gateways = new Map<string, HermesGatewayClient>()
const resolvedSessions = new Map<string, string>()

function gateway(baseUrl = activeHermes) {
  let client = gateways.get(baseUrl)
  if (!client) {
    client = new HermesGatewayClient(() => invoke<string>('hermes_ws_url', { baseUrl }))
    gateways.set(baseUrl, client)
  }
  return client
}

/**
 * Answer host-initiated requests (the `clarify` tool) for a given host.
 *
 * Registered on the shared client because the socket is per-host and durable: a
 * second connection would not receive the question at all.
 */
export function setServerRequestHandler(handler?: (request: ServerRequest) => Promise<ServerRequestReply>, baseUrl = activeHermes): void {
  gateway(baseUrl).setRequestHandler(handler)
}

async function rpcCall<T>(method: string, params: Record<string, unknown>, baseUrl = activeHermes): Promise<T> {
  return gateway(baseUrl).call<T>(method, params)
}

export async function probeHermesGateway(baseUrl: string): Promise<{ version?: string; auth_required?: boolean; auth_flows?: string[]; auth_providers?: unknown[]; [key: string]: unknown }> {
  const raw = await invoke<string>('hermes_connection_probe', { baseUrl })
  return JSON.parse(raw) as { version?: string; auth_required?: boolean; auth_flows?: string[]; auth_providers?: unknown[]; [key: string]: unknown }
}

export async function savedHermesEndpoint(): Promise<string | null> {
  return invoke<string | null>('hermes_saved_endpoint')
}

export async function passwordSignIn(baseUrl: string, username: string, password: string): Promise<void> {
  await invoke('hermes_password_sign_in', { baseUrl, username, password })
  setActiveHermesEndpoint(baseUrl)
}

export async function nativeSignIn(baseUrl: string): Promise<void> {
  await invoke('hermes_native_sign_in', { baseUrl })
  setActiveHermesEndpoint(baseUrl)
}

export async function loadSnapshot(baseUrl = activeHermes): Promise<{ profiles: LiveProfile[]; sessions: LiveSession[] }> {
  // On Android the secure credential backend is native. Sequence the native
  // REST read before minting the WebSocket ticket to avoid concurrent keyring
  // reads during the first authenticated handoff.
  const raw = await invoke<string>('hermes_snapshot', { baseUrl })
  const roster = await rpcCall<{ profiles: LiveProfile[] }>('profiles.list', { include_sessions: true }, baseUrl)
  const snapshot = JSON.parse(raw) as Snapshot
  return { profiles: roster.profiles, sessions: snapshot.sessions.sessions }
}

export async function createProfile(input: { name: string; description: string; soul: string; model?: string; provider?: string; shape?: string; color?: string; title?: string }, baseUrl = activeHermes): Promise<void> {
  await rpcCall('profiles.create', {
    name: input.name,
    description: input.description,
    soul: input.soul,
    model: input.model || '',
    provider: input.provider || '',
    mirror_credentials: true,
    share_auth: true,
    clone_all: false,
    no_skills: false,
  }, baseUrl)

  if (input.shape) {
    await rpcCall('profiles.configure', {
      name: input.name,
      ui_meta: {
        'hermes-bots': {
          shape: input.shape,
          ...(input.color ? { color: input.color } : {}),
          imageKind: 'shape',
          title: input.title || '',
          custom: true,
        },
      },
    }, baseUrl)
  }

  // Hermes Desktop births a Bot's canonical hidden conversation immediately
  // after creating the profile. Without this step the roster refresh has no
  // Bot Chat to resolve and the user lands back on the inbox instead of the
  // new conversation.
  const client = gateway(baseUrl)
  const created = await client.call<{ session_id?: string; stored_session_id?: string }>('session.create', buildCanonicalSessionParams(input.name))
  if (created.session_id) {
    await client.call('session.title', { session_id: created.session_id, title: 'Bot Chat' })
  }
}

export async function loadMessages(sessionId: string, profile: string, baseUrl = activeHermes): Promise<LiveMessage[]> {
  const raw = await invoke<string>('hermes_session_messages', { baseUrl, sessionId, profile })
  return (JSON.parse(raw) as { messages: LiveMessage[] }).messages
}

export async function transcribeAudio(profile: string, dataUrl: string, mimeType: string, baseUrl = activeHermes): Promise<string> {
  const raw = await invoke<string>('hermes_transcribe', { baseUrl, profile, dataUrl, mimeType })
  const result = JSON.parse(raw) as { text?: string; transcript?: string }
  return result.text || result.transcript || ''
}

export async function loadModelOptions(profile: string, baseUrl = activeHermes): Promise<ModelOptions> {
  const raw = await invoke<string>('hermes_model_options', { baseUrl, profile })
  return JSON.parse(raw) as ModelOptions
}

export async function loadProfileAvatar(profile: string, baseUrl = activeHermes): Promise<string | null> {
  const result = await rpcCall<{ found?: boolean; data?: string }>('profiles.get_asset', { name: profile, asset: 'avatar' }, baseUrl)
  return result.found && result.data ? result.data : null
}

export async function loadProfileDetails(profile: string, baseUrl = activeHermes): Promise<ProfileDetails> {
  return rpcCall<ProfileDetails>('profiles.describe', { name: profile }, baseUrl)
}

// ── Group chats (hosted rooms) ────────────────────────────────────────────────
// Contract: tui_gateway/contracts/groups_bot_relay.py.
// NOTE the addressing difference: the groups.* handlers resolve their profile from
// `profile`, while profiles.* use `name`. `groups.create` also spends `name` on the
// ROOM's name, so the two must not be confused.
// Discovery does NOT need these: membership rides each Bot's profile metadata
// (`ui_meta['hermes-bots'].groups`) and is aggregated in src/groups.ts.

export type GroupCapabilities = { protocol_version?: number; driver?: boolean; persistent_process?: boolean; features?: string[]; methods?: string[]; max_log_limit?: number }
export type GroupMember = { member_id?: string; profile?: string; handle?: string; display_name?: string }
export type GroupRoom = { room_id: string; name: string; members?: GroupMember[]; revision?: number; latest_seq?: number | null; disbanded_at?: number | null }
export type GroupEvent = { seq: number; kind: string; actor?: { kind: string; id: string }; payload?: Record<string, unknown>; created_at?: number }

/** `driver: false` means this gateway will accept no room turns — the UI must say so. */
export async function loadGroupCapabilities(profile: string, baseUrl = activeHermes): Promise<GroupCapabilities> {
  return rpcCall<GroupCapabilities>('groups.capabilities', { profile }, baseUrl)
}

/**
 * Mint a fresh live session for a profile — "new chat with this Bot".
 *
 * A Bot's Chat is its canonical session, and a long-lived one eventually fills its
 * history; this is how a user starts clean without creating a second Bot. Hermes mints
 * the id (the stored row appears on the first prompt), so the caller opens what comes
 * back rather than guessing an id.
 */
export async function createSession(profile: string, baseUrl = activeHermes): Promise<string> {
  const result = await rpcCall<{ session_id?: string }>('session.create', { profile }, baseUrl)
  if (!result?.session_id) throw new Error('Hermes did not return the new chat’s id.')
  return result.session_id
}

export async function listGroups(profile: string, baseUrl = activeHermes): Promise<GroupRoom[]> {
  const result = await rpcCall<{ rooms?: GroupRoom[] }>('groups.list', { profile }, baseUrl)
  return result.rooms || []
}

export async function loadGroupLog(profile: string, roomId: string, sinceSeq?: number, baseUrl = activeHermes): Promise<{ events: GroupEvent[]; cursor?: number; latest_seq?: number; has_more?: boolean }> {
  return rpcCall('groups.log', { profile, room_id: roomId, ...(typeof sinceSeq === 'number' ? { since_seq: sinceSeq } : {}) }, baseUrl)
}

export async function createGroup(
  profile: string,
  room: { roomId: string; name: string; members: GroupMember[] },
  baseUrl = activeHermes,
): Promise<GroupRoom | undefined> {
  const result = await rpcCall<{ room?: GroupRoom }>('groups.create', {
    profile, room_id: room.roomId, name: room.name, members: room.members,
  }, baseUrl)
  return result.room
}

/** Appends one `message.user`; `payload` takes exactly `{ text, thread_id }`, and the
 *  gateway also needs the client's idempotency key (`event_id must be a string`). */
export async function sendGroupMessage(profile: string, roomId: string, text: string, threadId: string, eventId: string, baseUrl = activeHermes): Promise<void> {
  await rpcCall('groups.send', { profile, room_id: roomId, event_id: eventId, payload: { text, thread_id: threadId } }, baseUrl)
}

/**
 * Writes a Bot's group memberships into its profile metadata. The configure handler
 * merges `ui_meta` key-wise, so the WHOLE `hermes-bots` object must be sent or the
 * Bot's shape/colour/title are dropped. The legacy singular `group` key is left
 * alone — `groups` is the shape Hermes Desktop writes for a multi-group Bot.
 */
export async function setProfileGroups(
  profile: { name: string; ui_meta?: { 'hermes-bots'?: Record<string, unknown> } },
  groups: string[],
  baseUrl = activeHermes,
): Promise<void> {
  const existing = profile.ui_meta?.['hermes-bots'] || {}
  const result = await rpcCall<{ ok?: boolean; applied?: { ui_meta?: boolean; ui_meta_conflicts?: Record<string, unknown> } }>('profiles.configure', {
    name: profile.name,
    ui_meta: { 'hermes-bots': { ...existing, groups } },
  }, baseUrl)
  // The gateway SWALLOWS a failed ui_meta write: it reports ok:false + applied.ui_meta
  // rather than raising. Ignoring that reports a refused write as success, so treat it
  // as the failure it is and name it.
  if (result?.ok === false || result?.applied?.ui_meta === false) {
    const conflict = result?.applied?.ui_meta_conflicts ? ' (the Bot metadata moved on)' : ''
    throw new Error(`Hermes did not save @${profile.name}’s group membership${conflict}.`)
  }
}

// ── the Bot's own computer (display.*) ────────────────────────────────────────
// Verified contract: tui_gateway/contracts/display.py. All are profile-scoped.

export async function loadDisplayStatus(profile: string, baseUrl = activeHermes): Promise<DisplayStatus> {
  return rpcCall<DisplayStatus>('display.status', { profile }, baseUrl)
}

export async function grabDisplayThumbnail(profile: string, baseUrl = activeHermes): Promise<DisplayThumbnail> {
  return rpcCall<DisplayThumbnail>('display.thumbnail', { profile }, baseUrl)
}

export async function startDisplay(profile: string, baseUrl = activeHermes): Promise<DisplayStatus> {
  return rpcCall<DisplayStatus>('display.start', { profile }, baseUrl)
}

/**
 * Mint the RFB ticket + viewer id for this profile's screen (`display.observe`).
 *
 * The host refuses the ticket while the screen is stopped, so this is only called
 * once `display.status` reports a running screen. Passing a `viewerId` this
 * connection minted earlier keeps its identity across a reconnect — which is what
 * lets a client that lost its socket take control again without being a stranger.
 */
export async function observeDisplay(profile: string, viewerId?: string, baseUrl = activeHermes): Promise<DisplayObserve> {
  return rpcCall<DisplayObserve>('display.observe', { profile, ...(viewerId ? { viewer_id: viewerId } : {}) }, baseUrl)
}

/**
 * Take over / hand back the screen.
 *
 * The method names are dotted (`display.lease.acquire`) because that is the name the
 * host registers and documents in `tui_gateway/contracts/display.py`; the underscore
 * spelling these helpers used before matched nothing and always failed. The lease
 * names a `viewer_id`, and the host rejects one this connection did not mint.
 */
export async function acquireDisplayLease(profile: string, viewerId: string, baseUrl = activeHermes): Promise<unknown> {
  return rpcCall('display.lease.acquire', { profile, viewer_id: viewerId }, baseUrl)
}

export async function releaseDisplayLease(profile: string, viewerId: string, baseUrl = activeHermes): Promise<unknown> {
  return rpcCall('display.lease.release', { profile, viewer_id: viewerId }, baseUrl)
}

export async function attachFile(sessionId: string, profile: string, input: { name: string; dataUrl: string; path?: string }, baseUrl = activeHermes): Promise<{ name: string; refText: string }> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  const result = await gateway(baseUrl).attachFile(resolved, { name: input.name, data_url: input.dataUrl, path: input.path })
  if (result.attached !== true || !result.ref_text) throw new Error(`Hermes could not attach “${input.name}”.`)
  return { name: result.name || input.name, refText: result.ref_text }
}

export async function completeSlash(sessionId: string, profile: string, text: string, baseUrl = activeHermes): Promise<SlashCompletionResult> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  return gateway(baseUrl).call<SlashCompletionResult>('complete.slash', { session_id: resolved, profile, text })
}

export async function setProfileDescription(profile: string, description: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; applied?: { description?: boolean } }>('profiles.configure', { name: profile, description }, baseUrl)
  if (result.ok === false || result.applied?.description === false) throw new Error('Hermes could not save this Bot’s description.')
}

export function capabilityUpdatePayload(skills: Capability[], toolsets: Capability[]): { disabled_skills: string[]; enabled_toolsets: string[] } {
  const enabledToolsets = toolsets.filter(item => item.enabled).map(item => item.name)
  if (toolsets.length && enabledToolsets.length === 0) throw new Error('Select at least one toolset. Hermes uses an empty selection to restore its default tools.')
  return {
    disabled_skills: skills.filter(item => !item.enabled).map(item => item.name),
    enabled_toolsets: enabledToolsets.length === toolsets.length ? [] : enabledToolsets,
  }
}

export async function setProfileCapabilities(profile: string, skills: Capability[], toolsets: Capability[], baseUrl = activeHermes): Promise<void> {
  const payload = capabilityUpdatePayload(skills, toolsets)
  const result = await rpcCall<{ ok?: boolean; applied?: { skills?: boolean; toolsets?: boolean } }>('profiles.configure', {
    name: profile,
    ...payload,
  }, baseUrl)
  if (result.ok === false || result.applied?.skills === false || result.applied?.toolsets === false) throw new Error('Hermes could not update this Bot’s capabilities.')
}

export async function searchHubSkills(profile: string, query: string, baseUrl = activeHermes): Promise<SkillSearchResult[]> {
  const result = await rpcCall<{ results?: SkillSearchResult[] }>('skills.manage', { action: 'search', profile, query }, baseUrl)
  return Array.isArray(result.results) ? result.results : []
}

export async function installHubSkill(profile: string, name: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ installed?: boolean }>('skills.manage', { action: 'install', profile, query: name }, baseUrl)
  if (result.installed !== true) throw new Error(`Hermes could not install “${name}”.`)
}

const cronText = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
const cronScheduleText = (job: Record<string, unknown>): string | undefined => {
  const explicit = cronText(job.schedule_display)
  if (explicit) return explicit
  const schedule = job.schedule
  if (schedule && typeof schedule === 'object') {
    const fields = schedule as Record<string, unknown>
    return cronText(fields.display) || cronText(fields.expr)
  }
  return cronText(schedule)
}

export function normalizeCronJob(job: Partial<CronJob> | Record<string, unknown>, profile = ''): CronJob {
  const raw = job as Record<string, unknown>
  const jobId = String(raw.job_id || raw.id || '').trim()
  if (!jobId) throw new Error('Hermes returned task details without a job ID.')
  return {
    job_id: jobId,
    ...(cronText(raw.id) ? { id: cronText(raw.id) } : {}),
    ...(cronText(raw.name) ? { name: cronText(raw.name) } : {}),
    ...(cronText(raw.prompt) ? { prompt: cronText(raw.prompt) } : {}),
    ...(cronText(raw.prompt_preview) ? { prompt_preview: cronText(raw.prompt_preview) } : {}),
    ...(cronScheduleText(raw) ? { schedule: cronScheduleText(raw) } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(cronText(raw.state) ? { state: cronText(raw.state) } : {}),
    ...(cronText(raw.next_run_at) ? { next_run_at: cronText(raw.next_run_at) } : {}),
    ...(cronText(raw.last_run_at) ? { last_run_at: cronText(raw.last_run_at) } : {}),
    ...(cronText(raw.last_status) ? { last_status: cronText(raw.last_status) } : {}),
    ...(cronText(raw.last_error) ? { last_error: cronText(raw.last_error) } : {}),
    ...(cronText(raw.deliver) ? { deliver: cronText(raw.deliver) } : {}),
    ...(cronText(raw.model) ? { model: cronText(raw.model) } : {}),
    ...(cronText(raw.provider) ? { provider: cronText(raw.provider) } : {}),
    ...(profile || cronText(raw.profile) ? { profile: profile || cronText(raw.profile) } : {}),
  }
}

export async function loadCronJobs(profile?: string, baseUrl = activeHermes): Promise<CronJob[]> {
  const result = await rpcCall<CronList>('cron.manage', { action: 'list', include_disabled: true, ...(profile ? { profile } : {}) }, baseUrl)
  return Array.isArray(result.jobs) ? result.jobs.map(job => normalizeCronJob(job, result.scoped || profile || job.profile || '')) : []
}

export async function loadCronJob(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_cron_job', { baseUrl, jobId, profile })
  return normalizeCronJob(JSON.parse(raw) as Partial<CronJob>, profile)
}

export async function loadCronRuns(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronRun[]> {
  const raw = await invoke<string>('hermes_cron_runs', { baseUrl, jobId, profile })
  const result = JSON.parse(raw) as { runs?: CronRun[] }
  return Array.isArray(result.runs) ? result.runs : []
}

export async function triggerCronJob(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_trigger_cron', { baseUrl, jobId, profile })
  return JSON.parse(raw) as CronJob
}

export async function loadCronBlueprints(baseUrl = activeHermes): Promise<AutomationBlueprint[]> {
  const raw = await invoke<string>('hermes_cron_blueprints', { baseUrl })
  const result = JSON.parse(raw) as { blueprints?: AutomationBlueprint[] }
  return Array.isArray(result.blueprints) ? result.blueprints : []
}

export async function loadCronDeliveryTargets(baseUrl = activeHermes): Promise<CronDeliveryTarget[]> {
  const raw = await invoke<string>('hermes_cron_delivery_targets', { baseUrl })
  const result = JSON.parse(raw) as { targets?: CronDeliveryTarget[] }
  return Array.isArray(result.targets) ? result.targets : []
}

export async function createCronJob(profile: string, body: { name?: string; prompt: string; schedule: string; deliver?: string; model?: string; provider?: string }, baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_create_cron', { baseUrl, profile, body })
  return JSON.parse(raw) as CronJob
}

export async function instantiateCronBlueprint(profile: string, blueprint: string, values: Record<string, string>, baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_instantiate_cron_blueprint', { baseUrl, profile, body: { blueprint, values } })
  return JSON.parse(raw) as CronJob
}

export async function updateCronPrompt(jobId: string, prompt: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_update_cron_prompt', { baseUrl, jobId, profile, prompt })
  return JSON.parse(raw) as CronJob
}

export async function updateCronJob(jobId: string, action: 'pause' | 'resume' | 'remove', profile?: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean }>('cron.manage', { action, name: jobId, ...(profile ? { profile } : {}) }, baseUrl)
  if (result.ok === false) throw new Error(`Hermes could not ${action} this scheduled task.`)
}

export async function setProfileSoul(profile: string, soul: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; applied?: { soul?: boolean } }>('profiles.configure', { name: profile, soul }, baseUrl)
  if (result.ok === false || result.applied?.soul === false) throw new Error('Hermes could not save this Bot’s SOUL.md.')
}

export async function setProfileModel(profile: string, provider: string, model: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; confirm_required?: boolean; confirm_message?: string }>('profiles.configure', { name: profile, provider, model }, baseUrl)
  if (result.confirm_required) throw new Error(result.confirm_message || 'This model requires confirmation in Hermes Desktop before it can become the Bot default.')
  if (result.ok === false) throw new Error('Hermes could not update the Bot default model.')
}

export async function setSessionModel(sessionId: string, profile: string, provider: string, model: string, baseUrl = activeHermes): Promise<void> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  await gateway(baseUrl).setSessionModel(resolved, provider, model)
}

export async function setSessionReasoning(sessionId: string, profile: string, effort: string, baseUrl = activeHermes): Promise<void> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  await gateway(baseUrl).setSessionReasoning(resolved, effort)
}

export async function connectAndSubmit(
  sessionId: string,
  profile: string,
  text: string,
  onEvent: (type: string, payload: Record<string, unknown>, event?: GatewayEvent) => void,
  baseUrl = activeHermes,
): Promise<void> {
  const client = gateway(baseUrl)
  const resolvedSessionId = await client.resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolvedSessionId)
  await client.submitPrompt(resolvedSessionId, text, event => onEvent(event.type, event.payload, event))
}

export async function interruptSession(sessionId: string, baseUrl = activeHermes): Promise<void> {
  await gateway(baseUrl).interruptSession(resolvedSessions.get(`${baseUrl}:${sessionId}`) || sessionId)
}
