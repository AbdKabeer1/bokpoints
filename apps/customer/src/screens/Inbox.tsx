import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { markNotificationRead, type Notification } from '../lib/api';
import { formatDate } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import { Card, StoreAvatar } from '../components/ui';

interface InboxProps {
  token: string;
  notifications: Notification[];
  enabled: boolean;
  onChanged: () => Promise<void>;
}

const relative = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
};

/** Offers are the messages stores send inside OmaPointii — never email or SMS. */
export function Inbox({ token, notifications, enabled, onChanged }: InboxProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const unread = notifications.filter((message) => message.readAt === null).length;

  const open = async (message: Notification) => {
    if (message.readAt !== null || busy !== null) return;
    setBusy(message.id);
    try {
      await markNotificationRead(token, message.id);
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.sub}>
          {!enabled
            ? 'Notifications are off'
            : notifications.length === 0
              ? 'Messages from your stores'
              : unread === 0
                ? 'All caught up'
                : `${unread} unread message${unread === 1 ? '' : 's'}`}
        </Text>
      </View>

      {!enabled ? (
        <Card>
          <Text style={styles.emptyTitle}>Notifications are off</Text>
          <Text style={styles.emptyBody}>
            Turn them back on under You → Settings → In-app notifications. Store messages are
            kept while they are off.
          </Text>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>
            When a store sends you a message, it lands here inside OmaPointii.
          </Text>
        </Card>
      ) : (
        notifications.map((message) => {
          const unreadMessage = message.readAt === null;
          return (
            <Pressable
              key={message.id}
              onPress={() => void open(message)}
              style={[styles.offer, unreadMessage && styles.unread]}
              accessibilityLabel={`${message.title}, from ${message.storeName}`}
            >
              <View style={styles.top}>
                <StoreAvatar
                  name={message.storeName}
                  color={message.storeBrandColor}
                  logoUrl={message.storeLogoUrl}
                  size={40}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.store}>{message.storeName}</Text>
                  <Text style={styles.offerTitle}>{message.title}</Text>
                </View>
                {unreadMessage && <View style={styles.dot} />}
              </View>
              <Text style={styles.body}>{message.body}</Text>
              <Text style={styles.time}>{relative(message.createdAt)}</Text>
            </Pressable>
          );
        })
      )}

      <Text style={styles.fine}>
        Messages are in-app only, not email or texts. You choose which stores may send them
        under You → Store news.
      </Text>
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
  offer: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
  },
  unread: {
    borderColor: colors.primarySoft,
    backgroundColor: '#FBFAFF',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  store: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  offerTitle: {
    fontFamily: fonts.bodyExtra,
    fontSize: 14.5,
    color: colors.text,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
    marginTop: 10,
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: 8,
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
