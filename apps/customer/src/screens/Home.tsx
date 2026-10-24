import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  ApiError,
  getExpiring,
  getNotifications,
  getStores,
  setStoreConsent,
  type ExpiringItem,
  type Me,
  type Notification,
  type StoreSummary,
} from '../lib/api';
import { expiryLabel, formatDate } from '../lib/format';
import { colors, formatPoints, layout } from '../lib/theme';
import { Balance, Card, SectionTitle, SegmentBar, StoreAvatar } from '../components/ui';
import { Inbox } from './Inbox';
import { SettingsScreen } from './Settings';
import { StoreHistory } from './StoreHistory';

interface HomeProps {
  token: string;
  me: Me;
  onSignOut: () => void;
}

type Tab = 'home' | 'code' | 'inbox' | 'profile';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'code', label: 'My code', icon: '▦' },
  { id: 'inbox', label: 'Inbox', icon: '✉' },
  { id: 'profile', label: 'Profile', icon: '☺' },
];

const firstName = (me: Me): string => (me.customer.name || 'there').split(/\s+/)[0] ?? 'there';

const relative = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
};

/**
 * The customer app (brief §4.4): white space first, one large code, one
 * card per store with the balance as the biggest number, and a bar toward
 * the next reward. The dashboards' layout is deliberately not copied — only
 * their type, cards, pills and bars.
 */
export function Home({ token, me, onSignOut }: HomeProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openStore, setOpenStore] = useState<StoreSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [storeList, expiringList, inbox] = await Promise.all([
        getStores(token),
        getExpiring(token),
        getNotifications(token),
      ]);
      setStores(storeList.stores);
      setExpiring(expiringList.items);
      setNotifications(inbox.notifications);
      setUnread(inbox.unread);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? 'We could not load your points just now.'
          : 'Check your connection and pull down to refresh.',
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (openStore !== null) {
    return (
      <StoreHistory
        token={token}
        store={openStore}
        onBack={() => {
          setOpenStore(null);
          void load();
        }}
      />
    );
  }

  if (showSettings) {
    return (
      <SettingsScreen
        token={token}
        me={me}
        onBack={() => setShowSettings(false)}
        onSignOut={onSignOut}
        onSaved={() => {
          setShowSettings(false);
          void load();
        }}
      />
    );
  }

  const totalPoints = (stores ?? []).reduce((sum, store) => sum + store.balance, 0);
  const latest = notifications.slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.green}
          />
        }
      >
        {tab === 'home' && (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.brand}>
                  Poket<Text style={styles.brandDot}>.</Text>
                </Text>
                <Text style={styles.hello}>Hi {firstName(me)}</Text>
              </View>
              <Pressable
                onPress={() => setTab('profile')}
                accessibilityLabel="Open your profile"
                hitSlop={10}
                style={styles.headerAvatar}
              >
                <Text style={styles.headerAvatarText}>
                  {(me.customer.name || me.customer.email).slice(0, 1).toUpperCase()}
                </Text>
              </Pressable>
            </View>

            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <Text style={styles.heroLabel}>YOUR POKET CODE</Text>
                <View style={styles.heroLive}>
                  <View style={styles.heroLiveDot} />
                  <Text style={styles.heroLiveText}>Ready</Text>
                </View>
              </View>

              <View style={styles.heroRow}>
                <View style={styles.qrTile}>
                  <QRCode
                    value={me.credential.identifier}
                    size={132}
                    backgroundColor="#ffffff"
                    color="#111111"
                  />
                </View>
                <View style={styles.heroNumbers}>
                  <Text style={styles.heroLabel}>TOTAL POINTS</Text>
                  <Text style={styles.heroPoints}>{formatPoints(totalPoints)}</Text>
                  <Text style={styles.heroSub}>
                    {stores === null
                      ? 'loading…'
                      : `across ${stores.length} store${stores.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
              </View>

              <Text style={styles.heroHint}>
                Turn your brightness up and show this at the till.
              </Text>
            </View>

            {expiring.map((item) => (
              <View key={`${item.storeId}-${item.expiresAt}`} style={styles.expiry}>
                <View style={styles.expiryDot} />
                <Text style={styles.expiryText}>
                  <Text style={styles.expiryStrong}>
                    {item.points} points at {item.storeName}
                  </Text>{' '}
                  expire {expiryLabel(item.expiresAt)} — on {formatDate(item.expiresAt)}.
                </Text>
              </View>
            ))}

            {error !== null && <Text style={styles.error}>{error}</Text>}

            <SectionTitle
              title="Your stores"
              subtitle="Tap a store for rewards and history"
            />

            {stores === null ? (
              <ActivityIndicator color={colors.green} style={styles.spinner} />
            ) : stores.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>No points yet</Text>
                <Text style={styles.emptyBody}>
                  Show your code at a Poket till and your first points appear here.
                </Text>
              </Card>
            ) : (
              stores.map((store) => (
                <Pressable
                  key={store.storeId}
                  style={styles.storeCard}
                  onPress={() => setOpenStore(store)}
                  accessibilityLabel={`Open ${store.name}, ${store.balance} points`}
                >
                  <View style={styles.storeRow}>
                    <StoreAvatar name={store.name} color={store.brandColor} />
                    <View style={styles.storeText}>
                      <Text style={styles.storeName}>{store.name}</Text>
                      <Text style={styles.storeMeta}>
                        Last visit {formatDate(store.lastActivityAt)}
                      </Text>
                    </View>
                    <View style={styles.storeNumbers}>
                      <Balance value={store.balance} />
                      <Text style={styles.storePoints}>points</Text>
                    </View>
                  </View>

                  {store.nextReward !== null && (
                    <View style={styles.storeProgress}>
                      <SegmentBar
                        value={store.balance}
                        total={store.nextReward.pointsCost}
                        label={`${store.balance} of ${store.nextReward.pointsCost} · ${store.nextReward.name}`}
                      />
                    </View>
                  )}
                </Pressable>
              ))
            )}

            {latest.length > 0 && (
              <>
                <SectionTitle
                  title="From your stores"
                  subtitle="Messages sent inside Poket"
                  action="Inbox"
                  onAction={() => setTab('inbox')}
                />
                <Card style={{ padding: 0 }}>
                  {latest.map((message, index) => (
                    <Pressable
                      key={message.id}
                      onPress={() => setTab('inbox')}
                      style={[
                        styles.inboxRow,
                        index < latest.length - 1 && styles.inboxRowLine,
                      ]}
                    >
                      <StoreAvatar
                        name={message.storeName}
                        color={message.storeBrandColor}
                        size={36}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={styles.inboxTop}>
                          <Text style={styles.inboxStore}>{message.storeName}</Text>
                          {message.readAt === null && <View style={styles.unreadDot} />}
                        </View>
                        <Text style={styles.inboxTitle}>{message.title}</Text>
                        <Text style={styles.inboxTime}>{relative(message.createdAt)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </Card>
              </>
            )}

            <Text style={styles.footer}>
              Points are held per store and expire 3 months after you earn them.
            </Text>
          </>
        )}

        {tab === 'code' && (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.brand}>
                  Poket<Text style={styles.brandDot}>.</Text>
                </Text>
                <Text style={styles.hello}>Your code</Text>
              </View>
            </View>

            <View style={styles.codeCard}>
              <Text style={styles.codeName}>{me.customer.name || 'Your Poket code'}</Text>
              <Text style={styles.codeEmail}>{me.customer.email}</Text>
              <View style={styles.bigQrTile}>
                <QRCode
                  value={me.credential.identifier}
                  size={236}
                  backgroundColor="#ffffff"
                  color="#111111"
                />
              </View>
              <Text style={styles.codePoints}>
                {formatPoints(totalPoints)} points across {stores?.length ?? 0} store
                {(stores?.length ?? 0) === 1 ? '' : 's'}
              </Text>
              <Text style={styles.codeHint}>
                Turn your screen brightness up. The cashier scans this once; your points stay
                with each store.
              </Text>
            </View>

            <Text style={styles.footer}>
              This code is yours. Anyone who scans it can see your first name and points
              balance at the till — nothing else.
            </Text>
          </>
        )}

        {tab === 'inbox' && (
          <Inbox
            token={token}
            notifications={notifications}
            onRefresh={load}
            onChanged={async () => {
              await load();
            }}
          />
        )}

        {tab === 'profile' && (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.brand}>
                  Poket<Text style={styles.brandDot}>.</Text>
                </Text>
                <Text style={styles.hello}>Profile</Text>
              </View>
            </View>

            <Card>
              <View style={styles.profileRow}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileInitial}>
                    {(me.customer.name || me.customer.email).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{me.customer.name || 'No name yet'}</Text>
                  <Text style={styles.profileEmail}>{me.customer.email}</Text>
                </View>
              </View>
              <View style={styles.profileStats}>
                <View style={styles.profileStat}>
                  <Text style={styles.profileStatValue}>{formatPoints(totalPoints)}</Text>
                  <Text style={styles.profileStatLabel}>points</Text>
                </View>
                <View style={styles.profileStat}>
                  <Text style={styles.profileStatValue}>{stores?.length ?? 0}</Text>
                  <Text style={styles.profileStatLabel}>stores</Text>
                </View>
              </View>
            </Card>

            <SectionTitle title="Your account" />
            <Card style={{ padding: 0 }}>
              <Pressable style={styles.menuRow} onPress={() => setShowSettings(true)}>
                <Text style={styles.menuLabel}>Name, language and settings</Text>
                <Text style={styles.menuChevron}>›</Text>
              </Pressable>
              <Pressable style={styles.menuRow} onPress={() => setTab('code')}>
                <Text style={styles.menuLabel}>My code</Text>
                <Text style={styles.menuChevron}>›</Text>
              </Pressable>
              <Pressable
                style={[styles.menuRow, styles.menuRowLast]}
                onPress={() => setTab('inbox')}
              >
                <Text style={styles.menuLabel}>
                  Inbox{unread > 0 ? ` · ${unread} new` : ''}
                </Text>
                <Text style={styles.menuChevron}>›</Text>
              </Pressable>
            </Card>

            <SectionTitle
              title="Store news"
              subtitle="Choose which stores may message you in Poket"
            />
            {stores !== null && stores.length > 0 ? (
              <Card style={{ padding: 0 }}>
                {stores.map((store, index) => (
                  <View
                    key={store.storeId}
                    style={[
                      styles.consentRow,
                      index < stores.length - 1 && styles.consentRowLine,
                    ]}
                  >
                    <StoreAvatar name={store.name} color={store.brandColor} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.consentName}>{store.name}</Text>
                      <Text style={styles.consentState}>
                        {store.marketingConsent ? 'News and offers are on' : 'News and offers are off'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: store.marketingConsent }}
                      accessibilityLabel={`Store news from ${store.name}`}
                      onPress={() => {
                        const next = !store.marketingConsent;
                        setStores((current) =>
                          (current ?? []).map((entry) =>
                            entry.storeId === store.storeId
                              ? { ...entry, marketingConsent: next }
                              : entry,
                          ),
                        );
                        void setStoreConsent(token, store.storeId, next).catch(() => void load());
                      }}
                      style={[
                        styles.switch,
                        store.marketingConsent && styles.switchOn,
                      ]}
                    >
                      <View
                        style={[
                          styles.switchKnob,
                          store.marketingConsent && styles.switchKnobOn,
                        ]}
                      />
                    </Pressable>
                  </View>
                ))}
              </Card>
            ) : (
              <Card>
                <Text style={styles.emptyBody}>
                  Join a store by earning points there, then choose whether it may send you news.
                </Text>
              </Card>
            )}

            <SectionTitle title="Help" />
            <Card style={{ padding: 0 }}>
              <View style={styles.helpRow}>
                <Text style={styles.helpTitle}>A reward will not go through</Text>
                <Text style={styles.helpBody}>
                  Check you have enough points, the reward is active, and you have not used it
                  today if it has a daily limit. The till shows the reason.
                </Text>
              </View>
              <View style={[styles.helpRow, styles.menuRowLast]}>
                <Text style={styles.helpTitle}>Points disappeared</Text>
                <Text style={styles.helpBody}>
                  Points expire three months after you earn them. Open a store to see each
                  expiry in your history.
                </Text>
              </View>
            </Card>

            <Pressable style={styles.signOut} onPress={onSignOut} accessibilityRole="button">
              <Text style={styles.signOutText}>Sign out of Poket</Text>
            </Pressable>

            <Text style={styles.footer}>Poket · pilot build</Text>
          </>
        )}

        <View style={{ height: layout.tabBar }} />
      </ScrollView>

      <View style={styles.tabBar}>
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <Pressable
              key={entry.id}
              style={styles.tabItem}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(entry.id)}
            >
              <View style={styles.tabIconWrap}>
                <Text style={[styles.tabIcon, active && styles.tabIconOn]}>{entry.icon}</Text>
                {entry.id === 'inbox' && unread > 0 && <View style={styles.tabBadge} />}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: layout.screen,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.text,
  },
  brandDot: {
    color: colors.green,
  },
  hello: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
    letterSpacing: -0.5,
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    color: colors.onGreen,
    fontWeight: '800',
    fontSize: 16,
  },
  hero: {
    backgroundColor: colors.greenDark,
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  heroLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  heroLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#8ef0b4',
  },
  heroLiveText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  qrTile: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 10,
  },
  heroNumbers: {
    flex: 1,
  },
  heroPoints: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.5,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  heroSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 2,
  },
  heroHint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
  },
  expiry: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: colors.amberSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  expiryDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amber,
    marginTop: 6,
  },
  expiryText: {
    flex: 1,
    color: colors.amberInk,
    fontSize: 13,
    lineHeight: 19,
  },
  expiryStrong: {
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginVertical: 8,
  },
  spinner: {
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  storeCard: {
    backgroundColor: colors.card,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storeText: {
    flex: 1,
  },
  storeName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  storeMeta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  storeNumbers: {
    alignItems: 'flex-end',
  },
  storePoints: {
    color: colors.muted,
    fontSize: 10,
    marginTop: -2,
  },
  storeProgress: {
    marginTop: 12,
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 13,
  },
  inboxRowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  inboxTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inboxStore: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.green,
  },
  inboxTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  inboxTime: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 3,
  },
  footer: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 18,
  },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    padding: 20,
  },
  codeName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  codeEmail: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 16,
  },
  bigQrTile: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
  },
  codePoints: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  codeHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    color: colors.greenDark,
    fontSize: 18,
    fontWeight: '800',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  profileEmail: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  profileStats: {
    flexDirection: 'row',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  profileStat: {
    flex: 1,
  },
  profileStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  profileStatLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: -1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 48,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  menuChevron: {
    fontSize: 18,
    color: colors.muted,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
  },
  consentRowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  consentName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  consentState: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  switch: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.line,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: colors.green,
  },
  switchKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
  },
  helpRow: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  helpBody: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 3,
  },
  signOut: {
    marginTop: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    paddingVertical: 14,
    minHeight: 48,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: layout.tabBar,
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44,
  },
  tabIconWrap: {
    position: 'relative',
  },
  tabIcon: {
    fontSize: 18,
    color: colors.muted,
  },
  tabIconOn: {
    color: colors.green,
  },
  tabBadge: {
    position: 'absolute',
    top: -1,
    right: -5,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  tabLabelOn: {
    color: colors.greenDark,
    fontWeight: '800',
  },
});
