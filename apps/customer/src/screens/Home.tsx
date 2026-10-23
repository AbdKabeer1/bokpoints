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
  getStores,
  type ExpiringItem,
  type Me,
  type StoreSummary,
} from '../lib/api';
import { expiryLabel, formatDate } from '../lib/format';
import { colors, layout } from '../lib/theme';
import { SettingsScreen } from './Settings';
import { StoreHistory } from './StoreHistory';

interface HomeProps {
  token: string;
  me: Me;
  onSignOut: () => void;
}

/**
 * The home screen opens on the QR code (FR-CUS-1): that is what a customer
 * needs at the till, before anything else.
 */
export function Home({ token, me, onSignOut }: HomeProps) {
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openStore, setOpenStore] = useState<StoreSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [storeList, expiringList] = await Promise.all([getStores(token), getExpiring(token)]);
      setStores(storeList.stores);
      setExpiring(expiringList.items);
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
    return <StoreHistory token={token} store={openStore} onBack={() => setOpenStore(null)} />;
  }

  if (showSettings) {
    return (
      <SettingsScreen
        token={token}
        me={me}
        onBack={() => setShowSettings(false)}
        onSignOut={onSignOut}
        onSaved={() => setShowSettings(false)}
      />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>POKET</Text>
          <Text style={styles.hello}>Hi {me.customer.name || 'there'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setShowSettings(true)} hitSlop={12}>
            <Text style={styles.signOut}>Settings</Text>
          </Pressable>
          <Pressable onPress={onSignOut} hitSlop={12}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.qrCard}>
        <QRCode
          value={me.credential.identifier}
          size={220}
          backgroundColor="#ffffff"
          color="#111111"
        />
        <Text style={styles.qrHint}>
          Turn your screen brightness up and show this at the till.
        </Text>
      </View>

      {expiring.map((item) => (
        <View key={`${item.storeId}-${item.expiresAt}`} style={styles.notice}>
          <Text style={styles.noticeText}>
            {item.points} points at {item.storeName} expire {expiryLabel(item.expiresAt)} — on{' '}
            {formatDate(item.expiresAt)}.
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Your stores</Text>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {stores === null ? (
        <ActivityIndicator color={colors.gold} style={styles.spinner} />
      ) : stores.length === 0 ? (
        <Text style={styles.empty}>
          No points yet. Show your code at a Poket till and they will appear here.
        </Text>
      ) : (
        stores.map((store) => (
          <Pressable
            key={store.storeId}
            style={styles.storeRow}
            onPress={() => setOpenStore(store)}
          >
            <View style={styles.storeText}>
              <Text style={styles.storeName}>{store.name}</Text>
              <Text style={styles.storeMeta}>
                last activity {formatDate(store.lastActivityAt)}
              </Text>
            </View>
            <Text style={styles.balance}>{store.balance} pts</Text>
          </Pressable>
        ))
      )}

      <Text style={styles.footer}>
        Points are per store and expire 3 months after you earn them.
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
    paddingTop: 64,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  brand: {
    color: colors.gold,
    fontWeight: '800',
    letterSpacing: 3,
    fontSize: 12,
  },
  hello: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginTop: 4,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  signOut: {
    color: colors.muted,
    fontSize: 14,
    paddingTop: 6,
  },
  qrCard: {
    backgroundColor: colors.card,
    borderRadius: layout.radius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 22,
    alignItems: 'center',
    marginBottom: 16,
  },
  qrHint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  notice: {
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0dca6',
    padding: 14,
    marginBottom: 12,
  },
  noticeText: {
    color: '#6b4e00',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginTop: 12,
    marginBottom: 10,
  },
  spinner: {
    marginTop: 16,
  },
  empty: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 10,
  },
  storeText: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  storeMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3,
  },
  balance: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 10,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 18,
  },
});
