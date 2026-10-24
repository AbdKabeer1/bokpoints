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
import Feather from '@expo/vector-icons/Feather';
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
import { colors, fonts, formatPoints, layout } from '../lib/theme';
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

type IconName = React.ComponentProps<typeof Feather>['name'];

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'code', label: 'Code', icon: 'grid' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'profile', label: 'You', icon: 'user' },
];

const firstName = (me: Me): string => (me.customer.name || 'there').split(/\s+/)[0] ?? 'there';

const todayLabel = (): string =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

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
 * The customer app. Warm paper, an espresso code card, saffron for points
 * and terracotta for expiry. One code, one card per store, one line to the
 * next reward. The dashboards' layout is deliberately not copied.
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
            tintColor={colors.saffron}
          />
        }
      >
        {tab === 'home' && (
          <>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hello} numberOfLines={1}>
                  Hi {firstName(me)}
                </Text>
                <Text style={styles.headerDate}>{todayLabel()}</Text>
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
                    size={126}
                    backgroundColor="#FFFCF6"
                    color="#1A1712"
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

              <View style={styles.heroFoot}>
                <Text style={styles.heroHint}>Brightness up, show at the till.</Text>
                <Pressable
                  onPress={() => setTab('code')}
                  hitSlop={8}
                  style={styles.heroActionRow}
                >
                  <Text style={styles.heroAction}>Full screen</Text>
                  <Feather name="chevron-right" size={14} color={colors.saffron} />
                </Pressable>
              </View>
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

            <SectionTitle title="Your stores" subtitle="Rewards and history live here" />

            {stores === null ? (
              <ActivityIndicator color={colors.saffron} style={styles.spinner} />
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
                    <StoreAvatar name={store.name} color={store.brandColor} size={44} />
                    <View style={styles.storeText}>
                      <Text style={styles.storeName}>{store.name}</Text>
                      <Text style={styles.storeMeta}>
                        Last visit {formatDate(store.lastActivityAt)}
                      </Text>
                    </View>
                    <View style={styles.storeNumbers}>
                      <Balance value={store.balance} size={28} />
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
                  subtitle="Messages inside Poket"
                  action="Inbox"
                  onAction={() => setTab('inbox')}
                />
                <Card style={{ padding: 0 }}>
                  {latest.map((message, index) => (
                    <Pressable
                      key={message.id}
                      onPress={() => setTab('inbox')}
                      style={[styles.inboxRow, index < latest.length - 1 && styles.inboxRowLine]}
                    >
                      <StoreAvatar
                        name={message.storeName}
                        color={message.storeBrandColor}
                        size={38}
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
              Points live with each store and expire three months after you earn them.
            </Text>
          </>
        )}

        {tab === 'code' && (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.hello}>Your code</Text>
              </View>
            </View>

            <View style={styles.codeCard}>
              <Text style={styles.codeName}>{me.customer.name || 'Your Poket code'}</Text>
              <Text style={styles.codeEmail}>{me.customer.email}</Text>
              <View style={styles.bigQrTile}>
                <QRCode
                  value={me.credential.identifier}
                  size={232}
                  backgroundColor="#FFFCF6"
                  color="#1A1712"
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
              This code is yours. Anyone who scans it sees your first name and points balance at
              the till — nothing else.
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
                <Text style={styles.hello}>You</Text>
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
                <View style={styles.profileStatDivider} />
                <View style={styles.profileStat}>
                  <Text style={styles.profileStatValue}>{stores?.length ?? 0}</Text>
                  <Text style={styles.profileStatLabel}>stores</Text>
                </View>
              </View>
            </Card>

            <SectionTitle title="Account" />
            <Card style={{ padding: 0 }}>
              <Pressable style={styles.menuRow} onPress={() => setShowSettings(true)}>
                <Text style={styles.menuLabel}>Name, language and settings</Text>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
              <Pressable style={styles.menuRow} onPress={() => setTab('code')}>
                <Text style={styles.menuLabel}>My code</Text>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
              <Pressable style={[styles.menuRow, styles.menuRowLast]} onPress={() => setTab('inbox')}>
                <Text style={styles.menuLabel}>
                  Inbox{unread > 0 ? ` · ${unread} new` : ''}
                </Text>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            </Card>

            <SectionTitle title="Store news" subtitle="Which stores may message you in Poket" />
            {stores !== null && stores.length > 0 ? (
              <Card style={{ padding: 0 }}>
                {stores.map((store, index) => (
                  <View
                    key={store.storeId}
                    style={[styles.consentRow, index < stores.length - 1 && styles.consentRowLine]}
                  >
                    <StoreAvatar name={store.name} color={store.brandColor} size={36} />
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
                      style={[styles.switch, store.marketingConsent && styles.switchOn]}
                    >
                      <View
                        style={[styles.switchKnob, store.marketingConsent && styles.switchKnobOn]}
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
                  Points expire three months after you earn them. Open a store to see each expiry
                  in your history.
                </Text>
              </View>
            </Card>

            <Pressable style={styles.signOut} onPress={onSignOut} accessibilityRole="button">
              <Text style={styles.signOutText}>Sign out of Poket</Text>
            </Pressable>

            <Text style={styles.footer}>Poket · pilot build</Text>
          </>
        )}

        <View style={{ height: layout.tabBar + 16 }} />
      </ScrollView>

      <View style={styles.tabBar}>
        <View style={styles.tabBarInner}>
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                style={[styles.tabItem, active && styles.tabItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(entry.id)}
              >
                <View style={styles.tabIconWrap}>
                  <Feather
                    name={entry.icon}
                    size={18}
                    color={active ? colors.saffron : colors.muted}
                  />
                  {entry.id === 'inbox' && unread > 0 && (
                    <View style={[styles.tabBadge, active && styles.tabBadgeOn]} />
                  )}
                </View>
                <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
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
    paddingTop: 58,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
  },
  hello: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.text,
  },
  headerDate: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 5,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.espresso,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  headerAvatarText: {
    color: colors.onEspresso,
    fontFamily: fonts.display,
    fontSize: 18,
  },
  hero: {
    backgroundColor: colors.espresso,
    borderRadius: 26,
    padding: 20,
    marginBottom: 14,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroLabel: {
    color: 'rgba(251,245,232,0.66)',
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.saffron,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  heroLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.espresso,
  },
  heroLiveText: {
    color: colors.espresso,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  qrTile: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 9,
  },
  heroNumbers: {
    flex: 1,
  },
  heroPoints: {
    color: colors.onEspresso,
    fontFamily: fonts.display,
    fontSize: 46,
    lineHeight: 52,
    marginTop: 2,
  },
  heroSub: {
    color: 'rgba(251,245,232,0.7)',
    fontFamily: fonts.body,
    fontSize: 12,
    marginTop: 2,
  },
  heroFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251,245,232,0.14)',
    paddingTop: 12,
  },
  heroHint: {
    color: 'rgba(251,245,232,0.7)',
    fontFamily: fonts.body,
    fontSize: 11.5,
    flex: 1,
  },
  heroActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heroAction: {
    color: colors.saffron,
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
  },
  expiry: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.terracottaSoft,
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
  },
  expiryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.terracotta,
    marginTop: 6,
  },
  expiryText: {
    flex: 1,
    color: colors.terracottaInk,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
  },
  expiryStrong: {
    fontFamily: fonts.bodyBold,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    marginVertical: 8,
  },
  spinner: {
    marginTop: 12,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
  },
  emptyBody: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 5,
  },
  storeCard: {
    backgroundColor: colors.card,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 15,
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
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.text,
  },
  storeMeta: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 11,
    marginTop: 2,
  },
  storeNumbers: {
    alignItems: 'flex-end',
  },
  storePoints: {
    color: colors.muted,
    fontFamily: fonts.bodyMedium,
    fontSize: 9.5,
    letterSpacing: 0.4,
    marginTop: -3,
  },
  storeProgress: {
    marginTop: 13,
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 14,
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
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.terracotta,
  },
  inboxTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.text,
    marginTop: 3,
  },
  inboxTime: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: 4,
  },
  footer: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 20,
  },
  codeCard: {
    backgroundColor: colors.espresso,
    borderRadius: 26,
    alignItems: 'center',
    padding: 22,
  },
  codeName: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.onEspresso,
  },
  codeEmail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: 'rgba(251,245,232,0.66)',
    marginTop: 3,
    marginBottom: 18,
  },
  bigQrTile: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 14,
  },
  codePoints: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.onEspresso,
    marginTop: 18,
    textAlign: 'center',
  },
  codeHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(251,245,232,0.66)',
    textAlign: 'center',
    marginTop: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.saffronSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    color: colors.saffronInk,
    fontFamily: fonts.display,
    fontSize: 21,
  },
  profileName: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.text,
  },
  profileEmail: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  profileStats: {
    flexDirection: 'row',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
    alignItems: 'center',
  },
  profileStat: {
    flex: 1,
  },
  profileStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.line,
    marginRight: 16,
  },
  profileStatValue: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.text,
  },
  profileStatLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 48,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    color: colors.text,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
  },
  consentRowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
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
  switch: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.lineStrong,
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
    backgroundColor: colors.card,
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
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
    marginTop: 26,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBCBBE',
    backgroundColor: colors.terracottaSoft,
    alignItems: 'center',
    paddingVertical: 15,
    minHeight: 48,
  },
  signOutText: {
    color: colors.terracottaInk,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
  },
  tabBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
  },
  tabBarInner: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 6,
    shadowColor: '#3A2E1E',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 18,
    gap: 2,
    minHeight: 50,
  },
  tabItemOn: {
    backgroundColor: colors.espresso,
  },
  tabIconWrap: {
    position: 'relative',
  },
  tabBadge: {
    position: 'absolute',
    top: -1,
    right: -6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.terracotta,
  },
  tabBadgeOn: {
    backgroundColor: colors.saffron,
  },
  tabLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9.5,
    color: colors.muted,
  },
  tabLabelOn: {
    color: colors.onEspresso,
    fontFamily: fonts.bodyBold,
  },
});
