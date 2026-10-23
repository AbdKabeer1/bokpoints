import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { sendEmailCode, verifyEmailCode } from '../lib/session';
import { colors, layout } from '../lib/theme';
import { normalizeCode } from '../lib/format';

const BENEFITS = [
  'Earn points at every shop you visit',
  'One QR code at the till',
  'See points before they expire',
];

/**
 * Email one-time code, in two steps: address, then the six digits from the
 * inbox (FR-AUTH-1). No password, no second factor for customers.
 *
 * The layout is one white page with a green action: the wordmark, a plain
 * promise, the three things the app does, then the email field. It is built
 * for a phone first and centred on a web page.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [focused, setFocused] = useState<'email' | 'code' | null>(null);

  const enter = useRef(new Animated.Value(0)).current;
  // One value per benefit: each green tick pops in after the page settles, so
  // the three reasons land one after the other instead of all at once.
  const ticks = useRef(BENEFITS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const native = Platform.OS !== 'web';

    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();

    let cancelled = false;
    const reveal = (reduceMotion: boolean) => {
      if (cancelled) return;
      if (reduceMotion) {
        for (const tick of ticks) tick.setValue(1);
        return;
      }
      Animated.sequence([
        Animated.delay(380),
        Animated.stagger(
          170,
          ticks.map((tick) =>
            Animated.spring(tick, {
              toValue: 1,
              friction: 5,
              tension: 140,
              useNativeDriver: native,
            }),
          ),
        ),
      ]).start();
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then(reveal)
      .catch(() => reveal(false));

    return () => {
      cancelled = true;
    };
  }, [enter, ticks]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendEmailCode(email.trim().toLowerCase());
      setStep('code');
      setCooldown(30);
    } catch {
      setError('We could not send the code. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(email.trim().toLowerCase(), code);
      onSignedIn();
    } catch {
      setError('That code did not work. Wait for the next one and try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const buttonDisabled = busy || (step === 'email' ? email.trim() === '' : code.length !== 6);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.shell,
            {
              opacity: enter,
              transform: [
                {
                  translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
                },
              ],
            },
          ]}
        >
          <View style={styles.brandRow}>
            <View style={styles.mark}>
              <Text style={styles.markText}>P</Text>
            </View>
            <Text style={styles.wordmark}>Poket</Text>
          </View>

          {step === 'email' ? (
            <>
              <Text style={styles.headline} accessibilityRole="header">
                Every visit counts.
              </Text>
              <Text style={styles.lede}>
                Collect points at the shops you love, keep them in one place, and use them
                where you earned them.
              </Text>

              <View style={styles.benefits}>
                {ticks.map((tick, index) => (
                  <View key={BENEFITS[index] ?? index} style={styles.benefitRow}>
                    <Animated.View
                      style={[styles.tick, { opacity: tick, transform: [{ scale: tick }] }]}
                    >
                      <Text style={styles.tickText}>✓</Text>
                    </Animated.View>
                    <Text style={styles.benefitText}>{BENEFITS[index] ?? ''}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, focused === 'email' && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                editable={!busy}
                accessibilityLabel="Email address"
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (!buttonDisabled) void send();
                }}
              />

              {error !== null && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  buttonDisabled && styles.buttonDisabled,
                  pressed && !buttonDisabled && styles.buttonPressed,
                ]}
                onPress={() => void send()}
                disabled={buttonDisabled}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onGreen} />
                ) : (
                  <Text style={styles.buttonText}>Continue with email</Text>
                )}
              </Pressable>

              <Text style={styles.fineprint}>
                We email you a 6-digit code. No password to remember, and no app store
                needed.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.headline} accessibilityRole="header">
                Check your inbox
              </Text>
              <Text style={styles.lede}>
                We sent a 6-digit code to{' '}
                <Text style={styles.emailStrong}>{email.trim().toLowerCase()}</Text>. It can
                take a minute to arrive.
              </Text>

              <Text style={styles.label}>Your code</Text>
              <TextInput
                style={[styles.input, styles.codeInput, focused === 'code' && styles.inputFocused]}
                value={code}
                onChangeText={(value) => setCode(normalizeCode(value))}
                onFocus={() => setFocused('code')}
                onBlur={() => setFocused(null)}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                placeholderTextColor={colors.muted}
                editable={!busy}
                accessibilityLabel="Six-digit code"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!buttonDisabled) void verify();
                }}
              />

              {error !== null && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  buttonDisabled && styles.buttonDisabled,
                  pressed && !buttonDisabled && styles.buttonPressed,
                ]}
                onPress={() => void verify()}
                disabled={buttonDisabled}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onGreen} />
                ) : (
                  <Text style={styles.buttonText}>Sign in</Text>
                )}
              </Pressable>

              <View style={styles.links}>
                <Pressable
                  onPress={() => void send()}
                  disabled={busy || cooldown > 0}
                  accessibilityRole="button"
                >
                  <Text style={[styles.link, (busy || cooldown > 0) && styles.linkMuted]}>
                    {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>Use a different email</Text>
                </Pressable>
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screen,
    paddingVertical: 40,
  },
  shell: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 34,
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    color: colors.onGreen,
    fontSize: 18,
    fontWeight: '800',
  },
  wordmark: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headline: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  lede: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  emailStrong: {
    color: colors.ink,
    fontWeight: '700',
  },
  benefits: {
    marginTop: 26,
    gap: 12,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickText: {
    color: colors.onGreen,
    fontSize: 13,
    fontWeight: '900',
  },
  benefitText: {
    color: colors.text,
    fontSize: 15,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 30,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputFocused: {
    borderColor: colors.green,
  },
  codeInput: {
    fontSize: 26,
    letterSpacing: 10,
    textAlign: 'center',
    fontWeight: '700',
  },
  button: {
    marginTop: 22,
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  buttonPressed: {
    backgroundColor: colors.greenDark,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.onGreen,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  links: {
    marginTop: 18,
    gap: 12,
    alignItems: 'center',
  },
  link: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '600',
  },
  linkMuted: {
    color: colors.muted,
  },
  fineprint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 20,
  },
  errorBox: {
    marginTop: 14,
    backgroundColor: colors.dangerSoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
