import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { StoreSummary } from '../lib/api';
import type { MergedPlace } from '../lib/nearby';
import { colors, fonts, formatPoints } from '../lib/theme';

interface PlaceSheetProps {
  visible: boolean;
  place: MergedPlace | null;
  summary: StoreSummary | undefined;
  onClose: () => void;
  onOpenStore?: (store: StoreSummary) => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function PlaceSheet({ visible, place, summary, onClose, onOpenStore }: PlaceSheetProps) {
  if (place === null) return null;

  const website = place.website;
  const phone = place.phone;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close details" />
        <View style={styles.sheet}>
          <View style={styles.handle} aria-hidden />

          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{place.name}</Text>
              <Text style={styles.sub}>
                {[place.category, place.distanceKm != null ? `${place.distanceKm} km` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>

          {place.registered && summary !== undefined ? (
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatPoints(summary.balance)}</Text>
                <Text style={styles.statLabel}>points</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{place.visitCount}</Text>
                <Text style={styles.statLabel}>visits</Text>
              </View>
            </View>
          ) : (
            <View style={styles.notice}>
              <Feather name="info" size={15} color={colors.muted} />
              <Text style={styles.noticeText}>
                Not on OmaPointii yet. Ask this business to join so you can earn points here.
              </Text>
            </View>
          )}

          {place.registered && summary !== undefined && onOpenStore !== undefined && (
            <Pressable
              style={styles.history}
              onPress={() => {
                onClose();
                onOpenStore(summary);
              }}
            >
              <Text style={styles.historyText}>View points history</Text>
              <Feather name="chevron-right" size={16} color={colors.text} />
            </Pressable>
          )}

          <View style={styles.details}>
            {place.address !== null && <DetailRow label="Address" value={place.address} />}
            {place.openingHours !== null && (
              <DetailRow label="Open" value={place.openingHours} />
            )}
            {website !== null && (
              <Pressable onPress={() => void Linking.openURL(website)}>
                <DetailRow label="Website" value={website} />
              </Pressable>
            )}
            {phone !== null && (
              <Pressable onPress={() => void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`)}>
                <DetailRow label="Phone" value={phone} />
              </Pressable>
            )}
          </View>

          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,19,26,0.55)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 34,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.lineStrong,
    alignSelf: 'center',
    marginBottom: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontFamily: fonts.bodyExtra,
    fontSize: 24,
    letterSpacing: -0.6,
    color: colors.text,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.bodyExtra,
    fontSize: 24,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  history: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  historyText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.text,
  },
  details: { gap: 2, marginBottom: 18 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 18,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  detailLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.muted,
  },
  detailValue: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    textAlign: 'right',
  },
  done: {
    backgroundColor: colors.text,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneText: {
    fontFamily: fonts.bodyExtra,
    fontSize: 14,
    color: colors.card,
  },
});
