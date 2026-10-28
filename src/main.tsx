import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StandaloneDownloadDialog } from './components/StandaloneDownloadDialog';
import './styles/index.css';

const isDialog = window.location.search.includes('dialog=true');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDialog ? <StandaloneDownloadDialog /> : <App />}
  </React.StrictMode>
);
