import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../lib/theme';

/**
 * The first thing anyone sees: the wordmark arrives, the tagline settles, and
 * a green line fills before the app fades to the sign-in page. Short on
 * purpose (under two seconds) and skipped when the device asks for reduced
 * motion.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const mark = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
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
        mark.setValue(1);
        word.setValue(1);
        bar.setValue(1);
        const timer = setTimeout(finish, 900);
        return () => clearTimeout(timer);
      }

      const sequence = Animated.sequence([
        Animated.timing(mark, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: native,
        }),
        Animated.timing(word, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.quad),
          useNativeDriver: native,
        }),
        Animated.timing(bar, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: native,
        }),
        // A beat to read the tagline before it leaves.
        Animated.delay(260),
        Animated.timing(fade, {
          toValue: 0,
          duration: 240,
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
  }, [bar, fade, mark, onDone, word]);

  return (
    <Animated.View style={[styles.screen, { opacity: fade }]}>
      <Animated.View
        style={[
          styles.mark,
          {
            opacity: mark,
            transform: [
              { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
            ],
          },
        ]}
      >
        <Text style={styles.markText}>B</Text>
      </Animated.View>

      <Animated.View
        style={{
          opacity: word,
          transform: [
            { translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
          ],
        }}
      >
        <Text style={styles.wordmark}>BOKPOINTS</Text>
        <Text style={styles.tagline}>Every visit counts.</Text>
      </Animated.View>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              transform: [
                { scaleX: bar.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
              ],
            },
          ]}
        />
      </View>
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
  mark: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  markText: {
    color: colors.onGreen,
    fontSize: 38,
    fontWeight: '800',
  },
  wordmark: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
  },
  tagline: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: 0.2,
  },
  track: {
    marginTop: 34,
    width: 96,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.greenSoft,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    backgroundColor: colors.green,
    transformOrigin: 'left',
  },
});
