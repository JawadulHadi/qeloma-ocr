import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/fonts'
import './styles/base.css'
import './styles/app.css'
import { installThemeCss, ThemeProvider } from './theme'
import App from './App.tsx'

// Theme tokens are generated from src/theme/palette.ts and injected once, before the first render.
installThemeCss()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
