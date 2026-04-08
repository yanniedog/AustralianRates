import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'virtual:ar-proto-build-stamp.css'
import './styles.css'

document.documentElement.dataset.arLwProtoBuild = import.meta.env.VITE_PROTO_BUILD_STAMP || ''

if (window.AR?.AdminPortal?.guard && !window.AR.AdminPortal.guard()) {
  throw new Error('Admin access required.')
}

const container = document.getElementById('root')

if (!container) {
  throw new Error('Prototype root container is missing.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
