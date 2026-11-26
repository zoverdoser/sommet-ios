import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './ui/Icon';

const landscape = require('../assets/alpine-dusk.jpg');

export function WatchHeader({ title, status, connected, battery, sync }: {
  title: string;
  status?: string;
  connected?: boolean;
  battery?: number;
  sync?: {
    label: string;
    progress?: string;
    busy: boolean;
    disabled: boolean;
    onPress: () => void;
    onLongPress: () => void;
  };
}) {
  return (
    <View style={styles.cover}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
        <Image source={landscape} accessible={false} style={styles.image} resizeMode="cover" />
      </View>
      <View style={styles.scrim} />
      <View style={styles.context}>
        {sync ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sync.progress ? `${sync.label}, ${sync.progress}` : sync.label}
            accessibilityState={{ busy: sync.busy, disabled: sync.disabled }}
            disabled={sync.disabled}
            onPress={sync.onPress}
            onLongPress={sync.onLongPress}
            style={({ pressed }) => [styles.syncControl, pressed && { opacity: 0.65 }]}
          >
            <View style={styles.watch}>
              {sync.busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="watch" size={24} color="#FFFFFF" />}
            </View>
            <View style={styles.syncText}>
              <Text style={styles.syncLabel}>{sync.label}</Text>
              {sync.progress && <Text style={styles.syncProgress}>{sync.progress}</Text>}
            </View>
          </Pressable>
        ) : (
          <View style={styles.watch}><Icon name="watch" size={24} color="#FFFFFF" /></View>
        )}
        {battery !== undefined && battery >= 0 && (
          <View style={styles.battery}>
            <Icon name="battery" size={17} color="#FFFFFF" />
            <Text style={styles.batteryValue}>{battery}%</Text>
          </View>
        )}
      </View>
      <View>
        {!!status && (
          <View style={styles.statusRow}>
            <View style={[styles.dot, connected && styles.connectedDot]} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    minHeight: 192, padding: 20, justifyContent: 'space-between', gap: 20, backgroundColor: '#172233',
  },
  image: { width: '100%', height: '100%' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#10172469' },
  context: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  watch: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#172335B8', alignItems: 'center', justifyContent: 'center' },
  syncControl: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  syncText: { flexShrink: 1, gap: 2 },
  syncLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  syncProgress: { color: '#F0F2FD', fontSize: 11, fontVariant: ['tabular-nums'] },
  battery: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#172335E0' },
  batteryValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FFFFFF' },
  connectedDot: { backgroundColor: '#86F2B4' },
  status: { flexShrink: 1, color: '#F0F2FD', fontSize: 13, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 31, fontWeight: '700', letterSpacing: -0.9 },
});
