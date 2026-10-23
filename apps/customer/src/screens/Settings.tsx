import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, updateMe, type Me } from '../lib/api';
import { colors, layout } from '../lib/theme';

interface SettingsProps {
  token: string;
  me: Me;
  onSaved: (me: Me) => void;
  onBack: () => void;
  onSignOut: () => void;
}

/**
 * The customer's settings: their name, the language they read the app in,
 * and the way out. The choices save straight to their profile.
 */
export function SettingsScreen({ token, me, onSaved, onBack, onSignOut }: SettingsProps) {
  const [name, setName] = useState(me.customer.name);
  const [language, setLanguage] = useState<'fi' | 'en'>(me.customer.language === 'fi' ? 'fi' : 'en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateMe(token, {
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        language,
      });
      onSaved(updated);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? 'We could not save that. Try again in a moment.'
          : 'We could not reach the service. Try again in a moment.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>

      <Text style={styles.title}>Settings</Text>
      <Text style={styles.email}>{me.customer.email}</Text>

      <Text style={styles.label}>Your name</Text>
      <Pressable style={styles.nameBox}>
        <NameInput value={name} onChange={setName} disabled={saving} />
      </Pressable>

      <Text style={styles.label}>Language</Text>
      <View style={styles.langRow}>
        <Pressable
          style={[styles.langChip, language === 'fi' && styles.langChipOn]}
          onPress={() => setLanguage('fi')}
        >
          <Text style={[styles.langText, language === 'fi' && styles.langTextOn]}>Suomi</Text>
        </Pressable>
        <Pressable
          style={[styles.langChip, language === 'en' && styles.langChipOn]}
          onPress={() => setLanguage('en')}
        >
          <Text style={[styles.langText, language === 'en' && styles.langTextOn]}>English</Text>
        </Pressable>
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}
      {saved && !error && <Text style={styles.saved}>Saved.</Text>}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonBusy]}
        onPress={() => void save()}
        disabled={saving}
      >
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>

      <Pressable style={styles.signOutBox} onPress={onSignOut} hitSlop={8}>
        <Text style={styles.signOutText}>Sign out of Poket</Text>
      </Pressable>

      <Text style={styles.fine}>
        Your points are held per store. Deleting your account and exporting your data arrive
        with the app's privacy tools.
      </Text>
    </ScrollView>
  );
}

/** A plain text input styled like the app's fields. */
function NameInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Your name"
      editable={!disabled}
      style={styles.nameInput}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: layout.screen,
    paddingTop: 64,
    paddingBottom: 40,
  },
  back: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  email: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
    marginBottom: 20,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  nameBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  nameInput: {
    color: colors.text,
    fontSize: 15,
    paddingVertical: 12,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  langChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  langChipOn: {
    borderColor: colors.gold,
    backgroundColor: colors.card,
  },
  langText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  langTextOn: {
    color: colors.gold,
  },
  error: {
    color: colors.gold,
    fontSize: 14,
    marginBottom: 12,
  },
  saved: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 24,
  },
  saveButtonBusy: {
    opacity: 0.6,
  },
  saveText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  signOutBox: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
  },
  signOutText: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '600',
  },
  fine: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
