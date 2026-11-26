import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useV3Theme } from '../theme/v3';

export type CompactMetric = { key: string; label: string; value: string | number; unit?: string; onPress?: () => void };

export function CompactMetricGrid({ metrics, plain = false }: { metrics: CompactMetric[]; plain?: boolean }) {
  const theme = useV3Theme();
  if (!metrics.length) return null;

  return <View style={styles.grid}>
    {metrics.map(metric => <View key={metric.key} style={styles.cell}>
      <Pressable disabled={!metric.onPress} onPress={metric.onPress}
        accessibilityRole={metric.onPress ? 'button' : undefined}
        style={[styles.tile, !plain && { backgroundColor: theme.cardNested }]}>
        <Text style={[styles.label, { color: theme.mutedText }]}>{metric.label}{metric.onPress ? ' ⓘ' : ''}</Text>
        <Text style={[styles.value, { color: theme.text }]}>
          {metric.value}{metric.unit ? <Text style={[styles.unit, { color: theme.mutedText }]}> {metric.unit}</Text> : null}
        </Text>
      </Pressable>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  cell: { width: '50%', padding: 3 },
  tile: { flex: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  label: { fontSize: 11 },
  value: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, fontWeight: '500' },
});
