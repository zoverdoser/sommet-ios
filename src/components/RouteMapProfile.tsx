import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { TRACK_COLOR } from '../services/MapTile';
import type { RouteCoordinate } from '../services/RoutePointFilter';
import { activityTrackPalette, routeElevationSamples, slopeBands, trackBandColor, TrackPosition } from '../services/TrackSlope';
import { useThemeMode } from '../theme/ThemeModeContext';
import { useV3Theme } from '../theme/v3';
import { RouteElevationProfile } from './RouteElevationProfile';
import { RouteImportMap } from './RouteImportMap';

export function RouteMapProfile({ points, filtered, flushMap = false, showSlopeControl = false }: {
  points: RouteCoordinate[];
  filtered?: RouteCoordinate[] | null;
  flushMap?: boolean;
  showSlopeControl?: boolean;
}) {
  const theme = useV3Theme();
  const { isDark } = useThemeMode();
  const [cursor, setCursor] = useState<TrackPosition | null>(null);
  const [showSlope, setShowSlope] = useState(true);
  const samples = useMemo(() => routeElevationSamples(points), [points]);
  const bands = useMemo(() => slopeBands(samples), [samples]);
  const palette = useMemo(() => activityTrackPalette(isDark), [isDark]);
  const colors = useMemo(() => {
    const fallback = samples.some(sample => sample.altitude != null) ? theme.borderStrong : TRACK_COLOR;
    return bands.bands.slice(1).map(band => trackBandColor(palette, bands, band, fallback));
  }, [bands, palette, samples, theme.borderStrong]);
  return <View style={{ gap: 8 }}>
    <View style={flushMap ? { marginHorizontal: -12 } : undefined}>
      <RouteImportMap points={points} filtered={filtered} cursor={cursor} colors={showSlope ? colors : null} casing={palette.casing}
        slopeEnabled={showSlope} onSlopeChange={showSlopeControl && bands.bands.some(band => band != null) ? setShowSlope : undefined} />
    </View>
    <RouteElevationProfile samples={samples} onSelect={setCursor} />
  </View>;
}
