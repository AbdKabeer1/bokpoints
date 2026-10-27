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
import Feather from '@expo/vector-icons/Feather';
import { sendEmailCode, verifyEmailCode } from '../lib/session';
import { colors, fonts, layout } from '../lib/theme';
import { normalizeCode } from '../lib/format';

const BENEFITS = [
  'Earn points at every shop you visit',
  'One QR code at the till',
  'See points before they expire',
];

/**
 * Email one-time code, in two steps: address, then the code from the
 * inbox (FR-AUTH-1). No password, no second factor for customers.
 *
 * The page carries the same palette as the signed-in app: the cool canvas,
 * a violet points card, white surfaces, mint for what the customer gains, and
 * one violet action. It is built for a phone first and centred on a web page.
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
  // One value per benefit: each mint check pops in after the page settles, so
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
      // Supabase's own mailer is rate-limited, and a project without a
      // sender cannot reach every address. A customer who already has a
      // code must still be able to enter it, so the code step stays open.
      setError('We could not send a new code just now. If you already have one, enter it below.');
      setStep('code');
      setCooldown(30);
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

  const buttonDisabled =
    busy || (step === 'email' ? email.trim() === '' : code.length < 6);

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
              <Text style={styles.markText}>O</Text>
            </View>
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmark}>OmaPointii</Text>
              <View style={styles.brandDot} />
            </View>
          </View>

          <View style={styles.hero}>
            <Text style={styles.headline} accessibilityRole="header">
              {step === 'email' ? 'Every visit counts.' : 'Check your inbox'}
            </Text>
            <Text style={styles.lede}>
              {step === 'email' ? (
                'Collect points at the shops you love, keep them in one place, and use them where you earned them.'
              ) : (
                <>
                  We sent a one-time code to{' '}
                  <Text style={styles.emailStrong}>{email.trim().toLowerCase()}</Text>. It can
                  take a minute to arrive.
                </>
              )}
            </Text>
          </View>

          <View style={styles.formCard}>
            {step === 'email' ? (
              <>
                <View style={styles.benefits}>
                  {ticks.map((tick, index) => (
                    <View key={BENEFITS[index] ?? index} style={styles.benefitRow}>
                      <Animated.View
                        style={[styles.tick, { opacity: tick, transform: [{ scale: tick }] }]}
                      >
                        <Feather name="check" size={13} color={colors.greenDark} />
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
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.buttonText}>Continue with email</Text>
                  )}
                </Pressable>

                <Text style={styles.fineprint}>
                  We email you a one-time code. No password to remember, and no app store
                  needed.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Your code</Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.codeInput,
                    focused === 'code' && styles.inputFocused,
                  ]}
                  value={code}
                  onChangeText={(value) => setCode(normalizeCode(value))}
                  onFocus={() => setFocused('code')}
                  onBlur={() => setFocused(null)}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={10}
                  placeholder=""
                  placeholderTextColor={colors.muted}
                  editable={!busy}
                  accessibilityLabel="Code from the email"
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
                    <ActivityIndicator color={colors.onPrimary} />
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
          </View>
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
    paddingVertical: 36,
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
    marginBottom: 22,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    color: colors.onPrimary,
    fontFamily: fonts.display,
    fontSize: 19,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  wordmark: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 24,
    letterSpacing: -0.8,
  },
  brandDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.green,
    marginLeft: 3,
    marginBottom: 5,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: 24,
    padding: 22,
    paddingBottom: 24,
  },
  headline: {
    color: colors.onPrimary,
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -1.2,
  },
  lede: {
    color: 'rgba(255,255,255,0.88)',
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 23,
    marginTop: 10,
  },
  emailStrong: {
    color: colors.onPrimary,
    fontFamily: fonts.bodyBold,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    marginTop: 14,
  },
  benefits: {
    gap: 11,
    marginBottom: 24,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.mintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
    lineHeight: 19,
  },
  label: {
    color: colors.muted,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  codeInput: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: 9,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonPressed: {
    backgroundColor: colors.primaryDark,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.onPrimary,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
  links: {
    marginTop: 18,
    gap: 12,
    alignItems: 'center',
  },
  link: {
    color: colors.primary,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
  },
  linkMuted: {
    color: colors.muted,
  },
  fineprint: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 16,
  },
  errorBox: {
    marginTop: 12,
    backgroundColor: colors.dangerSoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    lineHeight: 18,
  },
});
