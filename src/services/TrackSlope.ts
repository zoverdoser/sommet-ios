import { haversineM } from './race/geo';
import type { RouteCoordinate } from './RoutePointFilter';

const AVL = require('../config/activityViewLogic');
const CFG = require('../config/activity_view.json');

export type TrackPosition = { lat: number; lon: number };
export type ElevationSample = {
  distanceM: number;
  altitude: number | null;
  position: TrackPosition | null;
};

export function activityTrackPalette(isDark: boolean): Record<string, string> {
  const palette = CFG.palette;
  const zones: string[] = isDark ? palette.zones_dark : palette.zones_light;
  return {
    ...Object.fromEntries(zones.map((color, i) => ['z' + (i + 1), color])),
    down: isDark ? palette.downhill_dark : palette.downhill_light,
    back: isDark ? palette.backstroke_dark : palette.backstroke_light,
    casing: isDark ? palette.casing_dark : palette.casing_light,
  };
}

export function trackBandColor(palette: Record<string, string>, bands: object, band: number | null, fallback: string): string {
  return band == null ? fallback : palette[AVL.bandColour(bands, band)] ?? fallback;
}

export function routeElevationSamples(points: RouteCoordinate[]): ElevationSample[] {
  let distanceM = 0;
  return points.map((point, index) => {
    const prev = points[index - 1];
    if (prev) distanceM += haversineM(prev.lat, prev.lon, point.lat, point.lon);
    return { distanceM, altitude: point.alt != null && Number.isFinite(point.alt) ? point.alt : null, position: point };
  });
}

/** Same smoothing window, thresholds, and null bands as the activity map. */
export function slopeBands(samples: ElevationSample[]) {
  return AVL.colourBands(CFG, 'slope', { streams: {
    dist: samples.map(point => point.distanceM / 1000),
    alt: samples.map(point => point.altitude),
  } }, {}, 'other') as { bands: (number | null)[]; colourOf: (band: number) => string };
}

export type ElevationSection = { start: number; end: number; kind: 'climb' | 'descent' | 'flat'; number: number };

export function elevationSections(samples: ElevationSample[], bands: (number | null)[]): ElevationSection[] {
  const sections: ElevationSection[] = [];
  const count = { climb: 0, descent: 0, flat: 0 };
  for (let i = 1; i < samples.length; i++) {
    const band = bands[i];
    if (samples[i - 1].altitude == null || samples[i].altitude == null) continue;
    const kind = band === 0 ? 'descent' : band != null && band > 1 ? 'climb' : 'flat';
    const section = sections[sections.length - 1];
    if (section?.kind === kind && section.end === i - 1) section.end = i;
    else sections.push({ kind, start: i - 1, end: i, number: ++count[kind] });
  }
  return sections;
}

export function nearestElevationSample(samples: ElevationSample[], distanceM: number): number {
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].distanceM < distanceM) low = mid + 1;
    else high = mid;
  }
  for (let left = low - 1, right = low; left >= 0 || right < samples.length;) {
    const i = left >= 0 && (right >= samples.length ||
      distanceM - samples[left].distanceM <= samples[right].distanceM - distanceM) ? left-- : right++;
    if (samples[i].altitude != null) return i;
  }
  return -1;
}
