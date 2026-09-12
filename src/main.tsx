import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import BackendConnection from './BackendConnection'
import BuildFooter from './BuildFooter'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><div className="app-frame">
    <div className="app-content"><BackendConnection><App /></BackendConnection></div>
    <BuildFooter />
  </div></React.StrictMode>,
)
