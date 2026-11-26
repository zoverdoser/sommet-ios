import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { ElevationSample, elevationSections, nearestElevationSample, slopeBands, TrackPosition } from '../services/TrackSlope';
import { useV3Theme } from '../theme/v3';
import { useScrollLock } from './ScrollLock';

const PLOT_TOP = 13;
const PLOT_BOTTOM = 128;
const HEIGHT = 153;
const LEFT = 4;
const RIGHT = 42;
const TONES = ['#47BF9A', '#539DF4', '#CF9E22', '#ED793C', '#EA4C47', '#D43659'];
const tone = (band: number | null) => TONES[band ?? 1] ?? TONES[1];
const formatDistance = (m: number) => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';

function profileGeometry(samples: ElevationSample[], bands: (number | null)[], width: number) {
  let min = Infinity;
  let max = -Infinity;
  let first = -1;
  let last = -1;
  samples.forEach(({ altitude }, i) => {
    if (altitude == null) return;
    min = Math.min(min, altitude);
    max = Math.max(max, altitude);
    if (first === -1) first = i;
    last = i;
  });
  const total = samples[samples.length - 1]?.distanceM ?? 0;
  if (first === last || !total) return null;

  const padding = Math.max(1, (max - min) * 0.05);
  const low = min - padding, high = max + padding;
  const x = (m: number) => LEFT + m / total * width;
  const y = (m: number) => PLOT_BOTTOM - (m - low) / (high - low) * (PLOT_BOTTOM - PLOT_TOP);
  const paths = new Map<string, { stroke: string[]; fill: string[] }>();
  let start = 0;
  // Keep missing elevations as visible gaps. Batch each slope tone into a pair of SVG paths.
  while (start + 1 < samples.length) {
    const next = start + 1;
    if (samples[start].altitude == null || samples[next].altitude == null) { start++; continue; }
    const color = tone(bands[next]);
    let end = next;
    while (end + 1 < samples.length && samples[end + 1].altitude != null && tone(bands[end + 1]) === color) end++;
    const path = samples.slice(start, end + 1).map(p => `${x(p.distanceM).toFixed(1)},${y(p.altitude!).toFixed(1)}`).join(' L');
    const group = paths.get(color) ?? { stroke: [], fill: [] };
    group.stroke.push('M' + path);
    group.fill.push(`M${path} L${x(samples[end].distanceM)},${PLOT_BOTTOM} H${x(samples[start].distanceM)} Z`);
    paths.set(color, group);
    start = end;
  }
  if (!paths.size) return null;

  const rendered = [...paths.entries()].map(([color, path]) => ({
    color, fill: path.fill.join(' '), stroke: path.stroke.join(' '),
  }));
  return { paths: rendered, total, low, high, x, y };
}

export function RouteElevationProfile({ samples, onSelect }: {
  samples: ElevationSample[];
  onSelect?: (position: TrackPosition | null) => void;
}) {
  const theme = useV3Theme();
  const lock = useScrollLock();
  const held = useRef(false);
  const origin = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef(-1);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(-1);
  const bands = useMemo(() => slopeBands(samples).bands, [samples]);
  const sections = useMemo(() => elevationSections(samples, bands), [samples, bands]);
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const plot = useMemo(() => profileGeometry(samples, bands, plotWidth), [samples, bands, plotWidth]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    indexRef.current = -1;
    setSelected(-1);
    onSelectRef.current?.(null);
  }, [samples]);

  const responder = useMemo(() => {
    const release = () => {
      if (held.current) {
        held.current = false;
        lock.unlock();
      }
    };
    const select = (index: number) => {
      if (index === indexRef.current || index < 0) return;
      indexRef.current = index;
      setSelected(index);
      onSelectRef.current?.(samples[index].position);
    };
    const move = (x: number) => {
      if (!plot) return;
      const progress = Math.min(1, Math.max(0, (x - LEFT) / plotWidth));
      select(nearestElevationSample(samples, progress * plot.total));
    };
    return {
      release, select, move,
      pan: PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (_, gesture) => {
          touch.current = null;
          held.current = true;
          lock.lock();
          move(gesture.moveX - origin.current);
        },
        onPanResponderMove: (_, gesture) => move(gesture.moveX - origin.current),
        onPanResponderRelease: release,
        onPanResponderTerminate: release,
      }),
    };
  }, [lock, plot, plotWidth, samples]);
  useEffect(() => responder.release, [responder]);

  if (!plot) return null;
  const cursor = samples[selected];
  const section = sections.find(item => selected > item.start && selected <= item.end) ??
    sections.find(item => selected === item.start);
  const start = section ? samples[section.start] : null;
  const finish = section ? samples[section.end] : null;
  const length = start && finish ? finish.distanceM - start.distanceM : 0;
  const rise = start && finish ? finish.altitude! - start.altitude! : 0;
  const sectionColor = tone(bands[selected] ?? null);

  return <View style={[styles.card, { backgroundColor: theme.card }]}>
    <View style={styles.header}>
      <Text style={[styles.title, { color: theme.text }]}>Elevation</Text>
      <Text style={[styles.readout, { color: theme.mutedText }]}>
        {cursor?.altitude != null ? `${formatDistance(cursor.distanceM)}  ·  ${Math.round(cursor.altitude)} m` : formatDistance(plot.total)}
      </Text>
    </View>
    <View style={styles.summary}>
      {section ? <>
        <Text style={[styles.section, { color: sectionColor }]}>
          {section.kind === 'climb' ? 'Climb' : section.kind === 'descent' ? 'Descent' : 'Flat'}
          {section.kind !== 'flat' ? ` ${section.number}/${sections.filter(item => item.kind === section.kind).length}` : ''}
        </Text>
        <Text style={[styles.readout, { color: theme.text }]}>{rise > 0 ? '+' : ''}{Math.round(rise)} m</Text>
        <Text style={[styles.readout, { color: theme.text }]}>{formatDistance(length)}</Text>
        {length > 0 && <Text style={[styles.readout, { color: theme.text }]}>avg {Math.round(rise / length * 100)}%</Text>}
      </> : <Text style={[styles.readout, { color: theme.mutedText }]}>Slide across the profile</Text>}
    </View>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.plot}
      accessible accessibilityLabel="Elevation profile" accessibilityRole="adjustable"
      accessibilityValue={cursor?.altitude != null ? { text: `${Math.round(cursor.altitude)} metres at ${formatDistance(cursor.distanceM)}` } : undefined}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        const distance = cursor?.distanceM ?? (direction > 0 ? 0 : plot.total);
        const next = nearestElevationSample(samples, distance + direction * plot.total / 40);
        if (next !== selected) responder.select(next);
        else {
          for (let i = selected + direction; i >= 0 && i < samples.length; i += direction) {
            if (samples[i].altitude != null) { responder.select(i); break; }
          }
        }
      }}
      onTouchStart={event => {
        const { locationX, pageX, pageY, touches } = event.nativeEvent;
        origin.current = pageX - locationX;
        touch.current = touches.length === 1 ? { x: pageX, y: pageY } : null;
      }}
      onTouchCancel={() => { touch.current = null; }}
      onTouchEnd={event => {
        const start = touch.current;
        touch.current = null;
        const { pageX, pageY } = event.nativeEvent;
        if (start && Math.hypot(pageX - start.x, pageY - start.y) <= 5) responder.move(pageX - origin.current);
      }}
      {...responder.pan.panHandlers}>
      {width > 0 && <View pointerEvents="none">
        <Svg width={width} height={HEIGHT}>
          <Defs>{plot.paths.map(({ color }, i) => <LinearGradient key={color} id={'area' + i}
            x1="0" x2="0" y1={PLOT_TOP} y2={PLOT_BOTTOM} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={color} stopOpacity={0.50} />
            <Stop offset="1" stopColor={color} stopOpacity={0.08} />
          </LinearGradient>)}</Defs>
          {plot.paths.map(({ color, fill }, i) => <Path key={color} d={fill} fill={`url(#area${i})`} />)}
          {[0, 0.5, 1].map(ratio => {
            const value = plot.high - ratio * (plot.high - plot.low);
            const y = plot.y(value);
            return <React.Fragment key={ratio}>
              <Line x1={LEFT} y1={y} x2={LEFT + plotWidth} y2={y} stroke={theme.borderStrong} strokeDasharray="3 3" />
              <SvgText x={width - 2} y={y + 4} textAnchor="end" fill={theme.mutedText} fontSize={10}>{Math.round(value)}</SvgText>
            </React.Fragment>;
          })}
          {plot.paths.map(({ color, stroke }) => <Path key={color} d={stroke}
            stroke={color} strokeWidth={2.4} strokeLinejoin="round" fill="none" />)}
          <SvgText x={LEFT} y={HEIGHT - 5} fill={theme.mutedText} fontSize={10}>0</SvgText>
          <SvgText x={LEFT + plotWidth} y={HEIGHT - 5} textAnchor="end" fill={theme.mutedText} fontSize={10}>{formatDistance(plot.total)}</SvgText>
          {cursor?.altitude != null && <>
            <Line x1={plot.x(cursor.distanceM)} x2={plot.x(cursor.distanceM)} y1={PLOT_TOP} y2={PLOT_BOTTOM}
              stroke={theme.primary} strokeWidth={1.5} strokeDasharray="3 3" />
            <Circle cx={plot.x(cursor.distanceM)} cy={plot.y(cursor.altitude)} r={6} fill={theme.primary} stroke={theme.card} strokeWidth={2} />
          </>}
        </Svg>
      </View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, paddingHorizontal: 9, paddingTop: 8, paddingBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, minHeight: 28 },
  section: { fontSize: 13, fontWeight: '800' },
  readout: { fontSize: 12, fontVariant: ['tabular-nums'] },
  plot: { height: HEIGHT },
});
