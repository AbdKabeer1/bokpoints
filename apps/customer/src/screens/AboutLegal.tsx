import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { APP_NAME, APP_VERSION } from '../lib/version';
import { colors, fonts, layout } from '../lib/theme';

interface AboutLegalProps {
  onBack: () => void;
}

const FAQ = [
  {
    q: 'When do my points expire?',
    a: 'Each batch expires three months after you earn it. The store page shows the date for every batch, and the oldest points are used first.',
  },
  {
    q: 'Why will a reward not go through?',
    a: 'Check that you have enough points, that the reward is still active, and that you have not already used it today. The till shows the exact reason if it refuses.',
  },
  {
    q: 'My code does not scan',
    a: 'Turn the screen brightness up and hold the code still. If the till still cannot read it, ask the cashier to search for your email instead.',
  },
  {
    q: 'How do I leave OmaPointii?',
    a: 'Settings → Delete my account. We remove your name, email, code and store consents, but each store keeps its points totals.',
  },
];

export function AboutLegal({ onBack }: AboutLegalProps) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
        <Feather name="arrow-left" size={16} color={colors.primary} />
        <Text style={styles.back}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Help & legal</Text>
      <Text style={styles.sub}>
        {APP_NAME} {APP_VERSION} · pilot build
      </Text>

      <Text style={styles.section}>FAQ</Text>
      <View style={styles.card}>
        {FAQ.map((item, index) => (
          <View key={item.q} style={[styles.row, index < FAQ.length - 1 && styles.rowLine]}>
            <Text style={styles.q}>{item.q}</Text>
            <Text style={styles.a}>{item.a}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Terms of use</Text>
      <View style={styles.card}>
        <Text style={styles.a}>
          OmaPointii is a loyalty service operated for participating stores. Points have no cash
          value, are held per store, and expire three months after they are earned. A store may
          change its rewards and earning rules for future purchases. You need a working email
          address and must keep your sign-in code private. We may suspend an account used for
          fraud or abuse. These pilot terms are governed by Finnish law.
        </Text>
      </View>

      <Text style={styles.section}>Privacy notice</Text>
      <View style={styles.card}>
        <Text style={styles.a}>
          We process your email address, name, language, points ledger, store memberships and
          notification preferences to run the loyalty service. Stores see the points you earn and
          redeem at their store, not your other stores. We keep the ledger while your account is
          active and keep anonymised totals after deletion. You can download your data or delete
          your account in Settings. Contact privacy@omapointii.store for access, correction or
          erasure requests, or to complain to the Finnish data protection authority.
        </Text>
      </View>

      <Text style={styles.section}>Licences</Text>
      <View style={styles.card}>
        <Text style={styles.a}>
          OmaPointii is built with open-source software, including React, React Native, Expo,
          Fastify, Drizzle ORM, PostgreSQL, Zod and Sentry. Their licence texts are available from
          each project. OmaPointii's own source is private during the pilot.
        </Text>
      </View>

      <Text style={styles.fine}>
        This page is a pilot summary, not legal advice. The full notice and terms are provided to
        each pilot store before launch.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: layout.screen, paddingTop: 58, paddingBottom: 44 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
    alignSelf: 'flex-start',
  },
  back: { fontFamily: fonts.bodyBold, color: colors.primary, fontSize: 13 },
  title: { fontFamily: fonts.display, fontSize: 34, color: colors.text, marginTop: 4 },
  sub: { fontFamily: fonts.body, color: colors.muted, fontSize: 12, marginTop: 3, marginBottom: 18 },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 22,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  row: { paddingVertical: 10 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  q: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.text },
  a: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, color: colors.muted, marginTop: 4 },
  fine: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 24,
  },
});
