import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './workspace.css'
import './conversation.css'
import './activity.css'
import './email.css'
import './metrics.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
