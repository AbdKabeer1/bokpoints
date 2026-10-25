import type { ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, formatPoints, layout } from '../lib/theme';

/**
 * Shared pieces for the customer screens: paper cards, pills, the segmented
 * progress bar, store avatars. Fraunces speaks for numbers and headlines;
 * Manrope does the reading.
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
  amber: { bg: colors.saffronSoft, fg: colors.saffronInk, dot: colors.saffron },
  grey: { bg: colors.sageSoft, fg: colors.muted, dot: colors.sage },
  info: { bg: colors.infoSoft, fg: colors.info, dot: colors.info },
  danger: { bg: colors.terracottaSoft, fg: colors.terracottaInk, dot: colors.terracotta },
};

/** A dot plus a word, never colour alone (brief §2). */
export function Pill({
  label,
  tone = 'amber',
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
 * Segmented progress, borrowed from the dashboards but warmed up: saffron
 * for points, forest when the thing is done.
 */
export function SegmentBar({
  value,
  total,
  segments = 10,
  label,
  tone = 'saffron',
}: {
  value: number;
  total: number;
  segments?: number;
  label?: string;
  tone?: 'saffron' | 'forest';
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
                backgroundColor: tone === 'forest' ? colors.green : colors.saffron,
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

const parseHex = (hex: string): [number, number, number] | null => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** A colour mixed with a base: keeps a store's identity inside our palette. */
const mix = (hex: string, base: string, baseShare: number): string => {
  const a = parseHex(hex);
  const b = parseHex(base);
  if (a === null || b === null) return base;
  const channel = (index: 0 | 1 | 2) =>
    Math.round((b[index] ?? 0) * baseShare + (a[index] ?? 0) * (1 - baseShare));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

/** A pale wash of the store's colour for a large surface. */
export const storeTint = (color?: string | null, strength = 0.22): string =>
  color === null || color === undefined ? colors.tint : mix(color, colors.background, 1 - strength);

/**
 * The store's colour, deepened and desaturated so a raw brand colour (a pure
 * blue, a neon green) still belongs on warm paper. Saturation is capped and
 * lightness fixed, which is what makes arbitrary colours sit together.
 */
export const storeDeep = (color?: string | null): string => {
  if (color === null || color === undefined) return colors.espresso;
  const rgb = parseHex(color);
  if (rgb === null) return colors.espresso;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  let hue = 0;
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    if (max === r / 255) hue = ((g - b) / 255 / delta) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / delta + 2;
    else hue = (r - g) / 255 / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = Math.min(0.42, delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)));
  const targetLightness = 0.34;
  const c = (1 - Math.abs(2 * targetLightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = targetLightness - c / 2;
  const [r1, g1, b1] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (value: number) => Math.round((value + m) * 255);
  return `rgb(${to(r1)}, ${to(g1)}, ${to(b1)})`;
};

/** A store's identity: initials on its own colour, or espresso. */
export function StoreAvatar({
  name,
  color,
  size = 42,
  logoUrl,
}: {
  name: string;
  color?: string | null;
  size?: number;
  logoUrl?: string | null;
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
          borderRadius: Math.round(size * 0.32),
          backgroundColor: storeDeep(color),
        },
      ]}
    >
      {logoUrl !== null && logoUrl !== undefined ? (
        <Image
          source={{ uri: logoUrl }}
          style={{ width: size, height: size }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.34) }]}>{initials}</Text>
      )}
    </View>
  );
}

export function Balance({ value, size = 30 }: { value: number; size?: number }) {
  return <Text style={[styles.balance, { fontSize: size }]}>{formatPoints(value)}</Text>;
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
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 23,
    color: colors.text,
  },
  sectionSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
  },
  sectionAction: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.terracottaInk,
    paddingBottom: 3,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  pillText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.1,
  },
  segments: {
    flexDirection: 'row',
    gap: 3,
    height: 9,
  },
  segment: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: '#E9E0CE',
  },
  segmentCaption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  segmentText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10.5,
    color: colors.muted,
    flex: 1,
  },
  segmentPercent: {
    fontFamily: fonts.bodySemi,
    fontSize: 10.5,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFCF6',
    fontFamily: fonts.bodyExtra,
  },
  balance: {
    fontFamily: fonts.display,
    color: colors.text,
  },
});
