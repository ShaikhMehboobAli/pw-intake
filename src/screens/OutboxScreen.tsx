import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { getCategory, submissionTitle } from '../categories';
import type { Outbox, OutboxStatus } from '../outbox';
import { useOutboxItems } from '../outbox/useOutbox';

const LABEL: Record<OutboxStatus, string> = {
  pending: 'Waiting to send',
  sending: 'Sending…',
  sent: 'Sent',
  failed: 'Needs attention',
};
const COLOR: Record<OutboxStatus, string> = {
  pending: '#b26a00',
  sending: '#1f6feb',
  sent: '#1a7f37',
  failed: '#cf222e',
};

export function OutboxScreen({ outbox }: { outbox: Outbox }) {
  const items = useOutboxItems(outbox);
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    return <Text style={styles.empty}>Nothing submitted yet.</Text>;
  }

  return (
    <FlatList
      data={sorted}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      renderItem={({ item }) => (
        <View style={styles.card} testID={`outbox-item-${item.id}`}>
          <View style={styles.row}>
            <Text style={styles.name}>{submissionTitle(item.category, item.fields)}</Text>
            <Text style={[styles.pill, { backgroundColor: COLOR[item.status] }]}>{LABEL[item.status]}</Text>
          </View>
          <Text style={styles.meta}>
            {getCategory(item.category)?.label ?? item.category} · {item.photos.length} photo(s) · saved {new Date(item.createdAt).toLocaleTimeString()}
          </Text>
          {item.status === 'pending' && item.attempts > 0 && (
            <Text style={styles.meta}>
              Tried {item.attempts}× — {item.lastError}. It's saved on this phone and will keep retrying.
            </Text>
          )}
          {item.status === 'failed' && <Text style={[styles.meta, { color: COLOR.failed }]}>Rejected: {item.lastError}</Text>}
          {item.status === 'sent' && <Text style={styles.meta}>Reference {item.serverId}</Text>}
          {(item.status === 'pending' || item.status === 'failed') && (
            <View style={styles.row}>
              <Pressable onPress={() => outbox.retry(item.id)}>
                <Text style={styles.action}>Retry now</Text>
              </Pressable>
              {item.status === 'failed' && (
                <Pressable
                  onPress={() =>
                    Alert.alert('Discard submission?', 'This deletes it and its photos from this phone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Discard', style: 'destructive', onPress: () => outbox.discard(item.id) },
                    ])
                  }
                >
                  <Text style={[styles.action, { color: COLOR.failed }]}>Discard</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  empty: { padding: 24, color: '#666', textAlign: 'center' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, gap: 4, backgroundColor: '#fff' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  pill: { color: '#fff', fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  meta: { color: '#555', fontSize: 13 },
  action: { color: '#1f6feb', fontWeight: '600', paddingVertical: 6 },
});
