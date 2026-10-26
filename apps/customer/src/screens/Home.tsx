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
import Feather from '@expo/vector-icons/Feather';
import {
  ApiError,
  getDirectory,
  getExpiring,
  getNotifications,
  getStores,
  setStoreConsent,
  type DirectoryStore,
  type ExpiringItem,
  type Me,
  type Notification,
  type StoreSummary,
} from '../lib/api';
import { requestLocation } from '../lib/location';
import { expiryLabel, formatDate } from '../lib/format';
import { colors, fonts, formatPoints, layout } from '../lib/theme';
import { Card, SegmentBar, StoreAvatar } from '../components/ui';
import { QrSheet } from '../components/QrSheet';
import { Coupons } from './Coupons';
import { Offers } from './Offers';
import { Inbox } from './Inbox';
import { Stores } from './Stores';
import { You } from './You';
import { SettingsScreen } from './Settings';
import { StoreHistory } from './StoreHistory';

interface HomeProps {
  token: string;
  me: Me;
  onMeChanged: (me: Me) => void;
  onSignOut: () => void;
}

type Tab = 'home' | 'coupons' | 'offers' | 'inbox' | 'stores' | 'you';

type IconName = React.ComponentProps<typeof Feather>['name'];

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'coupons', label: 'Coupons', icon: 'tag' },
  { id: 'offers', label: 'Offers', icon: 'percent' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'stores', label: 'Stores', icon: 'map-pin' },
];

const firstName = (me: Me): string => (me.customer.name || 'there').split(/\s+/)[0] ?? 'there';

const today = (): string =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const relative = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export function Home({ token, me, onMeChanged, onSignOut }: HomeProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryStore[] | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openStore, setOpenStore] = useState<StoreSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async (coords?: { lat?: number; lon?: number }) => {
    try {
      const [mine, expiringList, inbox] = await Promise.all([
        getStores(token),
        getExpiring(token),
        getNotifications(token),
      ]);
      const all = await getDirectory(token, coords?.lat, coords?.lon);
      setStores(mine.stores);
      setDirectory(all.stores);
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
    const coords = await requestLocation();
    await load(coords ?? undefined);
    setRefreshing(false);
  };

  const enableLocation = async () => {
    setLocating(true);
    const coords = await requestLocation();
    if (coords) await load(coords);
    setLocating(false);
  };

  const toggleConsent = (storeId: string, next: boolean) => {
    setStores((current) =>
      (current ?? []).map((store) =>
        store.storeId === storeId ? { ...store, marketingConsent: next } : store,
      ),
    );
    void setStoreConsent(token, storeId, next).catch(() => void load());
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
        onSaved={(updated) => {
          onMeChanged(updated);
          setShowSettings(false);
          void load();
        }}
      />
    );
  }

  const totalPoints = (stores ?? []).reduce((sum, store) => sum + store.balance, 0);
  const latest = notifications.slice(0, 2);
  // Older API responses may predate the preference; default to on.
  const notificationsEnabled = me.customer.notificationsEnabled ?? true;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
      >
        {error !== null && <Text style={styles.error}>{error}</Text>}

        {tab === 'home' && (
          <>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hello}>Hi {firstName(me)}</Text>
                <Text style={styles.date}>{today()}</Text>
              </View>
            </View>

            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>YOUR POINTS</Text>
              <Text style={styles.summaryValue}>{formatPoints(totalPoints)}</Text>
              <View style={styles.summaryFoot}>
                <Text style={styles.summarySub}>
                  across {(stores ?? []).length} store{(stores ?? []).length === 1 ? '' : 's'}
                </Text>
                <Pressable onPress={() => setQrOpen(true)} hitSlop={8}>
                  <Text style={styles.summaryAction}>Show my code</Text>
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
                  expire {expiryLabel(item.expiresAt)} — {formatDate(item.expiresAt)}.
                </Text>
              </View>
            ))}

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Your stores</Text>
              <Pressable onPress={() => setTab('stores')} hitSlop={8}>
                <Text style={styles.sectionAction}>All stores</Text>
              </Pressable>
            </View>

            {stores === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
            ) : stores.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>No points yet</Text>
                <Text style={styles.emptyBody}>
                  Show your code at an OmaPointii till and your first points appear here.
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
                  <View style={styles.storeTop}>
                    <StoreAvatar
                      name={store.name}
                      color={store.brandColor}
                      logoUrl={store.logoUrl}
                      size={44}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.storeName}>{store.name}</Text>
                      <Text style={styles.storeMeta}>
                        Last visit {formatDate(store.lastActivityAt)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.storeBalance}>{formatPoints(store.balance)}</Text>
                      <Text style={styles.storePoints}>points</Text>
                    </View>
                  </View>
                  {store.nextReward !== null && (
                    <View style={{ marginTop: 12 }}>
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
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionTitle}>Messages</Text>
                  <Pressable onPress={() => setTab('inbox')} hitSlop={8}>
                    <Text style={styles.sectionAction}>Inbox</Text>
                  </Pressable>
                </View>
                {latest.map((message) => (
                  <Pressable
                    key={message.id}
                    style={styles.offerRow}
                    onPress={() => setTab('inbox')}
                  >
                    <StoreAvatar
                      name={message.storeName}
                      color={message.storeBrandColor}
                      logoUrl={message.storeLogoUrl}
                      size={38}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.offerStore}>{message.storeName}</Text>
                      <Text style={styles.offerTitle}>{message.title}</Text>
                      <Text style={styles.offerTime}>{relative(message.createdAt)}</Text>
                    </View>
                    {message.readAt === null && <View style={styles.offerDot} />}
                  </Pressable>
                ))}
              </>
            )}

            <Text style={styles.footer}>
              Points live with each store and expire three months after you earn them.
            </Text>
          </>
        )}

        {tab === 'coupons' && (
          <Coupons token={token} stores={stores ?? []} onOpenStore={setOpenStore} />
        )}
        {tab === 'offers' && (
          <Offers token={token} stores={stores ?? []} onOpenStore={setOpenStore} />
        )}
        {tab === 'inbox' && (
          <Inbox
            token={token}
            notifications={notifications}
            enabled={notificationsEnabled}
            onChanged={load}
          />
        )}
        {tab === 'stores' && (
          <Stores
            directory={directory}
            visited={stores ?? []}
            onOpenStore={setOpenStore}
            onEnableLocation={() => void enableLocation()}
            locating={locating}
          />
        )}
        {tab === 'you' && (
          <You
            me={me}
            stores={stores ?? []}
            totalPoints={totalPoints}
            onOpenSettings={() => setShowSettings(true)}
            onToggleConsent={toggleConsent}
            onSignOut={onSignOut}
            onBack={() => setTab('home')}
          />
        )}

        <View style={{ height: layout.tabBar + 34 }} />
      </ScrollView>

      {tab !== 'you' && (
        <Pressable
          style={styles.globalAvatar}
          onPress={() => setTab('you')}
          accessibilityLabel="Open your profile"
          accessibilityRole="button"
        >
          <Text style={styles.globalInitial}>
            {(me.customer.name || me.customer.email).slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      )}

      <Pressable style={styles.fab} onPress={() => setQrOpen(true)} accessibilityRole="button">
        <Feather name="maximize" size={17} color={colors.onPrimary} />
        <Text style={styles.fabText}>My QR</Text>
      </Pressable>

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
              <View style={[styles.tabIconWrap, active && styles.tabIconOn]}>
                <Feather
                  name={entry.icon}
                  size={19}
                  color={active ? colors.onPrimary : colors.muted}
                />
                {entry.id === 'inbox' && notificationsEnabled && unread > 0 && !active && (
                  <View style={styles.tabDot} />
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <QrSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        identifier={me.credential.identifier}
        name={me.customer.name || 'Your code'}
        totalPoints={totalPoints}
        storeCount={(stores ?? []).length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: layout.screen, paddingTop: 58, paddingBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  hello: {
    fontFamily: fonts.bodyExtra,
    fontSize: 30,
    letterSpacing: -1,
    color: colors.text,
  },
  date: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 4 },
  globalAvatar: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  globalInitial: { fontFamily: fonts.bodyExtra, fontSize: 15, color: colors.primary },
  summary: {
    backgroundColor: colors.primary,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
  },
  summaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.72)',
  },
  summaryValue: {
    fontFamily: fonts.bodyExtra,
    fontSize: 48,
    lineHeight: 54,
    letterSpacing: -2,
    color: colors.onPrimary,
    marginTop: 4,
  },
  summaryFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  summarySub: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.78)' },
  summaryAction: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.onPrimary },
  expiry: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: colors.amberSoft,
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
  },
  expiryDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amber,
    marginTop: 6,
  },
  expiryText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, color: colors.amberInk },
  expiryStrong: { fontFamily: fonts.bodyBold },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: { fontFamily: fonts.bodyExtra, fontSize: 17, color: colors.text },
  sectionAction: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.primary },
  storeCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 9,
  },
  storeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  storeName: { fontFamily: fonts.bodyExtra, fontSize: 15, color: colors.text },
  storeMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 2 },
  storeBalance: {
    fontFamily: fonts.bodyExtra,
    fontSize: 20,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  storePoints: { fontFamily: fonts.body, fontSize: 9.5, color: colors.muted, marginTop: -2 },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 13,
    marginBottom: 9,
  },
  offerStore: {
    fontFamily: fonts.bodySemi,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  offerTitle: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.text, marginTop: 2 },
  offerTime: { fontFamily: fonts.body, fontSize: 10, color: colors.muted, marginTop: 3 },
  offerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginTop: 4 },
  footer: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 20,
  },
  error: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.danger, marginBottom: 10 },
  emptyTitle: { fontFamily: fonts.bodyExtra, fontSize: 16, color: colors.text },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: layout.tabBar + 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  fabText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.onPrimary },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingBottom: 20,
    height: layout.tabBar + 12,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabIconWrap: {
    width: 38,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconOn: { backgroundColor: colors.primary },
  tabDot: {
    position: 'absolute',
    top: 3,
    right: 7,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.amber,
  },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: 9.5, color: colors.muted },
  tabLabelOn: { fontFamily: fonts.bodyBold, color: colors.primary },
});
