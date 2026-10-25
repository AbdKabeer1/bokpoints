import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts } from '../lib/theme';

interface QrSheetProps {
  visible: boolean;
  onClose: () => void;
  identifier: string;
  name: string;
  totalPoints: number;
  storeCount: number;
}

/**
 * The code lives in a sheet, not on the page. Tapping "My QR" slides it up
 * over the app, the way a chat attachment sheet does; closing it returns to
 * whatever the customer was reading.
 */
export function QrSheet({
  visible,
  onClose,
  identifier,
  name,
  totalPoints,
  storeCount,
}: QrSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the code" />
        <View style={styles.sheet}>
          <View style={styles.handle} aria-hidden />

          <View style={styles.head}>
            <View>
              <Text style={styles.title}>Your code</Text>
              <Text style={styles.sub}>{name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>

          <View style={styles.qrCard}>
            <QRCode
              value={identifier}
              size={224}
              backgroundColor="#FFFFFF"
              color="#11131A"
            />
          </View>

          <Text style={styles.points}>
            {totalPoints.toLocaleString('fi-FI')} points · {storeCount} store
            {storeCount === 1 ? '' : 's'}
          </Text>
          <Text style={styles.hint}>
            Turn your brightness up. The cashier scans this once; your points stay with each
            store.
          </Text>

          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
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
    marginBottom: 18,
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
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    alignSelf: 'center',
  },
  points: {
    fontFamily: fonts.bodyExtra,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    marginTop: 18,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
  },
  done: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 16,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.onPrimary,
  },
});
