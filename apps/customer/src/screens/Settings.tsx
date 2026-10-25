import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import {
  ApiError,
  deleteMyAccount,
  exportMyData,
  sendFeedback,
  updateMe,
  type Me,
} from '../lib/api';
import { sendEmailCode } from '../lib/session';
import { AboutLegal } from './AboutLegal';
import { colors, fonts, layout } from '../lib/theme';

interface SettingsProps {
  token: string;
  me: Me;
  onSaved: (me: Me) => void;
  onBack: () => void;
  onSignOut: () => void;
}

/**
 * Name, language, privacy and the way out. Saves straight to the customer's
 * profile; deletion is the only action that asks for a fresh email code.
 */
export function SettingsScreen({ token, me, onSaved, onBack, onSignOut }: SettingsProps) {
  const [name, setName] = useState(me.customer.name);
  const [language, setLanguage] = useState<'fi' | 'en'>(me.customer.language === 'fi' ? 'fi' : 'en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'code'>('confirm');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState(me.customer.notificationsEnabled ?? true);
  const [legalOpen, setLegalOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'idea' | 'other'>('idea');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);

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

  const download = async () => {
    setExporting(true);
    setExported(false);
    setError(null);
    try {
      const data = await exportMyData(token);
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'omapointii-data.json';
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json, title: 'My OmaPointii data' });
      }
      setExported(true);
    } catch {
      setError('We could not prepare your data. Try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  const requestDeleteCode = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await sendEmailCode(me.customer.email);
      setDeleteStep('code');
    } catch {
      setDeleteError('We could not send a code. Try again in a moment.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteCode.trim().length < 6) {
      setDeleteError('Enter the code from your email.');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteMyAccount(token, deleteCode.trim());
      onSignOut();
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError && caught.code === 'CODE_INVALID'
          ? 'That code is not valid or has expired. Request a new one.'
          : 'We could not delete the account. Try again in a moment.',
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleNotifications = async (next: boolean) => {
    setNotifications(next);
    setError(null);
    try {
      const updated = await updateMe(token, { notificationsEnabled: next });
      onSaved(updated);
    } catch {
      setNotifications(me.customer.notificationsEnabled ?? true);
      setError('We could not save the notification preference. Try again.');
    }
  };

  const sendFeedbackMessage = async () => {
    if (feedbackMessage.trim().length < 3) {
      setFeedbackError('Write a little more first.');
      return;
    }
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      await sendFeedback(token, {
        category: feedbackCategory,
        message: feedbackMessage.trim(),
        page: 'Settings',
      });
      setFeedbackSent(true);
      setFeedbackMessage('');
      setFeedbackOpen(false);
    } catch {
      setFeedbackError('We could not send that. Try again in a moment.');
    } finally {
      setFeedbackBusy(false);
    }
  };

  if (legalOpen) return <AboutLegal onBack={() => setLegalOpen(false)} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
        <Feather name="arrow-left" size={16} color={colors.terracottaInk} />
        <Text style={styles.back}>Back</Text>
      </Pressable>

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

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>In-app notifications</Text>
            <Text style={styles.toggleBody}>
              Store messages in your Inbox. Store-news consent is separate.
            </Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={(next) => void toggleNotifications(next)}
            trackColor={{ false: colors.lineStrong, true: colors.primary }}
            thumbColor="#FFFFFF"
          />
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

      <Text style={styles.sectionLabel}>Help & feedback</Text>

      <View style={styles.card}>
        <Pressable style={styles.menuRow} onPress={() => setLegalOpen(true)}>
          <Text style={styles.menuLabel}>FAQ, terms, privacy and licences</Text>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Pressable>

        <View style={styles.divider} />

        {feedbackSent && <Text style={styles.saved}>Thank you — your feedback is in.</Text>}

        {!feedbackOpen ? (
          <Pressable style={styles.secondaryButton} onPress={() => setFeedbackOpen(true)}>
            <Feather name="message-square" size={15} color={colors.text} />
            <Text style={styles.secondaryText}>Send feedback</Text>
          </Pressable>
        ) : (
          <View>
            <Text style={styles.feedbackLabel}>What kind of feedback?</Text>
            <View style={styles.langRow}>
              {(['bug', 'idea', 'other'] as const).map((category) => (
                <Pressable
                  key={category}
                  style={[styles.langChip, feedbackCategory === category && styles.langChipOn]}
                  onPress={() => setFeedbackCategory(category)}
                >
                  <Text
                    style={[
                      styles.langText,
                      feedbackCategory === category && styles.langTextOn,
                    ]}
                  >
                    {category === 'bug' ? 'Problem' : category === 'idea' ? 'Idea' : 'Other'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={feedbackMessage}
              onChangeText={setFeedbackMessage}
              placeholder="Tell us what happened or what would help"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={2000}
              editable={!feedbackBusy}
              style={[styles.input, styles.feedbackInput]}
            />
            {feedbackError !== null && <Text style={styles.error}>{feedbackError}</Text>}
            <Pressable
              style={[styles.saveButton, feedbackBusy && styles.saveButtonBusy]}
              onPress={() => void sendFeedbackMessage()}
              disabled={feedbackBusy}
            >
              <Text style={styles.saveText}>{feedbackBusy ? 'Sending…' : 'Send feedback'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setFeedbackOpen(false);
                setFeedbackError(null);
              }}
              hitSlop={8}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.sectionLabel}>Privacy</Text>

      <View style={styles.card}>
        <View style={styles.privacyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.privacyTitle}>Download my data</Text>
            <Text style={styles.privacyBody}>
              Your profile, consents, balances and every points entry, as a JSON file.
            </Text>
          </View>
        </View>
        <Pressable
          style={[styles.secondaryButton, exporting && styles.saveButtonBusy]}
          onPress={() => void download()}
          disabled={exporting}
        >
          <Feather name="download" size={15} color={colors.text} />
          <Text style={styles.secondaryText}>{exporting ? 'Preparing…' : 'Download'}</Text>
        </Pressable>
        {exported && <Text style={styles.saved}>Your data is ready.</Text>}

        <View style={styles.divider} />

        <View style={styles.privacyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.privacyTitle}>Delete my account</Text>
            <Text style={styles.privacyBody}>
              Removes your name, email, code and store consents. The stores keep their points
              totals, but the entries no longer identify you. This cannot be undone.
            </Text>
          </View>
        </View>

        {!deleteOpen ? (
          <Pressable
            style={styles.dangerButton}
            onPress={() => {
              setDeleteOpen(true);
              setDeleteStep('confirm');
              setDeleteCode('');
              setDeleteError(null);
            }}
          >
            <Text style={styles.dangerText}>Delete my account</Text>
          </Pressable>
        ) : (
          <View style={styles.deleteBox}>
            {deleteStep === 'confirm' ? (
              <>
                <Text style={styles.deleteWarn}>
                  We will send a sign-in code to {me.customer.email}. Enter it to confirm.
                </Text>
                {deleteError !== null && <Text style={styles.error}>{deleteError}</Text>}
                <Pressable
                  style={[styles.dangerButton, deleteBusy && styles.saveButtonBusy]}
                  onPress={() => void requestDeleteCode()}
                  disabled={deleteBusy}
                >
                  <Text style={styles.dangerText}>
                    {deleteBusy ? 'Sending…' : 'Send sign-in code'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.deleteWarn}>
                  Enter the code we sent to your email. It proves this is still you.
                </Text>
                <TextInput
                  value={deleteCode}
                  onChangeText={setDeleteCode}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  maxLength={10}
                  editable={!deleteBusy}
                  style={styles.input}
                />
                {deleteError !== null && <Text style={styles.error}>{deleteError}</Text>}
                <Pressable
                  style={[styles.dangerButton, deleteBusy && styles.saveButtonBusy]}
                  onPress={() => void confirmDelete()}
                  disabled={deleteBusy}
                >
                  <Text style={styles.dangerText}>
                    {deleteBusy ? 'Deleting…' : 'Delete permanently'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void requestDeleteCode()}
                  disabled={deleteBusy}
                  hitSlop={8}
                >
                  <Text style={styles.resend}>Send a new code</Text>
                </Pressable>
              </>
            )}
            <Pressable
              onPress={() => {
                setDeleteOpen(false);
                setDeleteCode('');
                setDeleteError(null);
              }}
              hitSlop={8}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Pressable style={styles.signOutBox} onPress={onSignOut} hitSlop={8}>
        <Text style={styles.signOutText}>Sign out of OmaPointii</Text>
      </Pressable>

      <Text style={styles.fine}>
        Your points are held per store. Export and deletion are handled by the OmaPointii API;
        the app never stores a copy.
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
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
    alignSelf: 'flex-start',
  },
  back: {
    fontFamily: fonts.bodyBold,
    color: colors.terracottaInk,
    fontSize: 13,
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
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 26,
    marginBottom: 8,
  },
  privacyRow: {
    flexDirection: 'row',
    gap: 12,
  },
  privacyTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.text,
  },
  privacyBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },
  secondaryButton: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.background,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  toggleTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.text,
  },
  toggleBody: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  menuLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    color: colors.text,
    flex: 1,
  },
  feedbackLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: colors.muted,
    marginBottom: 8,
  },
  feedbackInput: {
    minHeight: 96,
    textAlignVertical: 'top',
    marginTop: 12,
  },
  dangerButton: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBCBBE',
    backgroundColor: colors.terracottaSoft,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.terracottaInk,
  },
  deleteBox: {
    marginTop: 10,
  },
  deleteWarn: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },
  resend: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.terracottaInk,
    textAlign: 'center',
    marginTop: 12,
  },
  cancel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
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
