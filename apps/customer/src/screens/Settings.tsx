import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, updateMe, type Me } from '../lib/api';
import { colors, fonts, layout } from '../lib/theme';

interface SettingsProps {
  token: string;
  me: Me;
  onSaved: (me: Me) => void;
  onBack: () => void;
  onSignOut: () => void;
}

/**
 * Name, language and the way out. Saves straight to the customer's profile;
 * nothing here needs a password.
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
        <Text style={styles.back}>← Back</Text>
      </Pressable>

      <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.email}>{me.customer.email}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          editable={!saving}
          style={styles.input}
        />

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
        {saved && error === null && <Text style={styles.saved}>Saved.</Text>}

        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonBusy]}
          onPress={() => void save()}
          disabled={saving}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>

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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: layout.screen,
    paddingTop: 58,
    paddingBottom: 44,
  },
  back: {
    fontFamily: fonts.bodyBold,
    color: colors.terracottaInk,
    fontSize: 13,
    marginBottom: 18,
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.text,
    marginTop: 4,
  },
  email: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 7,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
  },
  langChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
  },
  langChipOn: {
    borderColor: colors.espresso,
    backgroundColor: colors.espresso,
  },
  langText: {
    fontFamily: fonts.bodySemi,
    color: colors.muted,
    fontSize: 13,
  },
  langTextOn: {
    color: colors.onEspresso,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    color: colors.terracottaInk,
    fontSize: 12.5,
    marginTop: 14,
  },
  saved: {
    fontFamily: fonts.bodySemi,
    color: colors.greenDark,
    fontSize: 12.5,
    marginTop: 14,
  },
  saveButton: {
    backgroundColor: colors.espresso,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 20,
    minHeight: 50,
    justifyContent: 'center',
  },
  saveButtonBusy: {
    opacity: 0.6,
  },
  saveText: {
    color: colors.onEspresso,
    fontFamily: fonts.bodyBold,
    fontSize: 14.5,
  },
  signOutBox: {
    marginTop: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBCBBE',
    backgroundColor: colors.terracottaSoft,
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: {
    color: colors.terracottaInk,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
  },
  fine: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 22,
  },
});
