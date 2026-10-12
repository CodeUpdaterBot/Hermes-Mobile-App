import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installHapticFeedback } from './haptics'
import './styles.css'
import './chat.css'
import './wizard.css'
import './activity.css'
import './mobile-overrides.css'
import './avatar.css'
import './profile-sheet.css'
import './management.css'
import './appearance-picker.css'
import './theme.css'
import './connection-settings.css'
import './edge-swipe.css'
// Native-feel interaction layer: must load last so it refines every surface.
import './motion.css'

// One capture-phase listener gives every control in the app its tactile
// response; platforms without a vibration service degrade to a no-op.
installHapticFeedback()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
