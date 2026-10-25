import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { DirectoryStore, StoreSummary } from '../lib/api';
import { colors, fonts, formatPoints } from '../lib/theme';
import { Pill, StoreAvatar } from '../components/ui';

interface StoresProps {
  directory: DirectoryStore[] | null;
  visited: StoreSummary[];
  onOpenStore: (store: StoreSummary) => void;
}

/** Every active business on OmaPointii, with the customer's own state. */
export function Stores({ directory, visited, onOpenStore }: StoresProps) {
  const [query, setQuery] = useState('');

  const visitedById = useMemo(
    () => new Map(visited.map((store) => [store.storeId, store])),
    [visited],
  );

  const filtered = (directory ?? []).filter((store) => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return true;
    return (
      store.name.toLowerCase().includes(needle) ||
      (store.address ?? '').toLowerCase().includes(needle)
    );
  });

  const mine = filtered.filter((store) => visitedById.has(store.storeId));
  const others = filtered.filter((store) => !visitedById.has(store.storeId));

  const renderStore = (store: DirectoryStore) => {
    const summary = visitedById.get(store.storeId);
    return (
      <Pressable
        key={store.storeId}
        style={styles.row}
        disabled={summary === undefined}
        onPress={() => {
          if (summary !== undefined) onOpenStore(summary);
        }}
        accessibilityLabel={
          summary === undefined ? store.name : `Open ${store.name}, ${summary.balance} points`
        }
      >
        <StoreAvatar
          name={store.name}
          color={store.brandColor}
          logoUrl={store.logoUrl}
          size={46}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{store.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {store.address ?? 'Helsinki'}
          </Text>
        </View>
        {summary === undefined ? (
          <Pill label="New" tone="grey" dot={false} />
        ) : (
          <View style={styles.balanceBox}>
            <Text style={styles.balance}>{formatPoints(summary.balance)}</Text>
            <Text style={styles.points}>points</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Stores</Text>
        <Text style={styles.sub}>
          {directory === null
            ? 'Loading…'
            : `${directory.length} ${directory.length === 1 ? 'business' : 'businesses'} on OmaPointii`}
        </Text>
      </View>

      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search stores"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {mine.length > 0 && (
        <>
          <Text style={styles.section}>Your stores</Text>
          {mine.map(renderStore)}
        </>
      )}

      {others.length > 0 && (
        <>
          <Text style={styles.section}>{mine.length > 0 ? 'New to you' : 'All stores'}</Text>
          {others.map(renderStore)}
        </>
      )}

      {directory !== null && filtered.length === 0 && (
        <Text style={styles.empty}>
          {query.trim() === ''
            ? 'No stores are open on OmaPointii yet.'
            : `Nothing matches “${query.trim()}”.`}
        </Text>
      )}

      <Text style={styles.fine}>
        Visit any store and show your code at the till. Points stay with that store, and its
        coupons appear under Coupons.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
  },
  section: {
    fontFamily: fonts.bodyExtra,
    fontSize: 13,
    color: colors.text,
    marginTop: 14,
    marginBottom: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 13,
    marginBottom: 9,
  },
  name: {
    fontFamily: fonts.bodyExtra,
    fontSize: 15,
    color: colors.text,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  balanceBox: { alignItems: 'flex-end' },
  balance: {
    fontFamily: fonts.bodyExtra,
    fontSize: 18,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  points: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: colors.muted,
    marginTop: -1,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 16,
    textAlign: 'center',
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 18,
  },
});
