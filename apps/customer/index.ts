import * as Sentry from '@sentry/react';
import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import { Root } from './src/Root';

// The customer app is web-first. The React SDK is correct there; native
// crash reporting needs @sentry/react-native, so we do not initialise the
// web SDK on iOS/Android.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (Platform.OS === 'web' && sentryDsn !== undefined && sentryDsn !== '') {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.EXPO_PUBLIC_ENV ?? 'production',
    tracesSampleRate: 0,
  });
}

registerRootComponent(Root);
