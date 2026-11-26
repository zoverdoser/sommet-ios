import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import { CompactMetricGrid, CompactMetric } from '../components/CompactMetricGrid';
import { LockableScrollView } from '../components/ScrollLock';
import { RouteMapProfile } from '../components/RouteMapProfile';
import { StatusNote } from '../components/ui/primitives';
import { t } from '../i18n';
import { PendingRoute, routeForPreview } from '../services/NavigationService';
import { getLibraryGpx } from '../services/RouteLibrary';
import type { WatchRoute } from '../services/RouteReader';
import { useV3Theme } from '../theme/v3';

export type RouteDetailParams = { name: string } & (
  { libraryId: string; watchRoute?: never } | { watchRoute: WatchRoute; libraryId?: never }
);
type Detail = Pick<PendingRoute, 'points' | 'distanceM' | 'ascentM' | 'descentM'>;

export default function RouteDetailScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'RouteDetail'>>();
  const theme = useV3Theme();
  const [libraryRoute, setLibraryRoute] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const watch = params.watchRoute;

  useEffect(() => {
    if (!params.libraryId) return;
    let active = true;
    setError('');
    setLibraryRoute(null);
    getLibraryGpx(params.libraryId).then(xml => {
      if (active) setLibraryRoute(routeForPreview(xml, params.name));
    }).catch(e => { if (active) setError(e?.message ?? t.unknownError); });
    return () => { active = false; };
  }, [params.libraryId, params.name]);

  const detail = useMemo<Detail | null>(() => watch ? {
    ...watch, points: watch.points.map(point => ({ lat: point.latitude, lon: point.longitude, alt: point.altitude })),
  } : libraryRoute, [watch, libraryRoute]);

  if (!detail) return <View style={styles.loading}>
    {error ? <StatusNote tone="error" text={error} /> : <ActivityIndicator color={theme.primary} />}
  </View>;

  const metrics: CompactMetric[] = [
    { key: 'distance', label: 'Distance', value: detail.distanceM >= 1000 ? (detail.distanceM / 1000).toFixed(2) : Math.round(detail.distanceM), unit: detail.distanceM >= 1000 ? 'km' : 'm' },
    { key: 'points', label: t.routeGpsPoints, value: detail.points.length },
  ];
  if (detail.points.some(point => point.alt != null) || detail.ascentM > 0 || detail.descentM > 0) {
    metrics.push({ key: 'ascent', label: 'Elevation gain', value: detail.ascentM, unit: 'm' },
      { key: 'descent', label: 'Elevation loss', value: detail.descentM, unit: 'm' });
  }

  return <LockableScrollView contentContainerStyle={styles.content}>
    {detail.points.length > 1 && <RouteMapProfile points={detail.points} />}
    <CompactMetricGrid metrics={metrics} />
  </LockableScrollView>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', padding: 12 },
  content: { paddingHorizontal: 8, paddingBottom: 105, gap: 9 },
});
