import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../lib/theme';

const NAME = 'Poket'.split('');
const LETTER_STAGGER = 60;

/**
 * The first thing anyone sees: each letter of the name rises into place, the
 * green dot lands, the tagline settles, then the whole thing fades to the
 * sign-in page. Short on purpose (about two seconds) and skipped when the
 * device asks for reduced motion.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const letters = useRef(NAME.map(() => new Animated.Value(0))).current;
  const dot = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    let done = false;
    const native = Platform.OS !== 'web';

    // A safety net: if the platform never reports reduced motion and an
    // animation callback is lost, the app still reaches the sign-in page.
    const finish = () => {
      if (cancelled || done) return;
      done = true;
      onDone();
    };
    const safety = setTimeout(finish, 3500);

    const play = (reduceMotion: boolean) => {
      if (reduceMotion) {
        for (const letter of letters) letter.setValue(1);
        dot.setValue(1);
        tagline.setValue(1);
        const timer = setTimeout(finish, 900);
        return () => clearTimeout(timer);
      }

      const sequence = Animated.sequence([
        Animated.stagger(
          LETTER_STAGGER,
          letters.map((value) =>
            Animated.timing(value, {
              toValue: 1,
              duration: 430,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: native,
            }),
          ),
        ),
        Animated.spring(dot, {
          toValue: 1,
          friction: 4,
          tension: 120,
          useNativeDriver: native,
        }),
        Animated.timing(tagline, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: native,
        }),
        // A beat to read it before the hand-off.
        Animated.delay(520),
        Animated.timing(fade, {
          toValue: 0,
          duration: 260,
          easing: Easing.in(Easing.quad),
          useNativeDriver: native,
        }),
      ]);

      sequence.start(({ finished }) => {
        if (finished) finish();
      });

      return () => sequence.stop();
    };

    let cleanUp: (() => void) | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!cancelled) cleanUp = play(reduceMotion);
      })
      .catch(() => {
        if (!cancelled) cleanUp = play(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(safety);
      cleanUp?.();
    };
  }, [dot, fade, letters, onDone, tagline]);

  return (
    <Animated.View style={[styles.screen, { opacity: fade }]}>
      <View accessibilityRole="header" accessibilityLabel="Poket" style={styles.nameRow}>
        {letters.map((value, index) => (
          <Animated.Text
            key={index}
            style={[
              styles.name,
              {
                opacity: value,
                transform: [
                  {
                    translateY: value.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
                  },
                ],
              },
            ]}
          >
            {NAME[index] ?? ''}
          </Animated.Text>
        ))}
        <Animated.View
          style={[styles.dot, { opacity: dot, transform: [{ scale: dot }] }]}
        />
      </View>

      <Animated.Text
        style={[
          styles.tagline,
          {
            opacity: tagline,
            transform: [
              {
                translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
              },
            ],
          },
        ]}
      >
        Every visit counts.
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  name: {
    color: colors.ink,
    fontSize: 58,
    lineHeight: 64,
    fontWeight: '800',
    letterSpacing: -2.4,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: colors.green,
    marginLeft: 5,
    marginBottom: 13,
  },
  tagline: {
    color: colors.muted,
    fontSize: 14,
    letterSpacing: 0.4,
    marginTop: 16,
  },
});
