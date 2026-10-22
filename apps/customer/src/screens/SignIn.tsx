import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { sendEmailCode, verifyEmailCode } from '../lib/session';
import { colors, layout } from '../lib/theme';
import { normalizeCode } from '../lib/format';

/**
 * Email one-time code, in two steps: address, then the six digits from the
 * inbox (FR-AUTH-1). No password, no second factor for customers.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>BOKPOINTS</Text>

        {step === 'email' ? (
          <>
            <Text style={styles.title}>Your points, in one place</Text>
            <Text style={styles.muted}>
              Type your email and we will send a 6-digit code. No password to remember.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />

            {error !== null && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={[styles.button, (busy || email.trim() === '') && styles.buttonDisabled]}
              onPress={() => void send()}
              disabled={busy || email.trim() === ''}
            >
              {busy ? (
                <ActivityIndicator color="#1c1400" />
              ) : (
                <Text style={styles.buttonText}>Send me a code</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.muted}>
              We sent a 6-digit code to {email.trim().toLowerCase()}. It may take a minute.
            </Text>

            <Text style={styles.label}>Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(value) => setCode(normalizeCode(value))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              placeholderTextColor={colors.muted}
              editable={!busy}
            />

            {error !== null && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={[styles.button, (busy || code.length !== 6) && styles.buttonDisabled]}
              onPress={() => void verify()}
              disabled={busy || code.length !== 6}
            >
              {busy ? (
                <ActivityIndicator color="#1c1400" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkButton}
              onPress={() => void send()}
              disabled={busy || cooldown > 0}
            >
              <Text style={styles.link}>
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </Text>
            </Pressable>

            <Pressable style={styles.linkButton} onPress={() => setStep('email')} disabled={busy}>
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: layout.screen,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.radius,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.line,
  },
  brand: {
    color: colors.gold,
    fontWeight: '800',
    letterSpacing: 3,
    fontSize: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 8,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 18,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#fbfaf6',
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    backgroundColor: '#f5b301',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#1c1400',
    fontWeight: '800',
    fontSize: 16,
  },
  linkButton: {
    marginTop: 14,
    alignItems: 'center',
  },
  link: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    marginTop: 12,
    fontSize: 14,
  },
});
