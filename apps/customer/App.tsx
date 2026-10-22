import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { getMe, type Me } from './src/lib/api';
import { hasConfig, onAuthChange, signOut, supabase } from './src/lib/session';
import { colors } from './src/lib/theme';
import { Home } from './src/screens/Home';
import { Onboarding } from './src/screens/Onboarding';
import { SignIn } from './src/screens/SignIn';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'onboarding'; token: string; me: Me }
  | { kind: 'ready'; token: string; me: Me }
  | { kind: 'error'; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    // Sign-in fires the auth listener and the screen callback at the same
    // time; one in-flight profile load answers both.
    if (inFlight.current !== null) return inFlight.current;

    const run = (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session === null) {
        setPhase({ kind: 'signed-out' });
        return;
      }

      try {
        const me = await getMe(session.access_token);
        setPhase(
          me.onboardingComplete
            ? { kind: 'ready', token: session.access_token, me }
            : { kind: 'onboarding', token: session.access_token, me },
        );
      } catch {
        // A transient failure must not replace a working screen: the QR is
        // the one thing a customer needs when the network is poor.
        setPhase((current) =>
          current.kind === 'ready' || current.kind === 'onboarding'
            ? current
            : { kind: 'error', message: 'We could not reach your account. Check your connection.' },
        );
      }
    })();

    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthChange(() => void refresh());
  }, [refresh]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    // The phase change unmounts Home, so no balance, name or QR stays behind.
    setPhase({ kind: 'signed-out' });
  }, []);

  if (!hasConfig) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>BOKPOINTS</Text>
        <Text style={styles.muted}>
          This build has no Supabase settings. Copy `.env.example` to `.env` and fill in the
          project URL and publishable key, then restart the app.
        </Text>
      </View>
    );
  }

  switch (phase.kind) {
    case 'loading':
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.gold} />
        </View>
      );
    case 'error':
      return (
        <View style={styles.centered}>
          <Text style={styles.title}>BOKPOINTS</Text>
          <Text style={styles.muted}>{phase.message}</Text>
          <Pressable style={styles.primary} onPress={() => void refresh()}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => void handleSignOut()}>
            <Text style={styles.secondaryText}>Sign out</Text>
          </Pressable>
        </View>
      );
    case 'signed-out':
      return <SignIn onSignedIn={() => void refresh()} />;
    case 'onboarding':
      return <Onboarding token={phase.token} me={phase.me} onDone={() => void refresh()} />;
    case 'ready':
      return <Home token={phase.token} me={phase.me} onSignOut={() => void handleSignOut()} />;
  }
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.text,
    marginBottom: 12,
  },
  muted: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primary: {
    marginTop: 22,
    backgroundColor: '#f5b301',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  primaryText: {
    color: '#1c1400',
    fontWeight: '800',
    fontSize: 15,
  },
  secondary: {
    marginTop: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
});
