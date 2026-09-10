import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, GitBranch, Globe2, Heart, LoaderCircle, LockKeyhole, ShieldCheck, Smartphone, Wifi } from 'lucide-react'

import HermesMobileAboutMark from '../assets/HermesMobileAboutMark.png'
import { errorMessage, supportsBasicAuth } from '../connection-state'
import { useEdgeSwipeBack } from '../edge-swipe'
import { nativeSignIn, passwordSignIn, probeHermesGateway } from '../hermes'

const HermesMobileLogo = HermesMobileAboutMark

type Theme = 'dark' | 'light' | 'grey' | 'aurora'
type Page = 'root' | 'pairing' | 'about'

type Props = {
  profiles: number
  sessions: number
  connected: boolean
  endpoint?: string
  theme: Theme
  setTheme: (theme: Theme) => void
  close: () => void
  refresh: () => Promise<unknown>
  onPairingBusy: (busy: boolean) => void
  onPaired: (endpoint: string) => Promise<void>
}

const themes: Array<{ id: Theme; label: string; description: string }> = [
  { id: 'dark', label: 'OLED dark', description: 'Deep black with violet accents' },
  { id: 'light', label: 'Light', description: 'Cool, layered blue-gray surfaces' },
  { id: 'grey', label: 'Graphite', description: 'Neutral grey with cool surfaces' },
  { id: 'aurora', label: 'Aurora', description: 'Midnight navy with teal-violet glow' },
]

const external = (href: string) => ({ href, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); void invoke('open_external_url', { url: href }).catch(() => window.open(href, '_blank', 'noopener,noreferrer')) } })

function Header({ title, subtitle, back, compact = false }: { title: string; subtitle: string; back: () => void; compact?: boolean }) {
  return <header className={`panel-head connection-head${compact ? ' compact' : ''}`}>
    <button className="back-button" onClick={back} aria-label="Back"><ArrowLeft size={19}/></button>
    {!compact && <div><h2>{title}</h2><p>{subtitle}</p></div>}
  </header>
}

function AboutHermesMobile({ back }: { back: () => void }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  return <main ref={shellRef} className="app panel about-screen">
    <Header title="" subtitle="" back={back} compact/>
    <section className="about-hero">
      <div className="about-logo-card"><img src={HermesMobileLogo} alt="Hermes Mobile logo"/></div>
      <h1>Hermes Mobile</h1>
      <p className="about-meta">A companion for Hermes Desktop <i aria-hidden="true">|</i> Version 0.1.1</p>
      <span>Control your Hermes workspace from wherever you are.</span>
    </section>
    <section className="about-story">
      <p>I fell in love with Hermes after using the new Bot capabilities, and started building the mobile client I wanted: a polished, host-first companion for controlling your Hermes Bots from your phone.</p>
      <p>Your computer &amp; hermes setup still remains the authority for your agents, credentials, approvals, tools, sessions, and files. Hermes Mobile is the mission-control surface in your pocket, similar to Grok Bot! Hope you enjoy it as much as I do.</p>
      <p className="about-signoff">- Creator <a {...external('https://stestein.com/')}>SteStein.com</a></p>
    </section>
    <section className="about-links" aria-label="Hermes Mobile and Hermes links">
      <p>HERMES MOBILE</p>
      <a {...external('https://github.com/CodeUpdaterBot/Hermes-Mobile-App')}><GitBranch size={18}/><span><b>Hermes Mobile on GitHub</b><small>Source, releases, and feedback</small></span><ExternalLink size={16}/></a>
      <p>HERMES</p>
      <a {...external('https://hermes-agent.nousresearch.com/')}><Globe2 size={18}/><span><b>Hermes Agent</b><small>Official website</small></span><ExternalLink size={16}/></a>
      <a {...external('https://hermes-agent.nousresearch.com/docs/')}><Globe2 size={18}/><span><b>Documentation</b><small>Guides for hosts, gateways, and Bots</small></span><ExternalLink size={16}/></a>
      <a {...external('https://github.com/NousResearch/hermes-agent')}><GitBranch size={18}/><span><b>Hermes Agent on GitHub</b><small>Open-source agent runtime</small></span><ExternalLink size={16}/></a>
      <a {...external('https://discord.gg/NousResearch')}><Heart size={18}/><span><b>Nous Research Discord</b><small>Community and support</small></span><ExternalLink size={16}/></a>
    </section>
    <p className="about-footer">An independent community project, unaffiliated with Nous Research or Hermes Agent. Built with appreciation for the Hermes community.</p>
  </main>
}

function PairingSettings({ back, onPaired, onPairingBusy, initialEndpoint }: { back: () => void; onPaired: (endpoint: string) => Promise<void>; onPairingBusy: (busy: boolean) => void; initialEndpoint?: string }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const [gatewayUrl, setGatewayUrl] = useState(initialEndpoint || '')
  const [checking, setChecking] = useState(false)
  const [verifiedEndpoint, setVerifiedEndpoint] = useState<string | null>(null)
  const [passwordAuth, setPasswordAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const probeEpochRef = useRef(0)
  const testGateway = async () => {
    const value = gatewayUrl.trim().replace(/\/$/, '')
    if (!value) { setResult({ tone: 'error', text: 'Enter your Windows PC’s Tailscale or HTTPS gateway URL first.' }); return }
    const probeEpoch = ++probeEpochRef.current
    setChecking(true); setResult(null); setVerifiedEndpoint(null); setPasswordAuth(false); setPassword('')
    try {
      const status = await probeHermesGateway(value)
      if (probeEpoch !== probeEpochRef.current) return
      const host = new URL(value).hostname.toLowerCase()
      const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
      if (!loopback && status.auth_required !== true) {
        setResult({ tone: 'error', text: 'This remote gateway is reachable but does not require authentication. Secure remote pairing requires an authenticated Hermes gateway.' })
        return
      }
      const supportsPassword = supportsBasicAuth(status.auth_providers)
      setPasswordAuth(supportsPassword)
      const pkce = status.auth_flows?.includes('native_pkce') ? ' Secure device sign-in is available.' : ''
      if (!status.auth_flows?.includes('native_pkce')) throw new Error('This Hermes gateway does not advertise secure native phone sign-in.')
      setVerifiedEndpoint(value)
      setResult({ tone: 'success', text: `Hermes ${status.version || 'gateway'} is reachable. Authentication is required.${pkce}` })
    } catch (error) {
      if (probeEpoch === probeEpochRef.current) setResult({ tone: 'error', text: errorMessage(error, 'Could not reach this Hermes gateway.') })
    } finally { if (probeEpoch === probeEpochRef.current) setChecking(false) }
  }
  const completeSignIn = async () => {
    if (!verifiedEndpoint) return
    onPairingBusy(true)
    setSigningIn(true); setResult(null)
    try {
      if (passwordAuth) await passwordSignIn(verifiedEndpoint, username.trim(), password)
      else await nativeSignIn(verifiedEndpoint)
      // Yield after the Android native credential write before opening the next
      // native bridge call. This avoids concurrent Keystore access on resume.
      await new Promise(resolve => window.setTimeout(resolve, 150))
      setPassword('')
      await onPaired(verifiedEndpoint)
      back()
    } catch (error) { setResult({ tone: 'error', text: errorMessage(error, 'Secure Hermes sign-in failed.') }) }
    finally { setPassword(''); setSigningIn(false); onPairingBusy(false) }
  }
  const copyChecklist = async () => {
    try {
      await navigator.clipboard.writeText('Hermes Mobile Android pairing\n1. Join the Windows PC and Android phone to the same Tailscale tailnet.\n2. Start an authenticated Hermes gateway on the Windows PC.\n3. On Android, enter the PC’s Tailscale HTTPS/HTTP gateway URL — never 127.0.0.1.\n4. Verify reachability, then authenticate with the gateway’s supported session token or OAuth flow.\n5. Keep port 9119 private; do not expose it directly to the public internet.')
      setCopied(true); window.setTimeout(() => setCopied(false), 1800)
    } catch { setResult({ tone: 'error', text: 'Clipboard access is unavailable. You can still follow the checklist below.' }) }
  }
  return <main ref={shellRef} className="app panel pairing-screen">
    <Header title="Security & pairing" subtitle="Private access for your mobile device" back={back}/>
    <section className="pairing-hero">
      <div className="pairing-icon"><ShieldCheck size={28}/></div>
      <div><span>RECOMMENDED</span><h3>Pair over Tailscale</h3><p>Keep your Hermes gateway private. Your phone joins your Tailnet instead of exposing port 9119 to the public internet.</p></div>
    </section>
    <section className="pairing-card">
      <div className="pairing-card-title"><Wifi size={18}/><div><b>Verify your Windows gateway</b><small>Checks the real Hermes gateway status before any sign-in.</small></div></div>
      <label className="pairing-field"><span>GATEWAY URL</span><input value={gatewayUrl} onChange={event => { setGatewayUrl(event.target.value); probeEpochRef.current += 1; setVerifiedEndpoint(null); setPasswordAuth(false); setPassword('') }} placeholder="https://your-pc.tailnet.ts.net:9119" inputMode="url" autoCapitalize="none" autoCorrect="off"/></label>
      <button className="primary wide pairing-test" disabled={checking || signingIn} aria-busy={checking} onClick={() => void testGateway()}>{checking ? <><LoaderCircle className="pairing-spinner" size={17}/> Checking gateway…</> : <>Test gateway</>}</button>
      {verifiedEndpoint && passwordAuth && <div className="pairing-credentials">
        <label className="pairing-field"><span>USERNAME</span><input value={username} onChange={event => setUsername(event.target.value)} placeholder="Hermes gateway username" autoCapitalize="none" autoCorrect="off" autoComplete="username"/></label>
        <label className="pairing-field"><span>PASSWORD</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Hermes gateway password" autoComplete="current-password"/></label>
        <p className="pairing-note">Used once to obtain a revocable Hermes credential. The password itself is not saved.</p>
      </div>}
      {verifiedEndpoint && <button className="secondary wide pairing-signin" disabled={signingIn || (passwordAuth && (!username.trim() || !password))} aria-busy={signingIn} onClick={() => void completeSignIn()}>{signingIn ? <><LoaderCircle className="pairing-spinner" size={17}/> Signing in and connecting…</> : <>{passwordAuth ? 'Sign in & connect' : 'Continue to secure sign-in'}</>}</button>}
      {result && <p className={`pairing-result ${result.tone}`}>{result.tone === 'success' ? <CheckCircle2 size={16}/> : <LockKeyhole size={16}/>}<span>{result.text}</span></p>}
      <p className="pairing-note">Never enter <code>127.0.0.1</code> or <code>localhost</code> on your phone—those point back to the phone itself.</p>
    </section>
    <section className="pairing-steps">
      <p>PAIR A PHONE</p>
      <ol>
        <li><Smartphone size={17}/><span><b>Join the same Tailnet</b><small>Install Tailscale on Windows and Android, then sign into the same account.</small></span></li>
        <li><Wifi size={17}/><span><b>Run a reachable Hermes gateway</b><small>Use a Tailscale hostname or authenticated HTTPS URL. Keep direct public port exposure off.</small></span></li>
        <li><LockKeyhole size={17}/><span><b>Authenticate inside Hermes Mobile</b><small>Enter the gateway username and password once. Mobile exchanges them for revocable Hermes tokens and keeps those tokens in Android secure storage; your password is not saved.</small></span></li>
      </ol>
    </section>
    <section className="pairing-actions">
      <button className="secondary" onClick={() => void copyChecklist()}>{copied ? <CheckCircle2 size={16}/> : <Copy size={16}/>} {copied ? 'Setup copied' : 'Copy setup checklist'}</button>
      <a {...external('https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop')}><ExternalLink size={16}/> Gateway connection guide</a>
    </section>
    <p className="pairing-disclosure">Hermes Mobile verifies reachability first, exchanges your gateway credentials for revocable Hermes tokens inside the native app, stores tokens in OS-backed secure storage, and marks the host connected only after REST and WebSocket verification.</p>
  </main>
}

export function ConnectionSettings({ profiles, sessions, connected, endpoint, theme, setTheme, close, refresh, onPairingBusy, onPaired }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, close, true)
  const [page, setPage] = useState<Page>('root')
  const [showThemes, setShowThemes] = useState(false)
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      if (page === 'root') return
      event.preventDefault()
      setPage('root')
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [page])
  const syncNow = async () => {
    if (syncState === 'syncing') return
    setSyncState('syncing')
    try {
      const result = await refresh()
      setSyncState(result ? 'success' : 'error')
    } catch {
      setSyncState('error')
    }
  }
  if (page === 'about') return <AboutHermesMobile back={() => setPage('root')}/>
  if (page === 'pairing') return <PairingSettings back={() => setPage('root')} onPaired={onPaired} onPairingBusy={onPairingBusy} initialEndpoint={endpoint}/>
  const displayEndpoint = endpoint?.replace(/^https?:\/\//, '')
  return <main ref={shellRef} className="app panel connection-screen">
    <Header title="Connection" subtitle="Hermes Desktop host" back={close}/>
    <section className={`connection-card ${connected ? 'connected' : 'unpaired'}`}>
      <span className={`status-pill ${connected ? '' : 'disconnected'}`}>● {connected ? 'Connected' : 'Not connected'}</span>
      <h3>{connected ? 'Your Hermes host' : endpoint ? 'Saved host needs attention' : 'Pair this device'}</h3>
      <code>{displayEndpoint || 'No verified Hermes host'}</code>
      {connected ? <div className="stats"><span><b>{profiles}</b>Bots</span><span><b>{sessions}</b>Sessions</span></div> : <p className="connection-guidance">{endpoint ? 'Your host and secure sign-in are saved. Retry verification below; you do not need to re-enter the address.' : 'Connect to a private, authenticated Hermes gateway before this device can view or control your Bots.'}</p>}
      <button className={`primary wide connection-sync-button ${syncState}`} disabled={connected && syncState === 'syncing'} aria-busy={connected && syncState === 'syncing'} onClick={connected ? () => void syncNow() : endpoint ? () => void refresh() : () => setPage('pairing')}>{connected ? syncState === 'syncing' ? <><LoaderCircle className="connection-sync-spinner" size={17}/> Syncing…</> : syncState === 'success' ? <><CheckCircle2 size={17}/> Synced</> : 'Sync now' : endpoint ? 'Retry saved connection' : 'Set up security & pairing'}</button>
      {connected && syncState !== 'idle' && <p className={`connection-sync-result ${syncState}`} role="status">{syncState === 'syncing' ? 'Refreshing live Hermes data…' : syncState === 'success' ? 'Synced with Hermes Desktop just now.' : 'Sync could not complete. Check the host connection and try again.'}</p>}
    </section>
    <section className="menu-list"><button>Notifications <span>›</span></button><button onClick={() => setShowThemes(value => !value)}>Appearance <span>{themes.find(item => item.id === theme)?.label} ›</span></button>{showThemes && <div className="theme-picker">{themes.map(item => <button className={item.id === theme ? 'selected' : ''} onClick={() => setTheme(item.id)} key={item.id}><span className={`theme-swatch theme-${item.id}`}/><span><b>{item.label}</b><small>{item.description}</small></span><i>{item.id === theme ? '✓' : ''}</i></button>)}</div>}<button onClick={() => setPage('pairing')}>Security & pairing <span className={connected ? '' : 'connection-attention'}>{connected ? 'Connected ›' : 'Disconnected ›'}</span></button><button onClick={() => setPage('about')}>About Hermes Mobile <span>0.1.1 ›</span></button></section>
    <p className="fine">The host owns models, credentials, tools, memory, skills, and approvals. This client is the control surface.</p>
  </main>
}
