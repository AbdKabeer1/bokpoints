import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { getMe, type Me } from './src/lib/api';
import { hasConfig, onAuthChange, signOut, supabase } from './src/lib/session';
import { colors, fonts } from './src/lib/theme';
import { Home } from './src/screens/Home';
import { Onboarding } from './src/screens/Onboarding';
import { SignIn } from './src/screens/SignIn';
import { Splash } from './src/screens/Splash';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'onboarding'; token: string; me: Me }
  | { kind: 'ready'; token: string; me: Me }
  | { kind: 'error'; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // The intro plays once per launch. A signed-in customer still sees it, and
  // lands straight on their QR afterwards, so the brand never flashes a
  // half-built screen.
  const [introDone, setIntroDone] = useState(false);
  // The fonts are part of the look: hold the splash until they are ready so
  // the first screen never flashes a fallback face.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const handleIntroDone = useCallback(() => setIntroDone(true), []);
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
        <Text style={styles.title}>OmaPointii</Text>
        <Text style={styles.muted}>
          This build has no Supabase settings. Copy `.env.example` to `.env` and fill in the
          project URL and publishable key, then restart the app.
        </Text>
      </View>
    );
  }

  // The intro and the session check run together: whichever finishes last
  // decides what appears, and the splash never cuts off mid-animation.
  if (!introDone || (!fontsLoaded && fontError === null) || phase.kind === 'loading') {
    return <Splash onDone={handleIntroDone} />;
  }

  switch (phase.kind) {
    case 'error':
      return (
        <View style={styles.centered}>
          <Text style={styles.title}>OmaPointii</Text>
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
      return (
        <Home
          token={phase.token}
          me={phase.me}
          onMeChanged={(me) => setPhase({ kind: 'ready', token: phase.token, me })}
          onSignOut={() => void handleSignOut()}
        />
      );
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
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.text,
    marginBottom: 12,
  },
  muted: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  primary: {
    marginTop: 22,
    backgroundColor: colors.espresso,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 30,
  },
  primaryText: {
    color: colors.onEspresso,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
  secondary: {
    marginTop: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    color: colors.muted,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
  },
});
