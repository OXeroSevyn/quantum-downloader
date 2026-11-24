import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StandaloneDialog } from './components/StandaloneDialog';
import './styles/index.css';

async function boot() {
  // Browser preview during development: stand in for the Electron bridge
  if (import.meta.env.DEV && !window.quantumApi) {
    const { installMockApi } = await import('./lib/mock');
    installMockApi();
  }
  const params = new URLSearchParams(window.location.search);
  const isDialog = params.get('dialog') === 'true';
  const initialTheme = params.get('theme');
  document.body.dataset.theme =
    initialTheme === 'dark' || initialTheme === 'light'
      ? initialTheme
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{isDialog ? <StandaloneDialog /> : <App />}</React.StrictMode>
  );
}

boot();
