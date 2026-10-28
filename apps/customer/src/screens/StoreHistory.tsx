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
import Feather from '@expo/vector-icons/Feather';
import {
  getDiscountProof,
  getHistory,
  getStoreRewards,
  getStoreRules,
  setStoreConsent,
  type DiscountProof,
  type History,
  type StoreRule,
  type StoreReward,
  type StoreSummary,
} from '../lib/api';
import { formatDate, typeLabel } from '../lib/format';
import { colors, fonts, formatPoints, layout } from '../lib/theme';
import { Card, Pill, storeTint } from '../components/ui';

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
  clawback: 'danger',
};

/**
 * One store, as the customer sees it: painted in the store's own colour, the
 * balance in the display face, rewards within reach, the rotating discount
 * code, store-news consent, and every entry with the balance after it.
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
  const [rules, setRules] = useState<StoreRule[] | null>(null);

  /** Turns an earning rule into plain language the customer can read. */
  function ruleText(rule: StoreRule): string {
    const def = rule.definition as { type: string; pointsPerEuroThousandths?: number; points?: number; everyN?: number; rounding?: string; minSpendCents?: number };
    const type = def.type;
    switch (type) {
      case 'per_euro': {
        const rate = (def.pointsPerEuroThousandths ?? 1000) / 1000;
        const min = def.minSpendCents ?? 0;
        return `€${min > 0 ? min / 100 : ''} per €${rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(1)}${min > 0 ? ` spent (min €${min / 100})` : ''}`;
      }
      case 'fixed_per_purchase': {
        const min = def.minSpendCents ?? 0;
        return `${def.points} points per purchase${min > 0 ? ` (min €${min / 100})` : ''}`;
      }
      case 'threshold_bonus': {
        const min = def.minSpendCents ?? 0;
        return `+${def.points} bonus pts on purchases of €${min / 100} or more`;
      }
      case 'every_nth_visit': {
        return `+${def.points} pts on every ${def.everyN}ᵗʰ visit`;
      }
      default:
        return `${def.points ?? 0} pts`;
    }
  }

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
    void (async () => {
      try {
        const loaded = await getStoreRules(token, store.storeId);
        if (!cancelled) setRules(loaded.rules);
      } catch {
        if (!cancelled) setRules([]);
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
      <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
        <Feather name="arrow-left" size={16} color={colors.terracottaInk} />
        <Text style={styles.back}>Your stores</Text>
      </Pressable>

      <View style={[styles.hero, { backgroundColor: storeTint(store.brandColor) }]}>
        <Text style={styles.heroName}>{store.name}</Text>
        <Text style={styles.heroBalance}>{formatPoints(balance)}</Text>
        <Text style={styles.heroPoints}>points to spend here</Text>

        {store.nextReward !== null && (
          <View style={styles.heroProgress}>
            <View style={styles.heroSegments}>
              {Array.from({ length: 10 }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.heroSegment,
                    index <
                      Math.round(
                        Math.min(1, balance / store.nextReward!.pointsCost) * 10,
                      ) && styles.heroSegmentOn,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.heroCaption}>
              {balance} of {store.nextReward.pointsCost} · {store.nextReward.name}
            </Text>
          </View>
        )}
      </View>

      {rewards !== null && rewards.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 14 }}>
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

      {rules !== null && rules.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <Text style={styles.cardLabel}>How you earn here</Text>
          {rules.map((rule) => (
            <View key={rule.ruleId} style={styles.rewardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rewardName}>{ruleText(rule)}</Text>
                <Text style={styles.rewardCost}>
                  Version {rule.version} · Active
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <View style={styles.consentRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentName}>News from {store.name}</Text>
            <Text style={styles.consentBody}>
              {consent
                ? 'On. Messages arrive in your OmaPointii inbox.'
                : 'Off. This store cannot message you in OmaPointii.'}
            </Text>
          </View>
          <Switch
            value={consent}
            onValueChange={(next) => void toggleConsent(next)}
            disabled={consentBusy}
            trackColor={{ false: colors.lineStrong, true: colors.green }}
            thumbColor="#FFFCF6"
          />
        </View>
      </Card>

      {proof !== null && proof.active && (
        <View style={styles.proofCard}>
          <Text style={styles.proofEyebrow}>ONE-TIME CODE</Text>
          <Text style={styles.proofTitle}>A discount at the till</Text>
          <View style={styles.proofQr}>
            <QRCode
              value={proof.proof}
              size={148}
              color="#1A1712"
              backgroundColor="#FFFCF6"
            />
          </View>
          <Text style={styles.proofHint}>
            Works once, for {secondsLeft > 0 ? `${secondsLeft} s` : 'a moment'} longer
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
        <ActivityIndicator color={colors.saffron} style={styles.spinner} />
      ) : history !== null && history.entries.length === 0 ? (
        <Text style={styles.empty}>No entries yet.</Text>
      ) : (
        history?.entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rowText}>
              <Pill label={typeLabel(entry.type)} tone={TONES[entry.type] ?? 'grey'} />
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
    paddingTop: 58,
    paddingBottom: 44,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  back: {
    fontFamily: fonts.bodyBold,
    color: colors.terracottaInk,
    fontSize: 13,
  },
  hero: {
    borderRadius: 26,
    padding: 20,
    marginBottom: 14,
  },
  heroName: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.text,
  },
  heroBalance: {
    fontFamily: fonts.display,
    fontSize: 54,
    lineHeight: 60,
    color: colors.text,
    marginTop: 10,
  },
  heroPoints: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: -2,
  },
  heroProgress: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(26,23,18,0.12)',
    paddingTop: 12,
  },
  heroSegments: {
    flexDirection: 'row',
    gap: 3,
    height: 8,
  },
  heroSegment: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: 'rgba(26,23,18,0.12)',
  },
  heroSegmentOn: {
    backgroundColor: colors.espresso,
  },
  heroCaption: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 8,
  },
  cardLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
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
    paddingVertical: 13,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rewardName: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
  },
  rewardCost: {
    fontFamily: fonts.body,
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
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
  consentBody: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  proofCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    padding: 20,
    marginBottom: 14,
  },
  proofEyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: colors.saffronInk,
  },
  proofTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
    marginTop: 4,
    marginBottom: 12,
  },
  proofQr: {
    padding: 10,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  proofHint: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  proofRefresh: {
    fontFamily: fonts.bodyBold,
    color: colors.terracottaInk,
    fontSize: 12,
    marginTop: 9,
  },
  proofError: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 12,
    marginBottom: 14,
  },
  empty: {
    fontFamily: fonts.body,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
    gap: 5,
  },
  date: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 11,
  },
  rowNumbers: {
    alignItems: 'flex-end',
  },
  points: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  positive: {
    color: colors.greenDark,
  },
  negative: {
    color: colors.terracottaInk,
  },
  after: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  error: {
    fontFamily: fonts.bodySemi,
    color: colors.danger,
    fontSize: 12,
    marginBottom: 12,
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 18,
  },
});
