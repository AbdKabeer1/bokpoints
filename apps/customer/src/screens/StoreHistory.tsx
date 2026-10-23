import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getHistory,
  getStoreRewards,
  type History,
  type StoreReward,
  type StoreSummary,
} from '../lib/api';
import { formatDate, typeLabel } from '../lib/format';
import { colors, layout } from '../lib/theme';

interface StoreHistoryProps {
  token: string;
  store: StoreSummary;
  onBack: () => void;
}

/** One store's entries, newest first, with the balance after each (FR-CUS-3). */
export function StoreHistory({ token, store, onBack }: StoreHistoryProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [rewards, setRewards] = useState<StoreReward[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getHistory(token, store.storeId);
        if (!cancelled) setHistory(loaded);
      } catch {
        if (!cancelled) setError('We could not load this history. Try again in a moment.');
      }
    })();
    // The catalog is a nice-to-have on this screen: a failure just hides it.
    void (async () => {
      try {
        const loaded = await getStoreRewards(token, store.storeId);
        if (!cancelled) setRewards(loaded.rewards);
      } catch {
        if (!cancelled) setRewards(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, store.storeId]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ Your stores</Text>
      </Pressable>

      <Text style={styles.title}>{store.name}</Text>
      <Text style={styles.balance}>{history?.balance ?? store.balance} points</Text>

      {rewards !== null && rewards.length > 0 && (
        <View style={styles.rewards}>
          <Text style={styles.rewardsTitle}>Your points here are worth</Text>
          {rewards.map((reward) => (
            <View key={reward.rewardId} style={styles.rewardRow}>
              <Text style={styles.rewardName}>{reward.name}</Text>
              <Text style={styles.rewardCost}>{reward.pointsCost} pts</Text>
            </View>
          ))}
        </View>
      )}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {history === null && error === null ? (
        <ActivityIndicator color={colors.gold} style={styles.spinner} />
      ) : history !== null && history.entries.length === 0 ? (
        <Text style={styles.empty}>No entries yet.</Text>
      ) : (
        history?.entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.type}>{typeLabel(entry.type)}</Text>
              <Text style={styles.date}>{formatDate(entry.createdAt)}</Text>
            </View>
            <View style={styles.rowNumbers}>
              <Text style={[styles.points, entry.points < 0 ? styles.negative : styles.positive]}>
                {entry.points > 0 ? `+${entry.points}` : entry.points}
              </Text>
              <Text style={styles.after}>{entry.balanceAfter} after</Text>
            </View>
          </View>
        ))
      )}
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
  balance: {
    fontSize: 17,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 20,
  },
  spinner: {
    marginTop: 16,
  },
  rewards: {
    marginBottom: 20,
  },
  rewardsTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  rewardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  rewardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rewardCost: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    color: colors.muted,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
  },
  type: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  date: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  rowNumbers: {
    alignItems: 'flex-end',
  },
  points: {
    fontSize: 16,
    fontWeight: '800',
  },
  positive: {
    color: '#15803d',
  },
  negative: {
    color: colors.danger,
  },
  after: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
});
