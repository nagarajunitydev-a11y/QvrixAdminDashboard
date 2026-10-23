import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

document.documentElement.dataset.density = localStorage.getItem('trackora-density') || 'comfortable'

createRoot(document.getElementById('root')!).render(
  <App />
)
