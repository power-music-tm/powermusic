import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { prefetchPartnerSlugBrandingFromLocation } from './utils/partnerSlugBrandingCache'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

prefetchPartnerSlugBrandingFromLocation()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
