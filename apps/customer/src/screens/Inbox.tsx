import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { markNotificationRead, type Notification } from '../lib/api';
import { formatDate } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import { Card, StoreAvatar } from '../components/ui';

interface InboxProps {
  token: string;
  notifications: Notification[];
  onRefresh: () => Promise<void>;
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

/**
 * Messages a store sent inside Poket (D-148). Opening one marks it read;
 * the dot and the tab badge go away, and the store sees the open count.
 */
export function Inbox({ token, notifications, onRefresh, onChanged }: InboxProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const openMessage = async (message: Notification) => {
    setOpen((current) => (current === message.id ? null : message.id));
    if (message.readAt !== null || busy !== null) return;
    setBusy(message.id);
    try {
      await markNotificationRead(token, message.id);
      await onChanged();
      setError(null);
    } catch {
      setError('We could not mark that as read. Check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const unread = notifications.filter((message) => message.readAt === null).length;

  return (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>FROM YOUR STORES</Text>
          <Text style={styles.title}>Inbox</Text>
        </View>
        <Pressable
          onPress={() => void onRefresh()}
          hitSlop={10}
          accessibilityLabel="Refresh the inbox"
          style={styles.refresh}
        >
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <Text style={styles.sub}>
        {notifications.length === 0
          ? 'Messages from your stores land here.'
          : unread === 0
            ? 'All caught up.'
            : `${unread} unread message${unread === 1 ? '' : 's'}.`}
      </Text>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {notifications.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>
            When a store you visit sends news or an offer, it appears here — inside Poket, not
            by email or text.
          </Text>
        </Card>
      ) : (
        notifications.map((message) => {
          const expanded = open === message.id;
          return (
            <Pressable
              key={message.id}
              onPress={() => void openMessage(message)}
              style={[styles.item, message.readAt === null && styles.itemUnread]}
              accessibilityLabel={`${message.title}, from ${message.storeName}`}
            >
              <View style={styles.itemTop}>
                <StoreAvatar
                  name={message.storeName}
                  color={message.storeBrandColor}
                  size={38}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.itemMeta}>
                    <Text style={styles.store}>{message.storeName}</Text>
                    <Text style={styles.time}>{relative(message.createdAt)}</Text>
                  </View>
                  <Text style={styles.itemTitle}>{message.title}</Text>
                </View>
                {message.readAt === null && <View style={styles.dot} />}
              </View>
              <Text style={styles.body} numberOfLines={expanded ? undefined : 2}>
                {message.body}
              </Text>
              {expanded && (
                <Text style={styles.sent}>
                  Sent {formatDate(message.createdAt)} ·{' '}
                  {message.readAt === null ? 'marking read…' : 'read'}
                </Text>
              )}
            </Pressable>
          );
        })
      )}

      <Text style={styles.fine}>
        Store news is on only for the stores you chose. Change that under You → Store news.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.text,
    marginTop: 4,
  },
  refresh: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  refreshText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.terracottaInk,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginBottom: 16,
  },
  error: {
    fontFamily: fonts.bodySemi,
    color: colors.danger,
    fontSize: 12,
    marginBottom: 10,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 5,
  },
  item: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
  },
  itemUnread: {
    borderColor: '#EBCBBE',
    backgroundColor: '#FFFAF4',
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  store: {
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
  },
  itemTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
    marginTop: 3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.terracotta,
    marginTop: 5,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
    marginTop: 9,
  },
  sent: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.muted,
    marginTop: 8,
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginTop: 18,
  },
});
