import { useState } from 'react';
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
import { updateMe, type Me } from '../lib/api';
import { colors, layout } from '../lib/theme';

interface OnboardingProps {
  token: string;
  me: Me;
  onDone: () => void;
}

/**
 * First run: the till shows the first name, so the app asks for it before the
 * QR is ever shown. Language is stored now and used for notices later.
 */
export function Onboarding({ token, me, onDone }: OnboardingProps) {
  const [name, setName] = useState(me.customer.name);
  const [language, setLanguage] = useState<'fi' | 'en'>(
    me.customer.language === 'en' ? 'en' : 'fi',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  const save = async () => {
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      await updateMe(token, { name: trimmed, language });
      onDone();
    } catch {
      setError('We could not save that. Try again in a moment.');
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
        <Text style={styles.title}>What should the till call you?</Text>
        <Text style={styles.muted}>
          The cashier sees your first name when they scan your code. That is all they see.
        </Text>

        <Text style={styles.label}>First name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={100}
          placeholder="Aino"
          placeholderTextColor={colors.muted}
          editable={!busy}
        />

        <Text style={styles.label}>Language</Text>
        <View style={styles.row}>
          {(['fi', 'en'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.choice, language === option && styles.choiceActive]}
              onPress={() => setLanguage(option)}
              disabled={busy}
            >
              <Text style={[styles.choiceText, language === option && styles.choiceTextActive]}>
                {option === 'fi' ? 'Suomi' : 'English'}
              </Text>
            </Pressable>
          ))}
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, (busy || trimmed === '') && styles.buttonDisabled]}
          onPress={() => void save()}
          disabled={busy || trimmed === ''}
        >
          {busy ? (
            <ActivityIndicator color="#1c1400" />
          ) : (
            <Text style={styles.buttonText}>Save and show my code</Text>
          )}
        </Pressable>
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
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  choiceActive: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  choiceText: {
    color: colors.muted,
    fontWeight: '600',
  },
  choiceTextActive: {
    color: colors.text,
  },
  button: {
    marginTop: 22,
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
  error: {
    color: colors.danger,
    marginTop: 12,
    fontSize: 14,
  },
});
