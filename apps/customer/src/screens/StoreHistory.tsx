import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  getDiscountProof,
  getHistory,
  getStoreRewards,
  setStoreConsent,
  type DiscountProof,
  type History,
  type StoreReward,
  type StoreSummary,
} from '../lib/api';
import { formatDate, typeLabel } from '../lib/format';
import { colors, formatPoints, layout } from '../lib/theme';
import { Card, Pill, SegmentBar, StoreAvatar } from '../components/ui';

interface StoreHistoryProps {
  token: string;
  store: StoreSummary;
  onBack: () => void;
}

const TONES: Record<string, 'green' | 'amber' | 'grey' | 'info' | 'danger'> = {
  earn: 'green',
  redeem: 'amber',
  expire: 'grey',
  adjust: 'info',
  reversal: 'danger',
};

/**
 * One store, as the customer sees it: the balance, the rewards within reach,
 * the rotating discount code, whether the store may send news, and every
 * entry with the balance after it (FR-CUS-3).
 */
export function StoreHistory({ token, store, onBack }: StoreHistoryProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [rewards, setRewards] = useState<StoreReward[] | null>(null);
  const [proof, setProof] = useState<DiscountProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(store.marketingConsent);
  const [consentBusy, setConsentBusy] = useState(false);

  const refreshProof = useCallback(async () => {
    try {
      const loaded = await getDiscountProof(token, store.storeId);
      setProof(loaded);
      setSecondsLeft(
        Math.max(0, Math.round((new Date(loaded.expiresAt).getTime() - Date.now()) / 1000)),
      );
      setProofError(null);
    } catch {
      setProof(null);
      setProofError('The discount code needs a connection.');
    }
  }, [token, store.storeId]);

  useEffect(() => {
    void refreshProof();
  }, [refreshProof]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((left) => (left > 0 ? left - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  const balance = history?.balance ?? store.balance;

  const toggleConsent = async (next: boolean) => {
    setConsent(next);
    setConsentBusy(true);
    try {
      await setStoreConsent(token, store.storeId, next);
    } catch {
      setConsent(!next);
    } finally {
      setConsentBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ Your stores</Text>
      </Pressable>

      <View style={styles.head}>
        <StoreAvatar name={store.name} color={store.brandColor} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{store.name}</Text>
          <Text style={styles.balanceLine}>points here</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.balance}>{formatPoints(balance)}</Text>
        </View>
      </View>

      {store.nextReward !== null && (
        <Card style={{ marginBottom: 16 }}>
          <SegmentBar
            value={balance}
            total={store.nextReward.pointsCost}
            label={`${balance} of ${store.nextReward.pointsCost} · ${store.nextReward.name}`}
          />
        </Card>
      )}

      {rewards !== null && rewards.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 16 }}>
          <Text style={styles.cardLabel}>Rewards here</Text>
          {rewards.map((reward, index) => {
            const ready = balance >= reward.pointsCost;
            return (
              <View
                key={reward.rewardId}
                style={[styles.rewardRow, index < rewards.length - 1 && styles.rowLine]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rewardName}>{reward.name}</Text>
                  <Text style={styles.rewardCost}>
                    {formatPoints(reward.pointsCost)} points
                    {ready ? '' : ` · ${formatPoints(reward.pointsCost - balance)} to go`}
                  </Text>
                </View>
                <Pill
                  label={ready ? 'Ready to use' : 'Keep earning'}
                  tone={ready ? 'green' : 'grey'}
                />
              </View>
            );
          })}
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <View style={styles.consentRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentName}>News and offers from {store.name}</Text>
            <Text style={styles.consentBody}>
              {consent
                ? 'On. Messages arrive in your Poket inbox.'
                : 'Off. This store cannot message you in Poket.'}
            </Text>
          </View>
          <Switch
            value={consent}
            onValueChange={(next) => void toggleConsent(next)}
            disabled={consentBusy}
            trackColor={{ false: colors.line, true: colors.green }}
            thumbColor="#ffffff"
          />
        </View>
      </Card>

      {proof !== null && proof.active && (
        <View style={styles.proofCard}>
          <Text style={styles.proofTitle}>Discount code</Text>
          <View style={styles.proofQr}>
            <QRCode
              value={proof.proof}
              size={148}
              color={colors.text}
              backgroundColor={colors.card}
            />
          </View>
          <Text style={styles.proofHint}>
            Show it at the till — works once, for{' '}
            {secondsLeft > 0 ? `${secondsLeft} s` : 'a moment'} longer
          </Text>
          <Pressable onPress={() => void refreshProof()} hitSlop={8}>
            <Text style={styles.proofRefresh}>Get a fresh code</Text>
          </Pressable>
        </View>
      )}
      {proof === null && proofError !== null && <Text style={styles.proofError}>{proofError}</Text>}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.cardLabel}>History</Text>

      {history === null && error === null ? (
        <ActivityIndicator color={colors.green} style={styles.spinner} />
      ) : history !== null && history.entries.length === 0 ? (
        <Text style={styles.empty}>No entries yet.</Text>
      ) : (
        history?.entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Pill label={typeLabel(entry.type)} tone={TONES[entry.type] ?? 'grey'} />
              </View>
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

      <Text style={styles.fine}>
        Points expire three months after you earn them. A reward is taken at the till when it is
        handed over.
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
    paddingTop: 60,
    paddingBottom: 40,
  },
  back: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.4,
  },
  balanceLine: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  balance: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
    padding: 16,
    paddingBottom: 8,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rewardName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  rewardCost: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  consentName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  consentBody: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  proofCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    padding: 18,
    marginBottom: 16,
  },
  proofTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  proofQr: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  proofHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  proofRefresh: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  proofError: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 16,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
  },
  spinner: {
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 13,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  date: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
  },
  rowNumbers: {
    alignItems: 'flex-end',
  },
  points: {
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  positive: {
    color: colors.greenDark,
  },
  negative: {
    color: colors.danger,
  },
  after: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 12,
  },
  fine: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 16,
  },
});
