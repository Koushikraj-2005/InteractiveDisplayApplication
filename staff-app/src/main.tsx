import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '../../shared/AppErrorBoundary.tsx';
import App from './App.tsx';
import './index.css';
import './staff.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary appName="NAVEEN POULTRY FARMS — Staff terminal">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
