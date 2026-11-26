import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Checkbox } from './ui/primitives';
import { useScrollLock } from './ScrollLock';
import { useV3Theme } from '../theme/v3';
import { t } from '../i18n';
import { MAX_ROUTE_SPACING, MIN_ROUTE_SPACING, ROUTE_SPACING_STEP, routeSpacing } from '../services/RoutePointFilter';

const THUMB = 24;
const RANGE = MAX_ROUTE_SPACING - MIN_ROUTE_SPACING;

export function RouteSpacingControl({
  enabled, onEnabled, meters, onMeters, kept, total, disabled,
}: {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  meters: number;
  onMeters: (meters: number) => void;
  kept: number;
  total: number;
  disabled: boolean;
}) {
  const theme = useV3Theme();
  const lock = useScrollLock();
  const held = useRef(false);
  const [width, setWidth] = useState(0);
  const travel = Math.max(0, width - THUMB);
  const offset = ((meters - MIN_ROUTE_SPACING) / RANGE) * travel;
  const inactive = disabled || !enabled;

  function release() {
    if (held.current) {
      held.current = false;
      lock.unlock();
    }
  }
  useEffect(() => () => { if (held.current) lock.unlock(); }, [lock]);

  function setFromX(x: number) {
    if (travel > 0) onMeters(routeSpacing(MIN_ROUTE_SPACING + (x - THUMB / 2) * RANGE / travel));
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.cardNested }]}>
      <Checkbox value={enabled} onValueChange={onEnabled} label={t.routeFilterPoints} disabled={disabled} />
      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.mutedText }]}>{t.routePointSpacing}</Text>
        <Text style={[styles.value, { color: theme.text }]}>{meters} m</Text>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.routePointSpacing}
        accessibilityState={{ disabled: inactive }}
        accessibilityValue={{ min: MIN_ROUTE_SPACING, max: MAX_ROUTE_SPACING, now: meters, text: `${meters} m` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          if (inactive) return;
          const action = event.nativeEvent.actionName;
          if (action === 'increment' || action === 'decrement') {
            onMeters(routeSpacing(meters + (action === 'increment' ? ROUTE_SPACING_STEP : -ROUTE_SPACING_STEP)));
          }
        }}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !inactive}
        onResponderTerminationRequest={() => false}
        onResponderGrant={event => {
          held.current = true;
          lock.lock();
          setFromX(event.nativeEvent.locationX);
        }}
        onResponderMove={event => setFromX(event.nativeEvent.locationX)}
        onResponderRelease={release}
        onResponderTerminate={release}
        style={[styles.slider, inactive && styles.inactive]}
      >
        <View pointerEvents="none" style={[styles.rail, { backgroundColor: theme.borderStrong }]}>
          <View style={[styles.fill, { backgroundColor: theme.primary, width: offset }]} />
        </View>
        <View pointerEvents="none" style={[styles.thumb, { left: offset, borderColor: theme.borderStrong }]} />
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.mutedText }]}>{t.routeGpsPoints}</Text>
        <Text style={[styles.value, { color: theme.text }]}>{kept} / {total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flexShrink: 1, fontSize: 14 },
  value: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  slider: { height: 44, justifyContent: 'center' },
  inactive: { opacity: 0.45 },
  rail: { height: 5, borderRadius: 3, marginHorizontal: THUMB / 2, overflow: 'hidden' },
  fill: { height: 5 },
  thumb: { position: 'absolute', top: (44 - THUMB) / 2, width: THUMB, height: THUMB,
    borderRadius: THUMB / 2, borderWidth: StyleSheet.hairlineWidth, backgroundColor: '#FFFFFF' },
});
