import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, formatPoints, layout } from '../lib/theme';

/**
 * The handful of pieces the customer screens share: a card, a status pill,
 * a segmented progress bar, a store avatar and a section title. Keeping them
 * here stops the screens drifting apart as they change.
 */

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle !== undefined && <Text style={styles.sectionSub}>{subtitle}</Text>}
      </View>
      {action !== undefined && onAction !== undefined && (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

type Tone = 'green' | 'amber' | 'grey' | 'info' | 'danger';

const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  green: { bg: colors.greenSoft, fg: colors.greenDark, dot: colors.green },
  amber: { bg: colors.amberSoft, fg: colors.amberInk, dot: colors.amber },
  grey: { bg: '#eff2f0', fg: colors.muted, dot: colors.muted },
  info: { bg: colors.infoSoft, fg: colors.info, dot: colors.info },
  danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
};

/** A dot plus a word, never colour alone (brief §2). */
export function Pill({
  label,
  tone = 'green',
  dot = true,
}: {
  label: string;
  tone?: Tone;
  dot?: boolean;
}) {
  const palette = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {dot && <View style={[styles.pillDot, { backgroundColor: palette.dot }]} />}
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/**
 * Segmented progress, borrowed from the dashboards. `total` is the reward's
 * cost; the last segment fills only when the reward is actually reached.
 */
export function SegmentBar({
  value,
  total,
  segments = 10,
  label,
  tone = 'green',
}: {
  value: number;
  total: number;
  segments?: number;
  label?: string;
  tone?: 'green' | 'amber';
}) {
  const ratio = total <= 0 ? 1 : Math.min(1, Math.max(0, value / total));
  const filled = Math.round(ratio * segments);
  const percent = Math.round(ratio * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: Math.min(value, total) }}
    >
      <View style={styles.segments}>
        {Array.from({ length: segments }, (_, index) => (
          <View
            key={index}
            style={[
              styles.segment,
              index < filled && {
                backgroundColor: tone === 'amber' ? colors.amber : colors.green,
              },
            ]}
          />
        ))}
      </View>
      {label !== undefined && (
        <View style={styles.segmentCaption}>
          <Text style={styles.segmentText}>{label}</Text>
          <Text style={styles.segmentPercent}>{percent}%</Text>
        </View>
      )}
    </View>
  );
}

/** A store's identity: initials on its own colour, or Poket green. */
export function StoreAvatar({
  name,
  color,
  size = 42,
}: {
  name: string;
  color?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          backgroundColor: color ?? colors.greenDark,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.36) }]}>{initials}</Text>
    </View>
  );
}

export function Balance({
  value,
  size = 28,
}: {
  value: number;
  size?: number;
}) {
  return (
    <Text style={[styles.balance, { fontSize: size }]}>{formatPoints(value)}</Text>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  sectionAction: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
    paddingBottom: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  segments: {
    flexDirection: 'row',
    gap: 3,
    height: 8,
  },
  segment: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.line,
  },
  segmentCaption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  segmentText: {
    fontSize: 10,
    color: colors.muted,
    flex: 1,
  },
  segmentPercent: {
    fontSize: 10,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  balance: {
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
});
