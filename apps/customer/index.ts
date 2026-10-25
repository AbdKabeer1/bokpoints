import * as Sentry from '@sentry/react';
import { registerRootComponent } from 'expo';
import { App } from './App';

registerRootComponent(App);

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn !== undefined && sentryDsn !== '') {
  Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0 });
}
