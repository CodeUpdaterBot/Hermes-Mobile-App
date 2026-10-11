import { Wrench } from 'lucide-react'

import type { Capability } from '../hermes'

/** One Skill or Toolset row — shared by the Capabilities screen and the wide sidebar. */
export function CapabilityRow({ item, onToggle }: { item: Capability; onToggle: () => void }) {
  return <div className="capability-row"><Wrench size={17}/><span><b>{item.label || item.name}</b><small>{item.description || (item.tool_count ? `${item.tool_count} tools` : 'Hermes capability')}</small></span><button className={`capability-toggle ${item.enabled ? 'on' : ''}`} onClick={onToggle} aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`}><i/>{item.enabled ? 'On' : 'Off'}</button></div>
}
