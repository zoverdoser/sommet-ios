import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert, ScrollView, useWindowDimensions,
} from 'react-native';

import { TabActions, useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  ActivityRecord, deleteActivity,
  ActivityPageRow, getActivityPage, getActivityTypes, saveActivityMetrics, getActivitiesMissingMetrics,
  ACTIVITY_PAGE, GPX_METRIC_COLUMNS,
} from '../database/db';
import { readGpxFile } from '../services/GpxService';
import { adoptOrphanGpx, backfillMovingTimes } from '../services/OrphanGpx';
import { extractGpxMetadata, GpxMetadata } from '../services/GpxParser';
import RNFS from 'react-native-fs';
import { t, fmtDate } from '../i18n';
import { useV3Theme, v3Spacing } from '../theme/v3';
import { ActivityThumbnail, RemoteActivityThumbnail } from '../components/ActivityThumbnail';
import { isTrackRemote } from '../services/LightLibrary';
import { SportPicture } from '../components/SportPicture';
import Icon, { IconName } from '../components/ui/Icon';
import { activityIconName } from '../services/ActivityColors';
import { isFootSport } from '../services/SportNames';
import {
  getViewMode, setViewMode as persistViewMode, getActivityColumns, setActivityColumns, ViewMode,
} from '../services/ListViewPrefs';
import { ActionMenu } from '../components/ui/ActionMenu';
import { ViewModeToggle } from '../components/ui/ViewModeToggle';
import {
  ALL_METRICS, MetricValues, metricLabel, metricValue, metricRaw, metricsAvailableFor,
} from '../services/ActivityMetrics';
import { MetricColumnMenu } from '../components/ui/MetricColumnMenu';
import { deleteIntervalsIcuActivity } from '../services/ApiIntervalsIcu';
import { EmptyState, PulseDots, SkeletonList } from '../components/ui/primitives';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { exportAllToDownloads } from '../services/ExportAll';
import { useDemo } from '../config/DemoContext';
import { demoMoves, isDemoActivity } from '../services/DemoData';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ALL = t.all;

// An activity plus its richer metrics (re-parsed from the move's GPX for the configurable
// columns). Cached module-wide by id+synced_at so re-focusing the screen doesn't re-read files.
type EnrichedActivity = ActivityRecord & { metrics: MetricValues };

function buildMetrics(a: ActivityRecord, gpx?: GpxMetadata): MetricValues {
  const distanceM = a.distance_m || 0;
  const durationS = a.duration_s || 0;
  return {
    distanceM, durationS,
    ascentM: a.d_plus || 0,
    descentM: gpx?.descentM || 0,
    energyKcal: gpx?.energyKcal || a.energy_kcal || 0,
    avgHr: gpx?.avgHr || 0,
    maxHr: gpx?.maxHr || 0,
    avgCadence: gpx?.avgCadence || 0,
    maxCadence: gpx?.maxCadence || 0,
    avgSpeedMh: gpx?.avgSpeedMh || (distanceM > 0 && durationS > 0 ? distanceM / (durationS / 3600) : 0),
    maxSpeedMh: gpx?.maxSpeedMh || 0,
    recoveryS: gpx?.recoveryS || 0,
    peakTe: gpx?.peakTe || 0,
    poolLengths: gpx?.poolLengths || 0,
    shots: gpx?.shots || 0,
    maxAltM: gpx?.maxAltM || 0,
    // Pace only means something on foot (André, 2026-10-03: "There is no 'pace' on bike, but avg
    // speed km/h") - same rule as the desktop's activity screen. 0 = the card skips it.
    paceSecPerKm: !isFootSport(a.activity_type) ? 0
      : gpx?.paceSecPerKm || (distanceM > 0 && durationS > 0 ? durationS / (distanceM / 1000) : 0),
  };
}

// Parses one activity's GPX for the list's metric columns and caches the result in the DB
// (activity_metrics), so that GPX is never parsed again for the list. Undefined if unreadable.
async function cacheGpxMetrics(a: ActivityRecord): Promise<GpxMetadata | undefined> {
  if (!a.gpx_path) return undefined;
  try {
    const gpx = extractGpxMetadata(await readGpxFile(a.gpx_path));
    const v: Record<string, number> = {
      descent: gpx.descentM || 0, calories: gpx.energyKcal || 0, avgHr: gpx.avgHr || 0, maxHr: gpx.maxHr || 0,
      avgCadence: gpx.avgCadence || 0, maxCadence: gpx.maxCadence || 0, avgSpeed: gpx.avgSpeedMh || 0,
      maxSpeed: gpx.maxSpeedMh || 0, recovery: gpx.recoveryS || 0, peakTe: gpx.peakTe || 0,
      maxAltitude: gpx.maxAltM || 0, poolLengths: gpx.poolLengths || 0, pace: gpx.paceSecPerKm || 0,
      shots: gpx.shots || 0,
    };
    await saveActivityMetrics(a.id, a.synced_at, JSON.stringify(gpx), v).catch(() => {});
    return gpx;
  } catch {
    return undefined;
  }
}

export default function LogListScreen() {
  const theme = useV3Theme();
  // A phone held sideways (under 500 dp tall): the sport chips and the column pills share one
  // row, so the list keeps room for more than one move (2026-11-19).
  const win = useWindowDimensions();
  const oneBarRow = win.width > win.height && win.height < 500;
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();
  const [activities, setActivities] = useState<EnrichedActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>(ALL);
  // View mode (map/list) is the persisted Settings preference; re-read on focus so a change
  // in Settings takes effect when the user returns here.
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  // Configurable metric columns (persisted) + sort. Sorting is by whichever column, chosen
  // from that column's dropdown, or the default newest-first by upload date.
  const [columns, setColumns] = useState<string[]>(['distance', 'duration', 'ascent', 'calories']);
  // Default: newest FIRST by the activity's own date (what the user recorded), not by upload time.
  // Sorting by upload time buried genuinely-recent moves under whatever was re-imported last, so a
  // move from today could sit far down the list (André, 2026-09-14). A chosen metric column still
  // overrides this.
  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);   // first load in progress (vs genuinely empty)
  // A failed page read (desktop picks #19): ErrorBanner shows one plain sentence, not the raw text.
  const [loadErr, setLoadErr] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuCol, setMenuCol] = useState<number | null>(null);   // which column's dropdown is open
  useFocusEffect(useCallback(() => {
    getViewMode('activities').then(setViewMode);
    getActivityColumns().then(setColumns);
  }, []));
  function changeViewMode(m: ViewMode) { setViewMode(m); persistViewMode('activities', m); }

  function persistColumns(next: string[]) {
    setColumns(next);
    setActivityColumns(next);
  }
  function setColumn(idx: number, key: string) {
    const c = columns.slice(); c[idx] = key; persistColumns(c);
  }
  function removeColumn(idx: number) {
    if (columns.length <= 1) return;
    const c = columns.slice(); c.splice(idx, 1); persistColumns(c);
  }
  function addColumn() {
    const unused = ALL_METRICS.find(m => columns.indexOf(m.key) === -1);
    if (unused) persistColumns(columns.concat([unused.key]));
  }
  function sortByColumn(key: string, desc: boolean) {
    setSortKey(key); setSortDesc(desc);
  }

  // Calendar + Totals are activity-analytics views (desktop TotalsPage/CalendarPage parity).
  // On Android they're reached from here, the Activities screen, rather than the Home nav
  // shell: the phone's bottom tab row is already full, and these three (list / calendar /
  // totals) are one family of "what have I done" views, so grouping them is the adaptive
  // choice (rule 2, "UI evolutive according to the device").
  // "Export all" (2026-11-12, desktop parity): every activity in the list (or the chosen sport)
  // into a new Downloads folder. `exporting` is the progress line; stopRef ends a run early.
  const [exporting, setExporting] = useState('');
  const stopExport = React.useRef(false);
  const runExportAll = useCallback(async (withFit: boolean) => {
    stopExport.current = false;
    setExporting(t.exportAllProgress(0, 0));
    try {
      const sport = activeFilter === ALL ? '' : activeFilter;
      const r = await exportAllToDownloads(sport, withFit,
        (done, total) => setExporting(t.exportAllProgress(done, total)), () => stopExport.current);
      Alert.alert(t.exportAllTitle, t.exportAllDone(r.folder, r.gpxFiles, r.fitFiles, r.skipped));
    } catch (e: any) {
      Alert.alert(t.error, t.saveError + (e?.message ?? ''));
    } finally {
      setExporting('');
    }
  }, [activeFilter]);
  const askExportAll = useCallback(() => {
    if (exporting) return;
    Alert.alert(t.exportAllTitle, t.exportAllMsg(activeFilter === ALL ? '' : activeFilter), [
      { text: t.cancel, style: 'cancel' },
      { text: t.exportAllGpxFit, onPress: () => runExportAll(true) },
      { text: t.exportAllGpx, onPress: () => runExportAll(false) },
    ]);
  }, [activeFilter, exporting, runExportAll]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={askExportAll} style={styles.headerAction} accessibilityRole="button" accessibilityLabel={t.exportAllTitle}>
            <Icon name="download" size={22} color={exporting ? theme.mutedText : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Calendar')} style={styles.headerAction} accessibilityRole="button" accessibilityLabel={t.calendarScreenTitle}>
            <Icon name="calendar" size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Totals')} style={styles.headerAction} accessibilityRole="button" accessibilityLabel={t.totalsScreenTitle}>
            <Icon name="chart" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, theme, styles, askExportAll, exporting]);

  // ─── Paged loading (André, 2026-09-29) ─────────────────────────────────────
  // "not worth to load all the 4XXX activities ... load it progressively ... I would say 30". The
  // list used to read every row AND parse every GPX before showing anything (~110 s on the tablet).
  // Now: ACTIVITY_PAGE rows at a time, sport filter + sort done in SQL (db.getActivityPage), the
  // next page asked for when the user is within ~2 screens of the end (onEndReachedThreshold), and
  // a row's GPX is parsed only when its page loads - once ever, cached in activity_metrics.
  const [types, setTypes] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [preparing, setPreparing] = useState('');         // "Reading 12 of 138…" before a GPX-metric sort
  const reqRef = React.useRef(0);                          // drops a page answer that arrives after a reset
  const listRef = React.useRef<FlatList<EnrichedActivity>>(null);
  const busyRef = React.useRef(false);
  const filterArg = activeFilter === ALL ? '' : activeFilter;

  // The metrics a row's card needs: from the cache, or its GPX (parsed now, then cached).
  async function enrich(rows: ActivityPageRow[]): Promise<EnrichedActivity[]> {
    return Promise.all(rows.map(async r => {
      let gpx: GpxMetadata | undefined;
      if (r.metrics_json && r.metrics_synced_at === r.synced_at) {
        try { gpx = JSON.parse(r.metrics_json); } catch { gpx = undefined; }
      }
      if (!gpx && r.gpx_path) gpx = await cacheGpxMetrics(r);
      const { metrics_json: _j, metrics_synced_at: _s, ...a } = r;
      return { ...a, metrics: buildMetrics(a, gpx) };
    }));
  }

  // Testing mode: the sample watch's moves, on top of the list (see services/DemoData.ts). They
  // are not in the database, so they take no part in sorting, totals, exports or any sync.
  const demo = useDemo();
  async function sampleRows(): Promise<EnrichedActivity[]> {
    if (!demo.enabled) return [];
    try {
      return (await demoMoves(demo.variant, filterArg)).map(m => ({ ...m.activity, metrics: buildMetrics(m.activity, m.gpx) }));
    } catch {
      return [];
    }
  }

  async function loadPage(reset: boolean) {
    if (!reset && (busyRef.current || !hasMore)) return;
    const req = reset ? ++reqRef.current : reqRef.current;
    busyRef.current = true;
    if (!reset) setLoadingMore(true);
    try {
      const offset = reset ? 0 : activities.length;
      const rows = await getActivityPage({ type: filterArg, sortKey, desc: sortDesc, offset });
      const enriched = (reset ? await sampleRows() : []).concat(await enrich(rows));
      if (req !== reqRef.current) return;                  // filter/sort changed meanwhile
      setActivities(prev => {
        if (reset) return enriched;
        const seen = new Set(prev.map(a => a.id));      // belt and braces: never the same row twice
        return prev.concat(enriched.filter(a => !seen.has(a.id)));
      });
      setHasMore(rows.length === ACTIVITY_PAGE);
      setLoadErr('');
    } catch (e: any) {
      if (req === reqRef.current) setLoadErr(String(e?.message ?? e));
    } finally {
      if (req === reqRef.current) { busyRef.current = false; setLoadingMore(false); setLoading(false); }
    }
  }

  // Sorting by a column that only exists in a GPX (HR, calories...) needs every GPX's value: fill
  // the cache for the ones never read (at most the few moves that have a GPX; once, ever).
  async function prepareGpxSort(key: string) {
    if ((GPX_METRIC_COLUMNS as readonly string[]).indexOf(key) < 0) return;
    const missing = await getActivitiesMissingMetrics();
    for (let i = 0; i < missing.length; i++) {
      setPreparing(`Reading ${i + 1} of ${missing.length}…`);
      await cacheGpxMetrics(missing[i]);
    }
    setPreparing('');
  }

  // A new filter or sort starts from the top of the list (not wherever the old one was scrolled).
  useEffect(() => { listRef.current?.scrollToOffset({ offset: 0, animated: false }); }, [filterArg, sortKey, sortDesc]);

  const load = useCallback(async () => {
    getActivityTypes().then(async dbTypes => {
      // the sample moves' sports get a filter chip too
      // (one chip per sport: "Trail Running" of a sample joins the user's own "Trail running")
      const extra = demo.enabled ? (await demoMoves(demo.variant).catch(() => [])).map(m => m.activity.activity_type) : [];
      const have = new Set(dbTypes.map(x => x.toLowerCase()));
      setTypes(dbTypes.concat(Array.from(new Set(extra)).filter(x => !have.has(x.toLowerCase()))).sort());
    }).catch(() => {});
    await prepareGpxSort(sortKey);
    await loadPage(true);
    adoptOrphanGpx().then(n => { if (n > 0) { getActivityTypes().then(setTypes).catch(() => {}); loadPage(true); } })
      .catch(() => {})
      .then(() => backfillMovingTimes()).catch(() => {});   // sync/06, for the Coach's load
  }, [filterArg, sortKey, sortDesc, demo.enabled, demo.variant]);   // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDelete(item: ActivityRecord) {
    if (isDemoActivity(item.id)) return;       // a sample move of Testing mode: nothing to delete
    // Say plainly when the delete also removes the remote copy - it is irreversible, so the
    // confirm must not imply this only hides it locally.
    const alsoRemote = item.id.startsWith('icu:');
    Alert.alert(
      t.deleteTitle,
      t.deleteMsg(formatDate(item.date))
        + (alsoRemote ? '\n\nThis also deletes it permanently from intervals.icu.' : ''),
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            await deleteActivity(item.id);           // ajoute à la liste noire
            if (item.gpx_path) {
              await RNFS.unlink(item.gpx_path).catch(() => {});
            }
            // An activity that CAME FROM intervals.icu is also deleted there (2026-08-26,
            // desktop parity - André chose "also delete from the source" over a local-only
            // hide). Watch-recorded moves have no remote copy to remove. Fire-and-forget: the
            // local delete already stands, and a network failure must not resurrect the row.
            if (item.id.startsWith('icu:')) {
              deleteIntervalsIcuActivity(item.id).catch(() => {});
            }
            await load();
          },
        },
      ]
    );
  }

  // ─── Filtres ────────────────────────────────────────────────────────────────

  // Chips list every sport in the DB (not just the loaded rows); the list itself arrives filtered
  // and sorted from SQL, a page at a time.
  const filterTypes = useMemo(() => [ALL, ...types], [types]);

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  // While the first load is still running, grey rows shaped like the list (desktop picks #13) -
  // not the empty page, which wrongly implied there was no data when the DB query simply hadn't
  // returned yet.
  if (loading && activities.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.skeleton}>
          <SkeletonList count={6} />
          <Text style={[styles.emptyHint, { marginTop: 12 }]}>{t.loadingActivities}</Text>
        </View>
      </View>
    );
  }

  // Nothing to show, or the read failed (desktop picks #11 and #19): an empty page says what to
  // do next, and a failure goes through ErrorBanner (one sentence, Try again, Send logs).
  if (activities.length === 0 && activeFilter === ALL && !preparing) {
    return (
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.empty}>
        <View style={styles.emptyBox}>
          {loadErr ? (
            <ErrorBanner detail={loadErr} context={t.activitiesLoadContext} showPlainDetail onRetry={() => { load(); }} />
          ) : (
            <EmptyState
              icon="activity"
              title={t.activitiesEmptyTitle}
              text={t.activitiesEmptyText}
              actionLabel={t.homeNavHome}
              onAction={() => navigation.dispatch(TabActions.jumpTo('Dashboard'))}
            />
          )}
        </View>
      </ScrollView>
    );
  }

  const controls = (
    <View style={styles.tools}>
      <View style={styles.toolRow}>
        <TouchableOpacity style={styles.sportSelect} accessibilityRole="button"
          accessibilityLabel={t.activitySportFilter}
          accessibilityValue={{ text: activeFilter }} accessibilityState={{ expanded: filterOpen }}
          onPress={() => setFilterOpen(true)} activeOpacity={0.65}>
          <Icon name={activeFilter === ALL ? 'activity' : activityIconName(activeFilter)} size={18} color={theme.primary} />
          <Text style={styles.sportLabel}>{activeFilter === ALL ? t.activityAllSports : capitalize(activeFilter)}</Text>
          <View style={styles.down}><Icon name="chevronRight" size={14} color={theme.mutedText} /></View>
        </TouchableOpacity>
        <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metricTools}>
        {columns.map((key, idx) => {
          const active = sortKey === key;
          return (
            <TouchableOpacity key={key} style={[styles.metricOption, active && styles.metricOptionActive]}
              accessibilityRole="button" accessibilityState={{ selected: active }}
              onPress={() => setMenuCol(idx)} activeOpacity={0.65}>
              <Text style={[styles.metricOptionText, active && styles.metricOptionTextActive]}>{metricLabel(key)}</Text>
              {active
                ? <Text style={styles.sortArrow}>{sortDesc ? '↓' : '↑'}</Text>
                : <View style={styles.down}><Icon name="chevronRight" size={11} color={theme.mutedText} /></View>}
            </TouchableOpacity>
          );
        })}
        {columns.length < ALL_METRICS.length && (
          <TouchableOpacity style={styles.addMetric} accessibilityRole="button"
            accessibilityLabel={t.activityAddMetric} onPress={addColumn} activeOpacity={0.65}>
            <Text style={styles.addMetricText}>+</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={activities}
        onEndReached={() => loadPage(false)}
        onEndReachedThreshold={2}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.emptyFilter}>
            <Text style={styles.emptyFilterText}>{t.noFilter}</Text>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.listTools}>
            {controls}
            {exporting ? (
              <TouchableOpacity onPress={() => { stopExport.current = true; }} activeOpacity={0.7}>
                <Text style={styles.deleteHint}>{exporting}  ·  {t.exportAllStop}</Text>
              </TouchableOpacity>
            ) : preparing ? <Text style={styles.deleteHint}>{preparing}</Text> : null}
          </View>
        }
        ListFooterComponent={
          loadErr
            ? <ErrorBanner detail={loadErr} context={t.activitiesLoadContext} showPlainDetail
                onRetry={() => { loadPage(false); }} style={{ marginTop: 8 }} />
            : loadingMore
            ? <View style={{ marginVertical: 16, alignItems: 'center' }}><PulseDots /></View>
            : <Text style={styles.deleteHint}>{t.deleteHint}</Text>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.text} />}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[styles.card, viewMode === 'map'
              ? [styles.mapCard, oneBarRow && styles.cardSide]
              : [index === 0 && styles.firstRow, index === activities.length - 1 ? styles.lastRow : styles.rowDivider]]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Map', { activity: item })}
            onLongPress={() => confirmDelete(item)}
            activeOpacity={0.75}
          >
            {viewMode === 'map' && (
              <View style={oneBarRow ? styles.cardThumbSide : undefined}>
                {item.gpx_path
                  ? <ActivityThumbnail gpxPath={item.gpx_path} height={oneBarRow ? 108 : 172} radius={0} sport={item.activity_type} seed={item.date} />
                  : isTrackRemote(item)
                  ? <RemoteActivityThumbnail activityId={item.id} height={oneBarRow ? 108 : 172} radius={0} sport={item.activity_type} seed={item.date} />
                  : <SportPicture sport={item.activity_type} seed={item.date} height={oneBarRow ? 108 : 172} radius={0} />}
              </View>
            )}
            <View style={[styles.cardBody, oneBarRow && viewMode === 'map' && styles.cardBodySide]}>
            <View style={styles.cardRow}>
              {viewMode === 'list' && (
                <View style={styles.activityIcon}>
                  <Icon name={activityIconName(item.activity_type)} size={22} color={theme.primary} />
                </View>
              )}
              <View style={styles.cardLeft}>
                {!!item.activity_type && <Text style={styles.cardType}>{capitalize(item.activity_type)}</Text>}
                <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
                {/* Which device recorded it (2026-08-26, desktop parity). Only imported
                    activities carry one - a move read off the connected watch leaves it empty,
                    because the watch is implied - so this line simply doesn't render for those. */}
                {!!item.device && (
                  <Text style={styles.cardDevice} numberOfLines={1}>{item.device}</Text>
                )}
              </View>
              <Icon name="chevronRight" size={14} color={theme.mutedText} />
            </View>
            {/* The configured metrics, in the watch's own values. A metric the move never
                recorded is skipped (metricValue returns ""), so cards stay tidy. */}
            <View style={styles.metricsRow}>
              {columns.map(key => {
                const val = metricValue(item.metrics, key);
                if (!val) return null;
                return (
                  <View key={key} style={styles.metricCell}>
                    <Text style={styles.metricValue}>{val}</Text>
                    <Text style={styles.metricLabel}>{metricLabel(key)}</Text>
                  </View>
                );
              })}
            </View>
            </View>
          </TouchableOpacity>
        )}
      />

      <ActionMenu visible={filterOpen} title={t.activitySportFilter} onClose={() => setFilterOpen(false)}
        items={filterTypes.map(type => ({
          label: `${type === activeFilter ? '✓  ' : ''}${type === ALL ? t.activityAllSports : capitalize(type)}`,
          onPress: () => setActiveFilter(type),
        }))} />
      {menuCol !== null && (
        <MetricColumnMenu
          visible
          currentKey={columns[menuCol]}
          metrics={metricsAvailableFor(columns, menuCol)}
          canRemove={columns.length > 1}
          onSort={desc => sortByColumn(columns[menuCol], desc)}
          onPick={key => setColumn(menuCol, key)}
          onRemove={() => removeColumn(menuCol)}
          onClose={() => setMenuCol(null)}
        />
      )}
    </View>
  );
}

// ─── Helpers d'affichage ──────────────────────────────────────────────────────

// Real, 2026-08-10 ("change the orange icons to something more aligned with our material
// design and colors") - was raw emoji (🚴🏃🥾...), full-color glyphs that can't be tinted
// and visibly clashed with the rest of this app's monochrome icon language. Maps onto
// Icon.tsx's own small set (cycling/running/walking are new; trail/ski/alpinisme types
// reuse the existing 'mountain' icon rather than drawing a one-off glyph for a handful of
// rarer types; anything else falls back to the existing generic 'activity' icon).
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string): string {
  if (!iso) return t.unknownDate;
  // Day-first dd/MM/yyyy, matching the desktop activity rows (ActivityViewModel.formatDate).
  return fmtDate(iso) || t.unknownDate;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}m${String(s).padStart(2, '0')}`;
}

function formatDist(meters: number): string {
  if (!meters) return '--';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${meters} m`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { minHeight: 44, minWidth: 37, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: v3Spacing.page, paddingTop: 4, width: '100%', maxWidth: 920, alignSelf: 'center', paddingBottom: 28 },
  listTools: { marginBottom: 8 },
  tools: { borderRadius: 13, backgroundColor: t.card, overflow: 'hidden' },
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 8, paddingVertical: 4 },
  sportSelect: { flex: 1, minWidth: 140, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 6 },
  sportLabel: { fontSize: 16, flexShrink: 1, color: t.text, fontWeight: '600' },
  down: { transform: [{ rotate: '90deg' }] },
  metricTools: { paddingHorizontal: 8, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
  metricOption: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  metricOptionActive: { borderBottomColor: t.primary },
  metricOptionText: { fontSize: 13, color: t.mutedText },
  metricOptionTextActive: { color: t.primary, fontWeight: '600' },
  sortArrow: { fontSize: 13, color: t.primary },
  addMetric: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  addMetricText: { fontSize: 21, color: t.primary },
  empty: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.background, padding: 24,
  },
  emptyBox: { width: '100%', maxWidth: 520 },
  skeleton: { padding: 12 },
  emptyHint: { fontSize: 13, color: t.mutedText, textAlign: 'center' },
  emptyFilter: { paddingVertical: 40, alignItems: 'center' },
  emptyFilterText: { color: t.mutedText, fontSize: 14 },
  deleteHint: { fontSize: 11, color: t.mutedText, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  card: { backgroundColor: t.card, overflow: 'hidden' },
  mapCard: { borderRadius: 15, borderCurve: 'continuous', marginBottom: 8 },
  firstRow: { borderTopLeftRadius: 13, borderTopRightRadius: 13 },
  lastRow: { borderBottomLeftRadius: 13, borderBottomRightRadius: 13 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  cardSide: { flexDirection: 'row', alignItems: 'stretch' },
  cardThumbSide: { width: '34%', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.card },
  cardBodySide: { flex: 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  activityIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: t.primary + '15', alignItems: 'center', justifyContent: 'center' },
  cardLeft: { flex: 1 },
  cardDate: { fontSize: 13, color: t.mutedText, marginTop: 2 },
  cardDevice: { fontSize: 12, color: t.mutedText, marginTop: 2 },
  cardType: { fontSize: 17, fontWeight: '700', color: t.text },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 5, marginTop: 8 },
  metricCell: { minWidth: 52 },
  metricValue: { fontSize: 15, color: t.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 11, color: t.mutedText, marginTop: 1 },
});
