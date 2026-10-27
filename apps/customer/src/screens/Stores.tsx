import { useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { DirectoryStore, NearbyPlace, StoreSummary } from '../lib/api';
import { mergePlaces, type MergedPlace } from '../lib/nearby';
import { colors, fonts, formatPoints } from '../lib/theme';
import { Pill, StoreAvatar } from '../components/ui';

interface StoresProps {
  directory: DirectoryStore[] | null;
  nearby: NearbyPlace[];
  attribution: string;
  visited: StoreSummary[];
  onOpenPlace: (place: MergedPlace) => void;
  onEnableLocation: () => void;
  locating: boolean;
  locationError: string | null;
  /** Server-backed name search, beyond the businesses already loaded. */
  query: string;
  onQueryChange: (value: string) => void;
  searchResults: NearbyPlace[] | null;
  searching: boolean;
}

/** Nearby businesses: OmaPointii stores plus OpenStreetMap discovery. */
export function Stores({
  directory,
  nearby,
  attribution,
  visited,
  onOpenPlace,
  onEnableLocation,
  locating,
  locationError,
  query,
  onQueryChange,
  searchResults,
  searching,
}: StoresProps) {
  const [category, setCategory] = useState<string>('all');

  const visitedById = useMemo(
    () => new Map(visited.map((store) => [store.storeId, store])),
    [visited],
  );

  const merged = useMemo(
    () => mergePlaces(directory ?? [], nearby),
    [directory, nearby],
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const place of merged) {
      const value = place.category?.trim();
      if (value) seen.add(value);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [merged]);

  // Once the provider has answered a name search, its rows are already the
  // match; the directory rows still have to be filtered locally.
  const source = useMemo(
    () => (searchResults === null ? merged : mergePlaces(directory ?? [], searchResults)),
    [directory, merged, searchResults],
  );

  const filtered = source.filter((place) => {
    const needle = query.trim().toLowerCase();
    if (category !== 'all' && (place.category ?? '') !== category) return false;
    if (searchResults !== null && !place.registered) return true;
    if (needle === '') return true;
    return (
      place.name.toLowerCase().includes(needle) ||
      (place.address ?? '').toLowerCase().includes(needle) ||
      (place.category ?? '').toLowerCase().includes(needle)
    );
  });

  const renderPlace = (place: MergedPlace) => {
    const summary =
      place.storeId === null ? undefined : visitedById.get(place.storeId);
    const hasDistance = typeof place.distanceKm === 'number';

    return (
      <Pressable
        key={place.id}
        style={styles.row}
        onPress={() => onOpenPlace(place)}
        accessibilityLabel={
          summary === undefined
            ? `Details for ${place.name}`
            : `Open ${place.name}, ${summary.balance} points`
        }
      >
        <StoreAvatar
          name={place.name}
          color={place.brandColor ?? summary?.brandColor ?? null}
          logoUrl={place.logoUrl ?? summary?.logoUrl ?? null}
          size={46}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{place.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[place.category, place.address, hasDistance ? `${place.distanceKm} km` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {!place.registered ? (
          <Pill label="Not on OmaPointii" tone="grey" dot={false} />
        ) : summary === undefined ? (
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

  const hasDistance = merged.some((place) => typeof place.distanceKm === 'number');

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Stores</Text>
        <Text style={styles.sub}>
          {directory === null
            ? 'Loading…'
            : hasDistance
              ? `${merged.length} ${merged.length === 1 ? 'business' : 'businesses'} near you`
              : `${merged.length} ${merged.length === 1 ? 'business' : 'businesses'} on OmaPointii`}
        </Text>
      </View>

      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search any business by name"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {searching && (
        <View style={styles.searching}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.searchingText}>Searching beyond the list…</Text>
        </View>
      )}

      {categories.length > 0 && (
        <View style={styles.chips}>
          <Pressable
            style={[styles.chip, category === 'all' && styles.chipActive]}
            onPress={() => setCategory('all')}
          >
            <Text style={[styles.chipText, category === 'all' && styles.chipTextActive]}>All</Text>
          </Pressable>
          {categories.map((value) => (
            <Pressable
              key={value}
              style={[styles.chip, category === value && styles.chipActive]}
              onPress={() => setCategory(value)}
            >
              <Text style={[styles.chipText, category === value && styles.chipTextActive]}>
                {value}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!hasDistance && (
        <Pressable style={styles.hintButton} onPress={onEnableLocation} disabled={locating}>
          <Feather name="map-pin" size={14} color={colors.text} />
          <Text style={styles.hintButtonText}>
            {locating ? 'Finding your location…' : 'Turn on location to see nearby businesses'}
          </Text>
        </Pressable>
      )}

      {locationError !== null && <Text style={styles.error}>{locationError}</Text>}

      {filtered.length > 0 && (
        <>
          <Text style={styles.section}>
            {searchResults !== null
              ? 'Search results'
              : hasDistance
                ? 'Nearby'
                : 'All businesses'}
          </Text>
          {filtered.map(renderPlace)}
        </>
      )}

      {directory !== null && filtered.length === 0 && (
        <Text style={styles.empty}>
          {query.trim() === ''
            ? 'No businesses near you yet.'
            : `Nothing matches “${query.trim()}”.`}
        </Text>
      )}

      {attribution !== '' && <Text style={styles.attribution}>{attribution}</Text>}

      <Text style={styles.fine}>
        Visit any OmaPointii store and show your code at the till. Points stay with that store,
        and its coupons appear under Coupons. Businesses marked “Not on OmaPointii” are nearby
        places from OpenStreetMap.
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
  hint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 8,
  },
  hintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  hintButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.card,
  },
  attribution: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: 8,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.danger,
    marginTop: -4,
    marginBottom: 10,
  },
  searching: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
    marginBottom: 12,
  },
  searchingText: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
  },
});
