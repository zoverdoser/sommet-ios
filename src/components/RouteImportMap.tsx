import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { getMapProvider, MapProvider } from '../services/MapProviderService';
import { mapTileLayersJs } from '../services/MapHtml';
import { TILE_CACHE_DIR_URI } from '../services/TileCache';
import { LEAFLET_STYLE_TAG, LEAFLET_INJECT_JS } from '../services/leafletInline';
import { mapWebViewFileProps, writeMapPage } from '../services/mapWebView';
import { RouteCoordinate } from '../services/RoutePointFilter';
import { useV3Theme } from '../theme/v3';
import { useScrollLock } from './ScrollLock';
import { TRACK_COLOR } from '../services/MapTile';
import { MapSlopeControl } from './MapSlopeControl';
import type { TrackPosition } from '../services/TrackSlope';

function mapHtml(provider: MapProvider) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
${LEAFLET_STYLE_TAG}
<script>${LEAFLET_INJECT_JS}</script>
<style>html,body,#map{height:100%;width:100%;margin:0;background:#222934}#map{touch-action:none}</style>
</head><body><div id="map"></div><script>
const map = L.map('map', { zoomControl: false, doubleClickZoom: false });
${mapTileLayersJs(provider, TILE_CACHE_DIR_URI)}
const original = L.layerGroup().addTo(map);
const overlay = L.polyline([], { color: '#FFFFFF', weight: 1.6, interactive: false }).addTo(map);
let bounds, cursor, points = [];
window.setRouteCursor = position => {
  if (cursor) { map.removeLayer(cursor); cursor = null; }
  if (position) cursor = L.circleMarker(position, { radius: 6, color: '#ffffff', weight: 2, fillColor: '#3887D8', fillOpacity: 1, interactive: false }).addTo(map);
};
window.fitImportedRoute = () => { if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [23, 23], maxZoom: 17 }); };
window.zoomImportedRoute = delta => map.setZoom(map.getZoom() + delta);
window.setImportedRoute = coordinates => {
  points = coordinates;
  bounds = L.latLngBounds(points);
  window.fitImportedRoute();
};
window.colorImportedRoute = (colors, casing) => {
  original.clearLayers();
  L.polyline(points, { color: casing, weight: 4, interactive: false }).addTo(original);
  const segments = new Map();
  for (let i = 1; i < points.length; i++) {
    const color = colors?.[i - 1] ?? '${TRACK_COLOR}';
    if (!segments.has(color)) segments.set(color, []);
    segments.get(color).push([points[i - 1], points[i]]);
  }
  for (const [color, lines] of segments) {
    L.polyline(lines, { color, weight: 2.7, interactive: false, smoothFactor: 0 }).addTo(original);
  }
  overlay.bringToFront();
  if (cursor) cursor.bringToFront();
};
window.drawFilteredRoute = points => overlay.setLatLngs(points).bringToFront();
const view = map.getContainer();
const post = message => window.ReactNativeWebView.postMessage(message);
let start, previous, lastTouchZoom = 0;
view.addEventListener('touchstart', event => {
  post('lock');
  if (event.touches.length !== 1) {
    start = previous = null;
    return;
  }
  const touch = event.touches[0];
  start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
}, { passive: true });
view.addEventListener('touchmove', event => {
  post('lock');
  const touch = event.touches[0];
  if (start && (event.touches.length !== 1 || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12)) {
    start = previous = null;
  }
}, { passive: true });
view.addEventListener('touchend', event => {
  if (event.touches.length) return;
  post('unlock');
  const tap = start;
  start = null;
  const endedAt = Date.now();
  if (!tap || endedAt - tap.time > 300) { previous = null; return; }
  if (previous && tap.time - previous.endedAt < 400 && Math.hypot(tap.x - previous.x, tap.y - previous.y) < 28) {
    lastTouchZoom = endedAt;
    previous = null;
    map.setZoomAround(map.mouseEventToContainerPoint({ clientX: tap.x, clientY: tap.y }), map.getZoom() + 1);
  } else {
    previous = { ...tap, endedAt };
  }
}, { passive: true });
view.addEventListener('touchcancel', event => {
  start = previous = null;
  if (!event.touches.length) post('unlock');
}, { passive: true });
map.on('dblclick', event => {
  if (Date.now() - lastTouchZoom > 500) map.setZoomAround(event.containerPoint, map.getZoom() + 1);
});
</script></body></html>`;
}

const coords = (points: RouteCoordinate[]) => points.map(point => [point.lat, point.lon]);

export function RouteImportMap({ points, colors, casing, filtered, cursor, height = 280, slopeEnabled = true, onSlopeChange }: {
  points: RouteCoordinate[];
  colors: string[] | null;
  casing: string;
  filtered?: RouteCoordinate[] | null;
  cursor?: TrackPosition | null;
  height?: number;
  slopeEnabled?: boolean;
  onSlopeChange?: (enabled: boolean) => void;
}) {
  const theme = useV3Theme();
  const lock = useScrollLock();
  const held = useRef(false);
  const web = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const source = useMemo(() => uri ? { uri } : null, [uri]);

  const unlock = useCallback(() => {
    if (held.current) {
      held.current = false;
      lock.unlock();
    }
  }, [lock]);
  useFocusEffect(useCallback(() => {
    let active = true;
    getMapProvider().then(provider => writeMapPage(mapHtml(provider), `sommet_route_import_${provider}.html`))
      .then(next => { if (active) setUri(next); }).catch(() => {});
    return () => { active = false; unlock(); };
  }, [unlock]));

  useEffect(() => {
    if (ready) {
      web.current?.injectJavaScript(`window.setImportedRoute(${JSON.stringify(coords(points))});true;`);
    }
  }, [ready, points]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.colorImportedRoute(${JSON.stringify(colors)},${JSON.stringify(casing)});true;`);
  }, [ready, points, colors, casing]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.drawFilteredRoute(${JSON.stringify(coords(filtered ?? []))});true;`);
  }, [ready, points, filtered]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.setRouteCursor(${JSON.stringify(cursor ? [cursor.lat, cursor.lon] : null)});true;`);
  }, [ready, cursor, points, filtered]);

  return (
    <View style={[styles.frame, { height, backgroundColor: theme.surface }]}>
      {source && <WebView
        ref={web}
        source={source}
        originWhitelist={['file://*']}
        style={[styles.map, { backgroundColor: theme.surface }]}
        {...mapWebViewFileProps()}
        scrollEnabled={false}
        bounces={false}
        userAgent="Sommet/2.0"
        onLoadStart={() => setReady(false)}
        onLoad={() => setReady(true)}
        onMessage={event => {
          const message = event.nativeEvent.data;
          if (message === 'lock' && !held.current) { held.current = true; lock.lock(); }
          if (message === 'unlock') unlock();
        }}
        onError={unlock}
      />}
      {onSlopeChange && <MapSlopeControl value={slopeEnabled} onValueChange={onSlopeChange} />}
      <View style={styles.controls}>
        {[
          { label: 'Zoom in', text: '+', script: 'window.zoomImportedRoute(1)' },
          { label: 'Zoom out', text: '−', script: 'window.zoomImportedRoute(-1)' },
          { label: 'Fit route', text: 'All', script: 'window.fitImportedRoute()' },
        ].map(control => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={control.label} key={control.label}
            onPress={() => web.current?.injectJavaScript(`${control.script};true;`)}
            style={[styles.control, { backgroundColor: theme.card }]}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: control.text === 'All' ? 12 : 20 }}>{control.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  map: { flex: 1 },
  controls: { position: 'absolute', top: 8, left: 8, gap: 4 },
  control: { width: 36, height: 36, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
});
