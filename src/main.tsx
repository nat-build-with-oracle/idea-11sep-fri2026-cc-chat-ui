import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import BackendConnection from './BackendConnection'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BackendConnection><App /></BackendConnection></React.StrictMode>,
)
