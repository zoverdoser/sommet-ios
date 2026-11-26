import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityRecord, getAllActivities } from '../../database/db';
import { GpxMetadata, TrackPoint } from '../../services/GpxParser';
import { activityTrackPalette, ElevationSample, trackBandColor } from '../../services/TrackSlope';
import { RouteElevationProfile } from '../RouteElevationProfile';
import { CompactMetricGrid, CompactMetric } from '../CompactMetricGrid';
import { activityForName } from '../../services/ActivityColors';
import { getStreams, getZoneGroups, getPlanned, Streams } from '../../services/ActivityStreamsService';
import { buildActivityChartHtml } from '../../services/activityChartPage';
import { useV3Theme, V3Colors } from '../../theme/v3';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../ui/primitives';
import { splitMove } from '../../services/SplitMove';
// Shared with the desktop (edit shared/, then tools/gen_activity_view.py): what each sport shows
// and the maths behind it - the same files the desktop's QML runs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AVL = require('../../config/activityViewLogic');
const ACD = require('../../config/activityChartDraw');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CFG = require('../../config/activity_view.json');

export const ADVANCED_POWER_KEY = 'activity:advancedPower';
export type ActivityMapColour = { id: string; label: string };

type Props = {
  activity: ActivityRecord;
  meta: GpxMetadata | null;
  points?: TrackPoint[];
  weatherMetrics?: CompactMetric[];
  hasMap: boolean;
  mapColourMode?: string;
  onMapColours?: (modes: ActivityMapColour[]) => void;
  mapView: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;   // user moved the map
  onHover: (p: { lat: number; lon: number } | null) => void;
  onStretch: (coords: [number, number][] | null) => void;                              // fit + highlight on the map
  onColoured: (segs: { color: string; coords: [number, number][] }[], casing: string) => void;
};

function Seg({ label, on, onPress, t }: { label: string; on: boolean; onPress: () => void; t: V3Colors }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={{ paddingHorizontal: 12, height: 30, borderRadius: 15, justifyContent: 'center', borderWidth: 1,
               borderColor: on ? t.borderStrong : t.border, backgroundColor: on ? t.cardNested : t.card, marginRight: 6, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, color: on ? t.text : t.mutedText, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ActivityPanel({ activity, meta, points, weatherMetrics = [], hasMap, mapView, mapColourMode, onMapColours, onHover, onStretch, onColoured }: Props) {
  const t = useV3Theme();
  const { isDark } = useThemeMode();
  const s = useMemo(() => styles(t), [t]);
  const sportId = activityForName(activity.activity_type).id;
  const baseSport: string = AVL.sportKey(CFG, sportId);

  const [st, setSt] = useState<Streams | null>(null);
  // An unrecognised type ("Swimming" from intervals.icu) takes the sport the FIT records.
  const sport: string = AVL.refineSport(baseSport, st);
  const sc = CFG.sports[sport] || CFG.sports.other;
  const foot = sport === 'run' || sport === 'walk' || sport === 'hike';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoneGroups, setZoneGroups] = useState<any[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [usual, setUsual] = useState<{ text: string; tone: string } | null>(null);
  const [lapsOpen, setLapsOpen] = useState(false);
  const [zoneKind, setZoneKind] = useState('');
  const [chanOn, setChanOn] = useState<Record<string, boolean>>({});
  const [focusId, setFocusId] = useState('');
  const [xDist, setXDist] = useState(true);
  const [chartColourMode, setChartColourMode] = useState('');
  const [zoom, setZoom] = useState<number[] | null>(null);
  const [hover, setHover] = useState(-1);
  const [planned, setPlanned] = useState<{ name: string; blocks: any[] } | null>(null);
  const [swimY, setSwimY] = useState<'len' | 'pace'>('len');
  const [swimColour, setSwimColour] = useState<'stroke' | 'speed'>('stroke');
  const [swimHr, setSwimHr] = useState(false);

  // ---- load
  useEffect(() => {
    let alive = true;
    setSt(null); setLoading(true); setError(''); setZoom(null); setHover(-1); setPlanned(null); setLapsOpen(false);
    AsyncStorage.getItem(ADVANCED_POWER_KEY).then(v => alive && setAdvanced(v === '1')).catch(() => undefined);
    getZoneGroups().then(g => alive && setZoneGroups(g)).catch(() => undefined);
    getStreams(activity)
      .then(x => {
        if (!alive) return;
        setSt(x);
        const sx = CFG.sports[AVL.refineSport(baseSport, x)] || CFG.sports.other, c = sx.chart;
        setChanOn(AVL.defaultChannelsOn(CFG, sx, x)); setFocusId(''); setXDist(!c || c.x !== 'time');
      })
      .catch(e => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [activity.id, activity.gpx_path]);   // eslint-disable-line react-hooks/exhaustive-deps

  const zones = useMemo(() => AVL.zonesFor(zoneGroups, sport), [zoneGroups, sport]);
  const colourModes = useMemo(() => {
    const x = st?.streams;
    if (!x) return [];
    const modes: string[] = sc.colour || [];
    return (hasMap && !modes.includes('slope') ? [...modes, 'slope'] : modes).filter(mode => {
      if (mode === 'hrz') return !!x.hr && !!zones.hr;
      if (mode === 'pwz') return !!x.pw && !!zones.power;
      if (mode === 'pace' || mode === 'speed') return !!x.v;
      return mode === 'slope' && !!x.alt && !!x.dist;
    });
  }, [st, sc, hasMap, zones]);
  useEffect(() => {
    if (hasMap) onMapColours?.(colourModes.map(id => ({ id, label: CFG.colour_modes[id].label })));
    else setChartColourMode(colourModes[0] || '');
  }, [hasMap, colourModes, onMapColours]);
  const colourMode = hasMap ? mapColourMode ?? '' : chartColourMode;

  // planned workout (indoor rides with power)
  useEffect(() => {
    if (!sc.planned_workout || !st || !st.streams || !st.streams.pw) return;
    getPlanned(String(activity.date).slice(0, 10)).then(ws => {
      const w = ws.find(x => x.type === 'Ride' || x.type === 'VirtualRide') || ws[0];
      if (!w) return;
      const blocks = AVL.workoutBlocks(w.workout_doc, AVL.ftpFrom(zoneGroups));
      setPlanned(blocks.length ? { name: w.name || 'Planned workout', blocks } : null);
    }).catch(() => undefined);
  }, [st, zoneGroups]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- facts (the list's numbers) + "compared with your usual"
  const facts = useMemo(() => {
    const m = meta;
    return {
      sport_id: sportId, start: activity.date, dist_m: activity.distance_m, duration_s: activity.duration_s,
      moving_s: activity.moving_s && activity.moving_s > 0 ? activity.moving_s : null,
      ascent_m: activity.d_plus, descent_m: m?.descentM, avg_hr: m?.avgHr, max_hr: m?.maxHr,
      avg_cad: m?.avgCadence ? m.avgCadence * (foot ? 2 : 1) : null, max_cad: m?.maxCadence ? m.maxCadence * (foot ? 2 : 1) : null,
      avg_speed: m?.avgSpeedMh ? m.avgSpeedMh / 3600 : null, max_speed: m?.maxSpeedMh ? m.maxSpeedMh / 3600 : null,
      kcal: m?.energyKcal, recovery_s: m?.recoveryS, pte: m?.peakTe ? m.peakTe / 10 : null, pool_lengths: m?.poolLengths, shots: m?.shots,
    };
  }, [activity, meta]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    if (sport === 'pool_swim') {
      if (!st || !st.longest_nonstop_m) { setUsual(null); return; }
      const KEY = 'activity:swimLongest';
      AsyncStorage.getItem(KEY).then(v => {
        const map = v ? JSON.parse(v) : {};
        map[activity.date] = st.longest_nonstop_m;
        AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => undefined);
        const earlier = Object.keys(map).filter(k => k < activity.date).map(k => ({ longest_nonstop_m: map[k] }));
        if (alive) setUsual(AVL.swimBenchmark(st.longest_nonstop_m, earlier));
      }).catch(() => undefined);
      return () => { alive = false; };
    }
    getAllActivities().then(all => {
      const cands = all.filter(a => a.id !== activity.id && a.date).map(a => ({
        sport_id: activityForName(a.activity_type).id, start: a.date, dist_m: a.distance_m || 0, duration_s: a.duration_s || 0,
        ascent_m: a.d_plus || 0, avg_speed: a.distance_m > 0 && a.duration_s > 0 ? a.distance_m / a.duration_s : null, avg_hr: null,
      }));
      const sm = st && st.summary ? st.summary : {};
      const d = activity.distance_m || 0, du = activity.duration_s || 0;
      const cur = { sport_id: sportId, start: activity.date, dist_m: d, duration_s: du, ascent_m: activity.d_plus || 0,
                    // the same speed the Overview tile shows, so the line never quotes a different pace
                    avg_speed: AVL.metricRaw(CFG, 'avg_speed', sport, facts, st) || (d > 0 && du > 0 ? d / du : null),
                    avg_hr: sm.avg_hr || meta?.avgHr || null, avg_power: sm.avg_pw || null };
      if (alive) setUsual(AVL.compareUsual(CFG, sport, cur, cands));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [st, activity.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ov = useMemo(() => AVL.overview(CFG, sport, facts, st, { advanced, zoneGroups }), [facts, st, advanced, zoneGroups, sport]);
  const twoRides = useMemo(() => AVL.twoRidesNote(st), [st]);
  // sync/06 "Split here": nothing is cut until it's confirmed (desktop: ActivityDetail.qml).
  const navigation = useNavigation<any>();
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState('');
  const askSplit = () => {
    if (!twoRides) return;
    Alert.alert(twoRides.button, twoRides.confirm, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: async () => {
        setSplitError(''); setSplitting(true);
        const r = await splitMove(activity, twoRides.at_s).catch((e: any) => ({ ok: false, message: e?.message ?? String(e) }));
        setSplitting(false);
        if (r.ok) navigation.goBack();          // the list now holds the two moves
        else setSplitError(r.message ?? '');
      } },
    ]);
  };
  const zoneKinds = useMemo(() => {
    const out: any[] = [];
    for (const k of (sc.zones || [])) {
      const z = k === 'power' ? zones.power : zones.hr, ch = k === 'power' ? 'pw' : 'hr';
      if (!z || !st || !st.hist || !st.hist[ch] || !st.hist[ch].length) continue;
      const times = AVL.zoneTimes(st, ch, z.bounds);
      if (times.reduce((a: number, b: number) => a + b, 0) < 60) continue;
      out.push({ kind: k, times, text: AVL.zoneBoundsText(z, k === 'power' ? 'W' : 'bpm') });
    }
    return out;
  }, [st, zones, sport]);   // eslint-disable-line react-hooks/exhaustive-deps
  const zoneShown = zoneKinds.find(z => z.kind === zoneKind) || zoneKinds[0] || null;

  // ---- palette
  const zonePalette = useMemo(() => activityTrackPalette(isDark), [isDark]);

  const profile = useMemo<ElevationSample[]>(() => {
    if (!hasMap) return [];
    const x = st?.streams;
    if (x?.alt && x?.dist) {
      const samples: ElevationSample[] = [];
      x.dist.forEach((dist: number | null, i: number) => {
        if (dist == null || !Number.isFinite(dist)) return;
        const lat = x.lat?.[i], lon = x.lon?.[i], altitude = x.alt[i];
        samples.push({
          distanceM: dist * 1000,
          altitude: Number.isFinite(altitude) ? altitude : null,
          position: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
        });
      });
      if (samples.some((sample, i) => i > 0 && sample.altitude != null && samples[i - 1].altitude != null &&
        sample.distanceM > samples[i - 1].distanceM)) return samples;
    }
    return points?.map(p => ({
      distanceM: p.cumDist,
      altitude: p.hasElevation && Number.isFinite(p.elevation) ? p.elevation : null,
      position: { lat: p.latitude, lon: p.longitude },
    })) ?? [];
  }, [st, points, hasMap]);
  const hasProfile = profile.some((sample, i) => i > 0 && sample.altitude != null &&
    profile[i - 1].altitude != null && sample.distanceM > profile[i - 1].distanceM);

  // ---- channels, colour, map sync
  const chans = useMemo(() => {
    const c = sc.chart, out: any[] = [];
    if (!c || !c.channels || !st || !st.streams) return out;
    for (const id of c.channels) {
      const def = CFG.channels[id];
      if (!def || (id === 'alt' && hasProfile) || !AVL.channelUseful(st, def.key)) continue;   // missing or flat: hidden
      out.push(Object.assign({ id }, def, id === 'cad' ? { unit: foot ? 'spm' : 'rpm' } : {}));
    }
    return out;
  }, [st, sport, hasProfile]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chansOn = chans.filter(c => c.id === 'pace' || chanOn[c.id]);
  const selectableChans = chans.filter(c => c.id !== 'pace');
  const coords = useMemo<([number, number] | null)[]>(() => {
    const x = st && st.streams;
    if (!x || !x.lat) return [];
    return x.lat.map((la: number | null, i: number) => (la === null ? null : [la, x.lon[i]] as [number, number]));
  }, [st]);
  const cb = useMemo(() => (colourMode && st ? AVL.colourBands(CFG, colourMode, st, zones, sport) : null), [colourMode, st, zones, sport]);
  useEffect(() => {
    if (!hasMap) return;
    if (!cb || !coords.length) { onColoured([], zonePalette.casing); return; }
    const segs: { color: string; coords: [number, number][] }[] = [];
    let cur: any = null, curBand: any;
    coords.forEach((c, i) => {
      if (!c) { cur = null; return; }
      const b = cb.bands[i];
      if (cur && b === curBand) { cur.coords.push(c); return; }
      const col = trackBandColor(zonePalette, cb, b, t.borderStrong);
      const seg = { color: col, coords: cur ? [cur.coords[cur.coords.length - 1], c] : [c] };
      segs.push(seg); cur = seg; curBand = b;
    });
    onColoured(segs, zonePalette.casing);
  }, [cb, coords, hasMap, zonePalette, t.borderStrong]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickColour = (m: string) => {
    setChartColourMode(m);
    const key = CFG.colour_modes[m].key, ch = chans.find(c => c.key === key);
    if (ch) { setChanOn(o => ({ ...o, [ch.id]: true })); setFocusId(ch.id); }
  };
  const stretchOnMap = (range: number[] | null) => {
    if (!hasMap) return;
    if (!range) { onStretch(null); return; }
    const pts: [number, number][] = [];
    for (let i = range[0]; i <= range[1]; i++) if (coords[i]) pts.push(coords[i] as [number, number]);
    onStretch(pts);
  };
  // the map moved (by the user): the chart follows the longest stretch on screen
  const guard = useRef(0);
  useEffect(() => {
    if (!mapView || !coords.length || Date.now() - guard.current < 600) return;
    const flags = coords.map(c => !!c && c[0] >= mapView.minLat && c[0] <= mapView.maxLat && c[1] >= mapView.minLon && c[1] <= mapView.maxLon);
    const run = AVL.longestRun(flags, 2);
    if (!run) return;
    const z = run[0] === 0 && run[1] >= coords.length - 1 ? null : [run[0], Math.max(run[1], run[0] + 2)];
    setZoom(z);
    chartRef.current?.injectJavaScript(`window.ChartPage && window.ChartPage.setState(${JSON.stringify({ zoom: z })}); true;`);
    onStretch(null);   // highlight only; don't refit a map the user is moving
  }, [mapView]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- chart page
  const chartRef = useRef<WebView>(null);
  const [chartReady, setChartReady] = useState(0);
  const [chartH, setChartH] = useState(360);
  const chartSource = useMemo(() => ({ html: buildActivityChartHtml() }), []);
  const swimMode = sport === 'pool_swim' && !!(st && st.lengths && st.lengths.some((l: any) => l.active && l.swim_s));
  const focus = focusId || (cb ? ((chansOn.find(c => c.key === CFG.colour_modes[colourMode].key) || {}).id || '') : '');
  const colors = { text: t.text, muted: t.mutedText, border: t.border, borderStrong: t.borderStrong, card: t.card, cardNested: t.cardNested,
                   background: t.background, primary: t.primary, hard: t.hard, warning: t.warning, secondary: t.secondary, accent: t.accent };
  const labels = { altitude: 'Altitude', fasterUp: '(faster is up)', plannedTarget: 'Planned target', avg: 'avg', max: 'max', best: 'best',
                   top: 'top', target: 'Target', colour: 'Colour', stripHint: 'Whole activity · drag the box to move along', median: 'median' };
  useEffect(() => {
    if (!chartReady || !st) return;
    const d = swimMode
      ? { mode: 'swim', st, colors, zone: zonePalette, labels, swim: { yMode: swimY, colourMode: swimColour, showHr: swimHr } }
      : { mode: 'overlay', st, channels: chansOn, focusId: focus, isDist: xDist && !!st.streams.dist, zoom, colourMode, cfg: CFG,
          zones, sport, target: planned, colors, zone: zonePalette, labels };
    chartRef.current?.injectJavaScript(`window.ChartPage.setData(${JSON.stringify(d)}); true;`);
  }, [chartReady, st, chanOn, focus, xDist, colourMode, planned, isDark, swimY, swimColour, swimHr]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onChartMessage = (e: WebViewMessageEvent) => {
    let m: any; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') setChartReady(n => n + 1);
    else if (m.type === 'height') setChartH(m.h + 4);
    else if (m.type === 'hover') {
      setHover(m.idx);
      const c = m.idx >= 0 ? coords[m.idx] : null;
      onHover(c ? { lat: c[0], lon: c[1] } : null);
    } else if (m.type === 'zoom') { guard.current = Date.now(); setZoom(m.range); stretchOnMap(m.range); }
    else if (m.type === 'focus') setFocusId(m.id);
  };
  const zoomBy = (f: number) => {
    if (!st) return;
    const n = st.streams.t.length - 1, a = zoom ? zoom[0] : 0, b = zoom ? zoom[1] : n;
    const c = hover >= 0 ? hover : Math.round((a + b) / 2), w = Math.max(8, Math.round((b - a) * f));
    let z: number[] | null = null;
    if (w < n) { let na = Math.max(0, c - Math.round(w / 2)); const nb = Math.min(n, na + w); na = Math.max(0, nb - w); z = [na, nb]; }
    guard.current = Date.now(); setZoom(z); stretchOnMap(z);
    chartRef.current?.injectJavaScript(`window.ChartPage.setState(${JSON.stringify({ zoom: z })}); true;`);
  };

  const pressedLaps = !!(st && st.laps_kind === 'pressed') && sport !== 'pool_swim';
  const showCharts = !!sc.chart && (chans.length > 0 || swimMode);
  const overviewMetrics: CompactMetric[] = [...ov.headline, ...ov.secondary, ...ov.more].map(m => ({
    ...m, onPress: m.info ? () => Alert.alert(m.label, m.info) : undefined,
  }));

  return (
    <View style={s.panel}>
      <RouteElevationProfile samples={profile} onSelect={onHover} />
      {(weatherMetrics.length > 0 || overviewMetrics.length > 0 || usual || twoRides || zoneShown || loading || error) && (
        <View style={s.card}>
          <Text accessibilityRole="header" style={[s.sectionTitle, s.cardHeading]}>Data</Text>
          {/* sync/06: a long stop with almost nothing on one side; only a note (desktop: ActivityDetail.qml) */}
          {!!twoRides && (
            <View style={s.note}>
              <Text style={s.noteTitle}>{twoRides.title}</Text>
              <Text style={s.noteBody}>{twoRides.body}</Text>
              <Button label={twoRides.button} onPress={askSplit} busy={splitting} variant="outline" grow={false}
                      style={{ marginTop: 8, alignSelf: 'flex-start' }} />
              {!!splitError && <Text style={[s.noteBody, { color: t.error, marginTop: 8 }]}>{splitError}</Text>}
            </View>)}
          <CompactMetricGrid metrics={[...weatherMetrics, ...overviewMetrics]} plain />
          {!!usual && (
            <View style={s.usual}><Text style={s.usualIcon}>{usual.tone === 'best' ? '★' : '↗'}</Text><Text style={s.usualText}>{usual.text}</Text></View>
          )}
          {!!zoneShown && (
            <View style={{ marginTop: 12 }}>
              <View style={s.zoneHead}>
                <Text style={s.zoneTitle}>{zoneShown.kind === 'power' ? 'Time in power zones' : 'Time in heart-rate zones'}</Text>
                {zoneKinds.length > 1 && (
                  <View style={s.wrapRow}>
                    {zoneKinds.map(z => <Seg key={z.kind} t={t} label={z.kind === 'power' ? 'Power' : 'Heart rate'} on={zoneShown.kind === z.kind} onPress={() => setZoneKind(z.kind)} />)}
                  </View>)}
              </View>
              <View style={s.zoneBar}>
                {zoneShown.times.map((sec: number, i: number) => {
                  const tot = zoneShown.times.reduce((a: number, b: number) => a + b, 0);
                  return sec / tot > 0.002 ? <View key={i} style={{ flex: sec, backgroundColor: zonePalette['z' + (i + 1)], height: 12, borderRadius: 4, marginRight: 2 }} /> : null;
                })}
              </View>
              <View style={s.wrapRow}>
                {zoneShown.times.map((sec: number, i: number) => {
                  const tot = zoneShown.times.reduce((a: number, b: number) => a + b, 0);
                  return sec > 0 ? (
                    <View key={i} style={s.legendItem}>
                      <View style={[s.swatch, { backgroundColor: zonePalette['z' + (i + 1)] }]} />
                      <Text style={s.legendText}>Z{i + 1} {AVL.fmtClock(sec)} · {Math.round(100 * sec / tot)}%</Text>
                    </View>) : null;
                })}
              </View>
              <Text style={s.caption}>{zoneShown.text}</Text>
            </View>)}
          {loading && <ActivityIndicator size="small" color={t.mutedText} style={{ marginTop: 8 }} />}
          {!!error && <Text style={[s.caption, { marginTop: 10 }]}>{error}</Text>}
        </View>)}

      {showCharts && (
        <View style={s.card}>
          <Text accessibilityRole="header" style={[s.sectionTitle, s.cardHeading]}>Activity Charts</Text>
          {swimMode ? (
            <View style={s.wrapRow}>
              <Seg t={t} label="Time per length" on={swimY === 'len'} onPress={() => setSwimY('len')} />
              <Seg t={t} label="Pace per 100 m" on={swimY === 'pace'} onPress={() => setSwimY('pace')} />
              <Seg t={t} label="Colour: stroke" on={swimColour === 'stroke'} onPress={() => setSwimColour('stroke')} />
              <Seg t={t} label="Colour: speed" on={swimColour === 'speed'} onPress={() => setSwimColour('speed')} />
              <Seg t={t} label="Heart rate" on={swimHr} onPress={() => setSwimHr(v => !v)} />
            </View>
          ) : (
            <>
              {selectableChans.length > 0 && <View style={s.wrapRow}>
                {selectableChans.map(c => <Seg key={c.id} t={t} label={c.label} on={!!chanOn[c.id]} onPress={() => {
                  const on = !chanOn[c.id];
                  setChanOn(o => ({ ...o, [c.id]: on }));
                  if (on) setFocusId(c.id); else if (focusId === c.id) setFocusId('');
                }} />)}
              </View>}
              <View style={s.wrapRow}>
                {!!st?.streams?.dist && sc.chart?.x !== 'time' && (<>
                  <Seg t={t} label="Distance" on={xDist} onPress={() => setXDist(true)} />
                  <Seg t={t} label="Time" on={!xDist} onPress={() => setXDist(false)} />
                </>)}
                <Seg t={t} label="−" on={false} onPress={() => zoomBy(2)} />
                <Seg t={t} label="+" on={false} onPress={() => zoomBy(0.5)} />
                {!hasMap && colourModes.map(m => <Seg key={m} t={t} label={CFG.colour_modes[m].label} on={colourMode === m} onPress={() => pickColour(m)} />)}
                {!hasMap && colourModes.length > 0 && <Seg t={t} label="Off" on={colourMode === ''} onPress={() => setChartColourMode('')} />}
              </View>
              <View style={s.zoomInfo}>
                <Text style={[s.caption, { flex: 1, color: zoom ? t.text : t.mutedText }]}>
                  {zoom && st ? 'Selected: ' + AVL.sectionSummary(st, chansOn, zoom[0], zoom[1])
                              : 'Drag a finger across the chart to read the values; pinch to zoom; double-tap to see everything.'}
                </Text>
                {!!zoom && <Seg t={t} label="Show all" on={false} onPress={() => { setZoom(null); stretchOnMap(null);
                  chartRef.current?.injectJavaScript('window.ChartPage.setState({"zoom":null}); true;'); }} />}
              </View>
            </>
          )}
          <WebView
            ref={chartRef}
            style={{ height: chartH, backgroundColor: 'transparent' }}
            source={chartSource}
            originWhitelist={['*']}
            javaScriptEnabled
            scrollEnabled={false}
            onMessage={onChartMessage}
          />
          {!!planned && !swimMode && (
            <Text style={[s.caption, { color: t.text }]}>
              Planned on intervals.icu: {planned.name} ({AVL.fmtClock(planned.blocks[planned.blocks.length - 1].t1)}). Its power targets are the shaded blocks behind your power, on the time axis.
            </Text>)}
          {!!swimMode && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
              {[...ACD.swimLegend(st, swimColour), ...(swimY === 'len' ? [{ key: 'borderStrong', label: 'Rest at the wall' }] : [])]
                .map((it: { key: string; label: string }) => (
                <View key={it.key + it.label} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, marginRight: 6,
                                 backgroundColor: ACD.legendColour({ zone: zonePalette, colors: { ...colors, muted: t.mutedText } }, it.key) }} />
                  <Text style={s.caption}>{it.label}</Text>
                </View>))}
            </View>)}
          {!!swimMode && st?.sets?.length > 0 && (
            <Text style={s.caption}>{st.sets.length} sets between rests at the wall. Longest non-stop: {st.longest_nonstop_m} m.</Text>)}
          {AVL.workoutLines(st).map((w: { start_s: number; text: string }) => (
            <Text key={w.start_s} style={[s.caption, { color: t.text }]}>{w.text}</Text>))}
        </View>)}

      {pressedLaps && (
        <TouchableOpacity style={[s.card, s.expand]} accessibilityRole="button"
          accessibilityState={{ expanded: lapsOpen }} onPress={() => setLapsOpen(open => !open)}>
          <Text style={s.sectionTitle}>Laps</Text>
          <Text style={s.sectionTitle}>{lapsOpen ? '−' : '+'}</Text>
        </TouchableOpacity>
      )}
      {pressedLaps && lapsOpen && st && (
        <View style={s.card}>
          <View style={s.lapRow}>
            {['Lap', 'Time', 'Distance', foot ? 'Pace' : 'Speed', 'Avg HR', 'Max HR'].map(h => <Text key={h} style={[s.lapCell, s.lapHead]}>{h}</Text>)}
          </View>
          {st.laps.map((l: any, i: number) => (
            <TouchableOpacity key={i} style={s.lapRow} onPress={() => {
              const tt = st.streams.t, t0 = tt[0], end = (l.start_s || 0) + (l.elapsed_s || l.timer_s || 0);
              let a = 0, b = tt.length - 1;
              for (let k = 0; k < tt.length; k++) { if (tt[k] - t0 <= l.start_s) a = k; if (tt[k] - t0 <= end) b = k; }
              guard.current = Date.now(); setZoom([a, b]); stretchOnMap([a, b]);
            }}>
              <Text style={s.lapCell}>{i + 1}</Text>
              <Text style={s.lapCell}>{AVL.fmtClock(l.timer_s || 0)}</Text>
              <Text style={s.lapCell}>{l.dist_m ? (l.dist_m >= 1000 ? (l.dist_m / 1000).toFixed(2) + ' km' : Math.round(l.dist_m) + ' m') : ''}</Text>
              <Text style={s.lapCell}>{l.avg_speed ? (foot ? AVL.paceText(l.avg_speed, 1000) + ' /km' : (l.avg_speed * 3.6).toFixed(1)) : ''}</Text>
              <Text style={s.lapCell}>{l.avg_hr || ''}</Text>
              <Text style={s.lapCell}>{l.max_hr || ''}</Text>
            </TouchableOpacity>))}
          <Text style={s.caption}>Tap a lap to see it on the map.</Text>
        </View>)}
    </View>
  );
}

const styles = (t: V3Colors) => StyleSheet.create({
  panel: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24, gap: 8 },
  expand: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, alignItems: 'center' },
  sectionTitle: { fontSize: 14, color: t.text, fontWeight: '700' },
  cardHeading: { marginBottom: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 4 },
  swatch: { width: 10, height: 10, borderRadius: 3, marginRight: 5 },
  legendText: { fontSize: 12, color: t.mutedText },
  card: { backgroundColor: t.card, borderRadius: 14, padding: 12 },
  // same as desktop's warning note: warning border, 12% warning fill, radius 8, padding 16
  note: { backgroundColor: t.warning + '1F', borderRadius: 8, borderWidth: 1, borderColor: t.warning, padding: 16, marginBottom: 12 },
  noteTitle: { fontSize: 13, fontWeight: '700', color: t.text, marginBottom: 8 },
  noteBody: { fontSize: 12, color: t.text },
  usual: { flexDirection: 'row', marginVertical: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border },
  usualIcon: { color: t.primary, fontWeight: '700', marginRight: 8 },
  usualText: { flex: 1, color: t.text, fontSize: 13 },
  zoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  zoneTitle: { fontSize: 13, fontWeight: '700', color: t.text, marginBottom: 6 },
  zoneBar: { flexDirection: 'row', marginVertical: 6 },
  caption: { fontSize: 11, color: t.mutedText, marginTop: 4 },
  zoomInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  lapRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.border },
  lapCell: { flex: 1, fontSize: 12, color: t.text, textAlign: 'right' },
  lapHead: { color: t.mutedText },
});
