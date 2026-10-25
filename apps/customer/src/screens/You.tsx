import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { Me, StoreSummary } from '../lib/api';
import { colors, fonts, formatPoints } from '../lib/theme';
import { Card, SectionTitle, StoreAvatar } from '../components/ui';

interface YouProps {
  me: Me;
  stores: StoreSummary[];
  totalPoints: number;
  onOpenSettings: () => void;
  onToggleConsent: (storeId: string, next: boolean) => void;
  onSignOut: () => void;
  onBack: () => void;
}

/** The customer's own corner: identity, consent per store, settings, exit. */
export function You({
  me,
  stores,
  totalPoints,
  onOpenSettings,
  onToggleConsent,
  onSignOut,
  onBack,
}: YouProps) {
  return (
    <View>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backRow}>
        <Feather name="arrow-left" size={16} color={colors.muted} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.head}>
        <Text style={styles.title}>You</Text>
        <Text style={styles.sub}>Your account and preferences</Text>
      </View>

      <Card>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.initial}>
              {(me.customer.name || me.customer.email).slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{me.customer.name || 'No name yet'}</Text>
            <Text style={styles.email}>{me.customer.email}</Text>
          </View>
        </View>
        <View style={styles.stats}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statValue}>{formatPoints(totalPoints)}</Text>
            <Text style={styles.statLabel}>points</Text>
          </View>
          <View style={styles.divider} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statValue}>{stores.length}</Text>
            <Text style={styles.statLabel}>stores</Text>
          </View>
        </View>
      </Card>

      <SectionTitle title="Account" />
      <Card style={{ padding: 0 }}>
        <Pressable style={styles.menuRow} onPress={onOpenSettings}>
          <Text style={styles.menuLabel}>Name, language and settings</Text>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
        <View style={[styles.menuRow, styles.menuRowLast]}>
          <Text style={styles.menuLabel}>Code</Text>
          <Text style={styles.menuValue}>Tap “My QR” on any screen</Text>
        </View>
      </Card>

      <SectionTitle title="Store news" subtitle="Choose which stores may send offers in the app" />
      {stores.length === 0 ? (
        <Card>
          <Text style={styles.empty}>
            Join a store by earning points there, then choose whether it may send offers.
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {stores.map((store, index) => (
            <View
              key={store.storeId}
              style={[styles.consentRow, index < stores.length - 1 && styles.rowLine]}
            >
              <StoreAvatar
                name={store.name}
                color={store.brandColor}
                logoUrl={store.logoUrl}
                size={34}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.consentName}>{store.name}</Text>
                <Text style={styles.consentState}>
                  {store.marketingConsent ? 'Offers are on' : 'Offers are off'}
                </Text>
              </View>
              <Switch
                value={store.marketingConsent}
                onValueChange={(next) => onToggleConsent(store.storeId, next)}
                trackColor={{ false: colors.lineStrong, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </Card>
      )}

      <SectionTitle title="Help" />
      <Card style={{ padding: 0 }}>
        <View style={styles.helpRow}>
          <Text style={styles.helpTitle}>A reward will not go through</Text>
          <Text style={styles.helpBody}>
            Check you have enough points and the reward is still active. The till shows the
            reason if it refuses.
          </Text>
        </View>
        <View style={[styles.helpRow, styles.menuRowLast]}>
          <Text style={styles.helpTitle}>Points disappeared</Text>
          <Text style={styles.helpBody}>
            Points expire three months after you earn them. Each store page shows the dates.
          </Text>
        </View>
      </Card>

      <Pressable style={styles.signOut} onPress={onSignOut} accessibilityRole="button">
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.fine}>OmaPointii · pilot build</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    alignSelf: 'flex-start',
  },
  backText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: colors.muted,
  },
  head: { marginBottom: 16 },
  title: {
    fontFamily: fonts.bodyExtra,
    fontSize: 32,
    letterSpacing: -1,
    color: colors.text,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.bodyExtra,
    fontSize: 20,
    color: colors.primary,
  },
  name: {
    fontFamily: fonts.bodyExtra,
    fontSize: 19,
    color: colors.text,
  },
  email: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 16,
    paddingTop: 14,
  },
  statValue: {
    fontFamily: fonts.bodyExtra,
    fontSize: 24,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9.5,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 1,
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: colors.line,
    marginRight: 16,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 48,
  },
  menuRowLast: { borderBottomWidth: 0 },
  menuLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    color: colors.text,
  },
  menuValue: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  consentName: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
  consentState: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  helpRow: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  helpTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
  helpBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 3,
  },
  signOut: {
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.danger,
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 18,
  },
});
