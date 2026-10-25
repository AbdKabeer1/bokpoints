import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@bokpoints/shared/ui/console.css';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn !== undefined && sentryDsn !== '') {
  Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE, tracesSampleRate: 0 });
}

const container = document.getElementById('root');
if (container === null) throw new Error('No #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
