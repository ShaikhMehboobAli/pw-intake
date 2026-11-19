import { useNetInfo } from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { outbox, startOutbox } from './src/outbox';
import { useOutboxItems } from './src/outbox/useOutbox';
import { IntakeScreen } from './src/screens/IntakeScreen';
import { OutboxScreen } from './src/screens/OutboxScreen';

type Tab = 'intake' | 'outbox';

export default function App() {
  const [tab, setTab] = useState<Tab>('intake');
  const items = useOutboxItems(outbox);
  const net = useNetInfo();
  const waiting = items.filter((i) => i.status === 'pending' || i.status === 'sending').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const offline = net.isConnected === false || net.isInternetReachable === false;

  useEffect(() => startOutbox(), []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {offline && (
          <Text style={styles.banner}>
            No connection. You can keep submitting — everything is saved on this phone and sends when you're back online.
          </Text>
        )}
        <View style={{ flex: 1 }}>
          {tab === 'intake' ? <IntakeScreen outbox={outbox} /> : <OutboxScreen outbox={outbox} />}
        </View>
        <View style={styles.tabs}>
          <TabButton label="New machine" active={tab === 'intake'} onPress={() => setTab('intake')} />
          <TabButton
            label={`Outbox${waiting ? ` (${waiting} waiting)` : ''}${failed ? ` · ${failed} failed` : ''}`}
            active={tab === 'outbox'}
            onPress={() => setTab('outbox')}
          />
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f8' },
  banner: { backgroundColor: '#fff4ce', color: '#5c4400', padding: 10, fontSize: 13 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  tab: { flex: 1, padding: 14, alignItems: 'center' },
  tabActive: { borderTopWidth: 2, borderColor: '#5b2d90' },
  tabText: { color: '#555' },
  tabTextActive: { color: '#5b2d90', fontWeight: '700' },
});
