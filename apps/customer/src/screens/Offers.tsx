import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { getOffers, type StoreOffer, type StoreSummary } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { Card, Pill, StoreAvatar } from '../components/ui';

interface OffersProps {
  token: string;
  stores: StoreSummary[];
  onOpenStore: (store: StoreSummary) => void;
}

const money = (cents: number): string => `€${(cents / 100).toFixed(2).replace('.', ',')}`;

const offerLine = (offer: StoreOffer): string =>
  offer.kind === 'fixed_cents'
    ? `${money(offer.value)} off when you spend ${money(offer.thresholdCents)}`
    : `${(offer.value / 1000).toLocaleString('fi-FI')}% off when you spend ${money(offer.thresholdCents)}`;

/**
 * Store offers: the basket discounts each joined store is running. Coupons
 * (what points buy) live in their own tab; messages live in Inbox.
 */
export function Offers({ token, stores, onOpenStore }: OffersProps) {
  const [offers, setOffers] = useState<StoreOffer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getOffers(token);
        if (!cancelled) setOffers(result.offers);
      } catch {
        if (!cancelled) setOffers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const byId = new Map(stores.map((store) => [store.storeId, store]));

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Offers</Text>
        <Text style={styles.sub}>What your stores are running now</Text>
      </View>

      {offers === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : offers.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No offers right now</Text>
          <Text style={styles.emptyBody}>
            When a store you visit starts a basket offer, it appears here. Your coupons are
            under Coupons.
          </Text>
        </Card>
      ) : (
        offers.map((offer) => {
          const summary = byId.get(offer.storeId);
          return (
            <Pressable
              key={offer.storeId}
              style={styles.card}
              disabled={summary === undefined}
              onPress={() => {
                if (summary !== undefined) onOpenStore(summary);
              }}
              accessibilityLabel={`${offer.storeName}: ${offerLine(offer)}`}
            >
              <StoreAvatar
                name={offer.storeName}
                color={offer.brandColor}
                logoUrl={offer.logoUrl}
                size={44}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.store}>{offer.storeName}</Text>
                <Text style={styles.offer}>{offerLine(offer)}</Text>
                <Text style={styles.meta}>Show your code at the till</Text>
              </View>
              <Pill label="Active" tone="green" />
            </Pressable>
          );
        })
      )}

      <Text style={styles.fine}>
        Offers are funded by the store and applied when the cashier scans your code. They are
        separate from the points you earn.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: 18 },
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
  card: {
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
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  offer: {
    fontFamily: fonts.bodyExtra,
    fontSize: 14.5,
    color: colors.text,
    marginTop: 3,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
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
  fine: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 16,
  },
});
