import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { getStoreRewards, type StoreReward, type StoreSummary } from '../lib/api';
import { colors, fonts, formatPoints } from '../lib/theme';
import { Card, Pill, StoreAvatar } from '../components/ui';

interface CouponsProps {
  token: string;
  stores: StoreSummary[];
  onOpenStore: (store: StoreSummary) => void;
}

interface Coupon {
  store: StoreSummary;
  reward: StoreReward;
}

/**
 * Store-funded coupons: what the customer's points already buy, and what is
 * close. Platform-issued coupons have no sender yet, so that section says so
 * instead of showing invented offers.
 */
export function Coupons({ token, stores, onOpenStore }: CouponsProps) {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        stores.map(async (store) => {
          try {
            const rewards = await getStoreRewards(token, store.storeId);
            return rewards.rewards.map((reward) => ({ store, reward }));
          } catch {
            return [];
          }
        }),
      );
      if (!cancelled) setCoupons(results.flat());
    })();
    return () => {
      cancelled = true;
    };
  }, [token, stores]);

  const ready = (coupons ?? []).filter((coupon) => coupon.store.balance >= coupon.reward.pointsCost);
  const close = (coupons ?? []).filter(
    (coupon) => coupon.store.balance < coupon.reward.pointsCost,
  );

  const renderCoupon = (coupon: Coupon) => {
    const isReady = coupon.store.balance >= coupon.reward.pointsCost;
    const missing = coupon.reward.pointsCost - coupon.store.balance;
    return (
      <Pressable
        key={`${coupon.store.storeId}-${coupon.reward.rewardId}`}
        style={styles.coupon}
        onPress={() => onOpenStore(coupon.store)}
        accessibilityLabel={`${coupon.reward.name} at ${coupon.store.name}`}
      >
        <StoreAvatar
          name={coupon.store.name}
          color={coupon.store.brandColor}
          logoUrl={coupon.store.logoUrl}
          size={44}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.store}>{coupon.store.name}</Text>
          <Text style={styles.reward}>{coupon.reward.name}</Text>
          <Text style={styles.meta}>
            {formatPoints(coupon.reward.pointsCost)} points
            {isReady ? ' · yours now' : ` · ${formatPoints(missing)} to go`}
          </Text>
        </View>
        {isReady ? (
          <Pill label="Ready" tone="green" />
        ) : (
          <View style={styles.arrow}>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Coupons</Text>
        <Text style={styles.sub}>What your points already buy</Text>
      </View>

      {coupons === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : ready.length === 0 && close.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No coupons yet</Text>
          <Text style={styles.emptyBody}>
            Earn points at a store and its rewards appear here, ready to use at the counter.
          </Text>
        </Card>
      ) : (
        <>
          {ready.length > 0 && (
            <>
              <Text style={styles.section}>Ready to use</Text>
              {ready.map(renderCoupon)}
            </>
          )}
          {close.length > 0 && (
            <>
              <Text style={styles.section}>Almost there</Text>
              {close.map(renderCoupon)}
            </>
          )}
        </>
      )}

      <Text style={styles.section}>From OmaPointii</Text>
      <Card style={styles.platformCard}>
        <View style={styles.platformIcon}>
          <Feather name="gift" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.platformTitle}>No platform coupons yet</Text>
          <Text style={styles.platformBody}>
            Coupons OmaPointii sends directly will appear here, separate from store rewards.
          </Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    marginBottom: 18,
  },
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
  section: {
    fontFamily: fonts.bodyExtra,
    fontSize: 13,
    color: colors.text,
    marginTop: 18,
    marginBottom: 9,
  },
  coupon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 9,
  },
  store: {
    fontFamily: fonts.bodySemi,
    fontSize: 10.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  reward: {
    fontFamily: fonts.bodyExtra,
    fontSize: 15,
    color: colors.text,
    marginTop: 2,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
  },
  arrow: {
    width: 28,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.bodyExtra,
    fontSize: 17,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 5,
  },
  platformCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  platformIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.text,
  },
  platformBody: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 2,
  },
});
