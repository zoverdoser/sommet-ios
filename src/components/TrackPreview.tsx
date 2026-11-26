import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Text, StyleSheet, LayoutChangeEvent, PanResponder, GestureResponderEvent, TouchableOpacity } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { useV3Theme } from '../theme/v3';
import { getMapProvider, MapProvider } from '../services/MapProviderService';
import { fitBoundsMosaic, centeredPointMosaic, tileUrl, TileMosaic, TRACK_COLOR, TILE_HEADERS } from '../services/MapTile';
import { t } from '../i18n';
import { MapView as PanZoomView, centredOn, layoutView, panView, viewFromMosaic, zoomView } from '../services/MapPanZoom';
import { useScrollLock } from './ScrollLock';

// Previews let a quick swipe scroll the page, and a hold grabs the map.
// The POI map uses direct dragging and double-tap zoom.
const HOLD_MS = 300;
const SLOP = 10;
const DOUBLE_TAP_MS = 400;

// v3.0 UI port, revised 2026-08-10 ("apply the same fix as we did on the desktop, centering
// the gpx for POIs and Routes on the maps. for routes allow the cards to have different
// height to allow gpx to completely fit and show") - desktop's real fix (MapView.qml's own
// header comment) was fitting AND centering on the track's real bounding box, at whatever
// aspect ratio it actually has, instead of a fixed guessed zoom around an averaged center.
// The previous version here (bestSingleTile) picked whichever single fixed-size grid tile
// happened to contain every point - not centered, and cropped to a square regardless of the
// route's real shape. This uses MapTile.ts's own fitBoundsMosaic/centeredPointMosaic
// instead, stitching however many tiles the real bounding box needs.
//
// Two-phase render: the real display width isn't known until after the first layout pass
// (this box is always width:'100%' of whatever row/card it's in), so the first render is
// just a plain placeholder that measures itself; the real mosaic (which needs that width to
// pick a zoom/scale) renders on the next pass.
export function TrackPreview({
  points, height = 100, markerOnly = false, variableHeight = false, multiMarker = false,
  interactive = true, panOnDrag = false, doubleTapZoom = false, fallbackCenter, selectedIndex, onMarkerTap, focusOn,
  draft, onDraftMove, draftGlyph, onlyPointZoom = 6, controls = false,
  openAt, here, onShowAll, onShowHere, radius = 10, trackWidth = 3.5,
}: {
  radius?: number;
  trackWidth?: number;
  // The POIs screen (André, 2026-11-23: one map to look at the POIs and to add one):
  // `draft` is the new POI's orange pin, on top of the others; a finger on it drags it at once
  // and `onDraftMove` gets the place. `draftGlyph` is its type's icon.
  draft?: { lat: number; lon: number } | null;
  onDraftMove?: (lat: number, lon: number) => void;
  draftGlyph?: string;
  // multiMarker with one point: how close to show it (6 = the country, for places visited).
  onlyPointZoom?: number;
  // The + / - / All buttons of the desktop's map.
  controls?: boolean;
  // Where the map opens instead of fitting its points (the POIs map opens where the device is).
  // A new `key` goes back there; null fits the points.
  openAt?: { lat: number; lon: number; zoom: number; key: number } | null;
  // The device's own place, drawn as a blue dot.
  here?: { lat: number; lon: number } | null;
  // With `controls`: the All button, and the button that goes back to `openAt`.
  onShowAll?: () => void;
  onShowHere?: () => void;
  // multiMarker only (the POIs screen's one map, André 2026-11-22): the marker at
  // `selectedIndex` (an index in `points`) is drawn filled and on top; a tap on a marker says
  // which one; `focusOn` moves the view to a point (a POI picked in the list) and, set back to
  // null, shows every marker again. `key` changes for each pick, so the same point picked
  // twice still moves the view.
  selectedIndex?: number;
  onMarkerTap?: (index: number) => void;
  focusOn?: { lat: number; lon: number; key: number } | null;
  // No point yet (the POI form before a place is chosen): show the map here, without a pin.
  fallbackCenter?: { lat: number; lon: number; zoom?: number };
  // false: a fixed picture (activity cards, where a long-press already deletes the move).
  interactive?: boolean;
  panOnDrag?: boolean;
  doubleTapZoom?: boolean;
  points: { lat: number; lon: number; name?: string }[];
  height?: number;
  markerOnly?: boolean;
  // Real, 2026-08-10 ("for routes allow the cards to have different height to allow gpx to
  // completely fit and show") - default false: every other caller (POIs, activities) is a
  // uniform grid/list where a consistent cell size matters more than showing the shape at
  // 100% - RouteScreen's own on-watch list is the one real opt-in.
  variableHeight?: boolean;
  // Real, 2026-08-10 ("desktop version has more functions... like the map with locations")
  // - Kailash's visited-places list is a set of independent points, not a connected track;
  // the existing hasMultiPoint path (below) always draws a polyline through every point in
  // array order, which would draw nonsense lines between unrelated cities. This mode fits
  // the same bounding box but draws each point as its own marker instead, no polyline.
  multiMarker?: boolean;
}) {
  const theme = useV3Theme();
  const [provider, setProvider] = useState<MapProvider>('cyclosm');
  // Real bug, found live (2026-08-10) - a plain useEffect([]) only fetches the persisted
  // provider once, on mount. React Navigation's native-stack keeps RouteScreen/PoiScreen
  // mounted in the background for back-navigation, so a TrackPreview that mounted before a
  // Settings change kept showing the OLD provider forever after - it never re-rendered to
  // notice. useFocusEffect re-checks every time the screen holding this component becomes
  // visible again, same pattern RouteScreen.tsx's own loadOnWatch() already uses.
  useFocusEffect(useCallback(() => { getMapProvider().then(setProvider); }, []));
  const [boxWidth, setBoxWidth] = useState<number | null>(null);

  // ---- pan and pinch (null view = the fitted picture, until the first grab) ----
  const scrollLock = useScrollLock();
  const [view, setView] = useState<PanZoomView | null>(null);
  const [grabbed, setGrabbed] = useState(false);
  const viewRef = useRef<PanZoomView | null>(null);
  const fittedRef = useRef<PanZoomView | null>(null);
  const layoutRef = useRef<ReturnType<typeof layoutView> | null>(null);
  const g = useRef({ armed: false, locked: false, timer: null as ReturnType<typeof setTimeout> | null,
                     x0: 0, y0: 0, t0: 0, moved: false, lastX: 0, lastY: 0,
                     pinchD0: 0, pinchZ0: 0, lastTapT: 0, lastTapX: 0, lastTapY: 0, onDraft: false, onCtrl: false }).current;
  const draftMoveRef = useRef(onDraftMove);
  draftMoveRef.current = onDraftMove;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pointsKey = points.map(p => `${p.lat},${p.lon}`).join(';');
  const openKey = openAt?.key ?? -1;
  useEffect(() => { viewRef.current = null; setView(null); }, [pointsKey, openKey]);
  const setV = (v: PanZoomView) => { viewRef.current = v; setView(v); };
  // Where each marker is drawn now, with its index in `points`, for onMarkerTap.
  const markersRef = useRef<{ x: number; y: number; index: number }[]>([]);
  const focusKey = focusOn ? focusOn.key : 0;
  const hadFocus = useRef(false);
  useEffect(() => {
    if (focusOn) {
      const base = viewRef.current ?? fittedRef.current;
      if (base) { hadFocus.current = true; setV(centredOn(base, focusOn.lat, focusOn.lon, 12)); }
    } else if (hadFocus.current) {
      hadFocus.current = false; viewRef.current = null; setView(null);   // every marker again
    }
  }, [focusKey, pointsKey, openKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const zoomStep = (dz: number, anchor?: { x: number; y: number }) => {
    const v = viewRef.current ?? fittedRef.current;
    if (!v) return;
    const fromCentre = anchor && boxWidth ? { x: anchor.x - boxWidth / 2, y: anchor.y - height / 2 } : undefined;
    setV(zoomView(v, v.zf, 2 ** dz, fromCentre));
  };
  const fitAgain = () => { viewRef.current = null; setView(null); hadFocus.current = false; };
  const release = () => {
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    g.armed = false; g.pinchD0 = 0; g.onDraft = false;
    if (g.locked) { g.locked = false; scrollLock.unlock(); }
    setGrabbed(false);
  };
  const lockPage = () => {
    if (!g.locked) { g.locked = true; scrollLock.lock(); }
  };
  const grab = () => {
    g.armed = true;
    lockPage();
    if (!viewRef.current && fittedRef.current) setV(fittedRef.current);
    setGrabbed(true);
  };
  useEffect(() => () => { if (g.timer) clearTimeout(g.timer); if (g.locked) scrollLock.unlock(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const spread = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    return ts.length < 2 ? 0 : Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => g.armed,
    onMoveShouldSetPanResponderCapture: (_e, gs) => g.armed
      || (panOnDrag && g.locked && !g.onCtrl && Math.hypot(gs.dx, gs.dy) > SLOP),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_e, gs) => {
      if (!g.armed) grab();
      g.moved = true;
      g.lastTapT = 0;
      g.lastX = gs.moveX; g.lastY = gs.moveY;
    },
    onPanResponderMove: (e, gs) => {
      if (g.onDraft) {
        // The pin's foot is under the finger's point; the map stays where it is.
        const at = layoutRef.current?.latLonAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
        if (at) draftMoveRef.current?.(at.lat, at.lon);
        return;
      }
      const v = viewRef.current; if (!v) return;
      const d = spread(e);
      if (d > 0) {
        if (!g.pinchD0) { g.pinchD0 = d; g.pinchZ0 = v.zf; }
        setV(zoomView(v, g.pinchZ0, d / g.pinchD0));
      } else {
        g.pinchD0 = 0;
        setV(panView(v, gs.moveX - g.lastX, gs.moveY - g.lastY));
      }
      g.lastX = gs.moveX; g.lastY = gs.moveY;
    },
    onPanResponderRelease: () => release(),
    onPanResponderTerminate: () => release(),
  }), [panOnDrag]);   // eslint-disable-line react-hooks/exhaustive-deps
  const touchHandlers = interactive ? {
    onTouchStart: (e: GestureResponderEvent) => {
      if (g.onCtrl) return;                          // a finger on + / - / All is not on the map
      const ts = e.nativeEvent.touches;
      if (ts.length >= 2) { g.onDraft = false; g.lastTapT = 0; grab(); return; }
      g.x0 = e.nativeEvent.pageX; g.y0 = e.nativeEvent.pageY; g.t0 = e.nativeEvent.timestamp; g.moved = false;
      const dr = draftRef.current, lay = layoutRef.current;
      if (dr && lay) {
        const at = lay.project(dr.lat, dr.lon);
        if (Math.hypot(at.x - e.nativeEvent.locationX, at.y - e.nativeEvent.locationY) < 34) {
          g.onDraft = true;
          if (!panOnDrag) { grab(); return; }
        }
      }
      if (panOnDrag) { lockPage(); return; }
      if (g.timer) clearTimeout(g.timer);
      g.timer = setTimeout(() => { g.timer = null; if (!g.moved) grab(); }, HOLD_MS);
    },
    onTouchMove: (e: GestureResponderEvent) => {
      if (g.onCtrl) return;
      if (Math.hypot(e.nativeEvent.pageX - g.x0, e.nativeEvent.pageY - g.y0) > SLOP) {
        g.moved = true;
        if (!g.armed && g.timer) { clearTimeout(g.timer); g.timer = null; }   // a swipe: the page scrolls
      }
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      if (e.nativeEvent.touches.length > 0) return;
      if (g.onCtrl) { g.onCtrl = false; return; }
      const wasArmed = g.armed;
      const { timestamp, locationX: x, locationY: y } = e.nativeEvent;
      const quickTap = !g.moved && timestamp - g.t0 < HOLD_MS;
      release();
      if (wasArmed || !quickTap) { g.lastTapT = 0; return; }
      if (doubleTapZoom) {
        if (g.lastTapT && g.t0 - g.lastTapT < DOUBLE_TAP_MS && Math.hypot(x - g.lastTapX, y - g.lastTapY) < 40) {
          g.lastTapT = 0;
          zoomStep(1, { x, y });
          return;
        }
        g.lastTapT = timestamp; g.lastTapX = x; g.lastTapY = y;
      }
      if (onMarkerTap) {
        // The nearest marker under the finger (within a fingertip, 30 px).
        let best = -1, bestD = 30;
        for (const m of markersRef.current) {
          const d = Math.hypot(m.x - x, m.y - y);
          if (d < bestD) { bestD = d; best = m.index; }
        }
        if (best >= 0) onMarkerTap(best);
      }
    },
    onTouchCancel: () => { g.onCtrl = false; g.lastTapT = 0; release(); },
  } : {};

  // Real bug, found live (2026-08-10) - some real synced activities carry a garbage GPS fix
  // (an out-of-range or non-finite lat/lon - the watch's own GPS chip emitting a value
  // before it has a real lock). Math.tan()/Math.log() on an out-of-range latitude produces
  // Infinity/NaN, which silently poisons every tile position downstream with no crash and
  // no visible error - RN just renders nothing. Same "skip the bad one, don't throw" spirit
  // PoiService.ts's own SBEM entry parsing already uses for malformed watch data.
  const isValid = (p: { lat: number; lon: number }) =>
    Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
    Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180;
  const validPoints = points.filter(isValid);
  // Each valid point's index in `points` (selectedIndex and onMarkerTap count in `points`).
  const validIndex = points.map((p, i) => (isValid(p) ? i : -1)).filter(i => i >= 0);

  const hasMultiMarker = multiMarker && validPoints.length >= 1;
  const hasMultiPoint = !markerOnly && !multiMarker && validPoints.length >= 2;
  const hasSinglePoint = !multiMarker && (markerOnly || validPoints.length === 1) && validPoints.length >= 1;
  const hasLabels = hasMultiMarker && validPoints.some(p => p.name);

  // Real, 2026-08-10 ("for data without gps data, please do a nice mappyish image saying no
  // data, soft color to not hurt the rest") - was a flat, empty box; a real placeholder now,
  // the same map-shaped visual language (rounded card, a faint terrain-line glyph) instead
  // of just nothing.
  const centerOnly = !hasMultiPoint && !hasSinglePoint && !hasMultiMarker && !!fallbackCenter
    && Number.isFinite(fallbackCenter.lat) && Number.isFinite(fallbackCenter.lon);
  if (!hasMultiPoint && !hasSinglePoint && !hasMultiMarker && !centerOnly) {
    return (
      <View style={[styles.box, styles.noDataBox, { height, backgroundColor: theme.background, borderRadius: radius }]}>
        <Svg width={30} height={30} viewBox="0 0 24 24">
          <Circle cx={17} cy={7} r={2.6} stroke={theme.mutedText} strokeWidth={1.3} fill="none" opacity={0.45} />
          <Polyline
            points="3,19 8,11 12,14 20,4" fill="none" stroke={theme.mutedText} strokeWidth={1.3}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.3}
          />
        </Svg>
        <Text style={[styles.noDataText, { color: theme.mutedText }]}>{t.trackPreviewNoData}</Text>
      </View>
    );
  }

  // Re-measured on every layout, not only the first: turning the tablet changes the width, and a
  // mosaic fitted to the old width left the track off-centre and cut at the edge (2026-11-12).
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== boxWidth) setBoxWidth(w);
  };

  if (boxWidth === null) {
    return <View style={[styles.box, { height, backgroundColor: theme.background, borderRadius: radius }]} onLayout={onLayout} />;
  }

  const mosaic: TileMosaic = openAt
    ? centeredPointMosaic(openAt.lat, openAt.lon, boxWidth, height, openAt.zoom)
    : centerOnly
    ? centeredPointMosaic(fallbackCenter!.lat, fallbackCenter!.lon, boxWidth, height, fallbackCenter!.zoom ?? 13)
    : hasSinglePoint
    ? centeredPointMosaic(validPoints[0].lat, validPoints[0].lon, boxWidth, height, 15)
    : hasMultiMarker && validPoints.length === 1
    ? centeredPointMosaic(validPoints[0].lat, validPoints[0].lon, boxWidth, height, onlyPointZoom)
    : fitBoundsMosaic(validPoints, boxWidth, {
        targetHeight: variableHeight ? undefined : height,
        ...(hasLabels ? { padding: 54, maxZoom: 16 } : {}),
      });

  fittedRef.current = viewFromMosaic(mosaic);
  // Once grabbed, the owner's view; before that, the fitted picture (the same view, to the pixel).
  const lay = layoutView(view ?? fittedRef.current, mosaic.contentWidth, mosaic.contentHeight);
  layoutRef.current = lay;
  const drawn = view ? { z: lay.z, tiles: lay.tiles, project: lay.project } : mosaic;
  const projected = validPoints.map(p => drawn.project(p.lat, p.lon));
  markersRef.current = multiMarker ? projected.map((p, i) => ({ x: p.x, y: p.y, index: validIndex[i] })) : [];
  const selectedAt = selectedIndex == null ? -1 : validIndex.indexOf(selectedIndex);
  const draftAt = draft && isValid(draft) ? drawn.project(draft.lat, draft.lon) : null;
  const hereAt = here && isValid(here) ? drawn.project(here.lat, here.lon) : null;

  return (
    <View style={[styles.box, { height: mosaic.contentHeight, backgroundColor: theme.background, borderRadius: radius }]} onLayout={onLayout}
          {...touchHandlers} {...(interactive ? responder.panHandlers : {})}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drawn.tiles.map(tile => (
        <Image
          key={'key' in tile ? (tile as { key: string }).key : `${drawn.z}-${tile.x}-${tile.y}`}
          source={{ uri: tileUrl(provider, drawn.z, tile.x, tile.y), headers: TILE_HEADERS }}
          style={{ position: 'absolute', left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
        />
      ))}
      <Svg width={mosaic.contentWidth} height={mosaic.contentHeight} style={StyleSheet.absoluteFill}>
        {hereAt && (
          <>
            <Circle cx={hereAt.x} cy={hereAt.y} r={16} fill={HERE_COLOR} opacity={0.2} />
            <Circle cx={hereAt.x} cy={hereAt.y} r={7} fill={HERE_COLOR} stroke="#ffffff" strokeWidth={2.5} />
          </>
        )}
        {centerOnly ? null : hasMultiMarker ? (
          <>
            {projected.map((p, i) => (i === selectedAt ? null : (
              <React.Fragment key={i}>
                <Circle cx={p.x} cy={p.y} r={12} fill={TRACK_COLOR} opacity={0.18} />
                <Circle cx={p.x} cy={p.y} r={7} fill="#ffffff" stroke={TRACK_COLOR} strokeWidth={2} />
                <Circle cx={p.x} cy={p.y} r={3} fill={TRACK_COLOR} />
              </React.Fragment>
            )))}
            {/* The picked one: filled, larger, drawn last so no other marker covers it. */}
            {selectedAt >= 0 && (
              <>
                <Circle cx={projected[selectedAt].x} cy={projected[selectedAt].y} r={17} fill={TRACK_COLOR} opacity={0.22} />
                <Circle cx={projected[selectedAt].x} cy={projected[selectedAt].y} r={10} fill={TRACK_COLOR} stroke="#ffffff" strokeWidth={2.5} />
                <Circle cx={projected[selectedAt].x} cy={projected[selectedAt].y} r={3.5} fill="#ffffff" />
              </>
            )}
          </>
        ) : hasSinglePoint ? (
          // Real, 2026-08-10 ("POI: make the marker of a color better visible", then "it is
          // grey, not very visible" once theme.primary turned out to be Android's own muted
          // slate grey) - a white disc (visible against any tile color) with a TRACK_COLOR
          // ring and center dot, TRACK_COLOR being the same fixed, map-specific teal used
          // for the route line below (see MapTile.ts's own header comment on why this is
          // fixed, not theme.primary).
          <>
            <Circle cx={projected[0].x} cy={projected[0].y} r={16} fill={TRACK_COLOR} opacity={0.18} />
            <Circle cx={projected[0].x} cy={projected[0].y} r={10} fill="#ffffff" stroke={TRACK_COLOR} strokeWidth={2.5} />
            <Circle cx={projected[0].x} cy={projected[0].y} r={4} fill={TRACK_COLOR} />
          </>
        ) : (
          <>
            <Polyline
              points={projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill="none" stroke="#ffffff" strokeWidth={trackWidth + 2.5} strokeLinecap="round" strokeLinejoin="round"
            />
            <Polyline
              points={projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill="none" stroke={TRACK_COLOR} strokeWidth={trackWidth} strokeLinecap="round" strokeLinejoin="round"
            />
          </>
        )}
        {draftAt && (
          <>
            <Circle cx={draftAt.x} cy={draftAt.y} r={22} fill={DRAFT_COLOR} opacity={0.2} />
            <Circle cx={draftAt.x} cy={draftAt.y} r={15} fill={DRAFT_COLOR} stroke="#ffffff" strokeWidth={2.5} />
          </>
        )}
      </Svg>
      {hasLabels && projected.map((p, i) => {
        const name = validPoints[i].name;
        if (!name) return null;
        return (
          <View key={validIndex[i]} style={[styles.markerLabelPosition, { left: p.x - 52, top: p.y + 12 }]}>
            <Text style={styles.markerLabel} numberOfLines={2}>{name}</Text>
          </View>
        );
      })}
      {draftAt && !!draftGlyph && (
        <Text style={[styles.draftGlyph, { left: draftAt.x - 15, top: draftAt.y - 11 }]}>{draftGlyph}</Text>
      )}
      {grabbed && <View style={[StyleSheet.absoluteFill, styles.grabbed]} />}
      </View>
      {controls && (
        <View style={styles.controls} onTouchStart={() => { g.onCtrl = true; }}>
          <TouchableOpacity style={styles.ctrl} onPress={() => zoomStep(1)} accessibilityRole="button" accessibilityLabel="Zoom in">
            <Text style={styles.ctrlText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrl} onPress={() => zoomStep(-1)} accessibilityRole="button" accessibilityLabel="Zoom out">
            <Text style={styles.ctrlText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrl} onPress={() => { fitAgain(); onShowAll?.(); }}
            accessibilityRole="button" accessibilityLabel="Show all POIs">
            <Text style={styles.ctrlAll}>All</Text>
          </TouchableOpacity>
          {onShowHere && (
            <TouchableOpacity style={styles.ctrl} onPress={() => { fitAgain(); onShowHere(); }}
              accessibilityRole="button" accessibilityLabel="Go to where I am">
              {/* A target, drawn: the app's icon font holds only the glyphs it uses. */}
              <Svg width={20} height={20} viewBox="0 0 20 20">
                <Circle cx={10} cy={10} r={5.5} fill="none" stroke="#333333" strokeWidth={2} />
                <Circle cx={10} cy={10} r={2} fill="#333333" />
                <Polyline points="10,1 10,5" stroke="#333333" strokeWidth={2} />
                <Polyline points="10,15 10,19" stroke="#333333" strokeWidth={2} />
                <Polyline points="1,10 5,10" stroke="#333333" strokeWidth={2} />
                <Polyline points="15,10 19,10" stroke="#333333" strokeWidth={2} />
              </Svg>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const DRAFT_COLOR = '#C4622D';    // the new POI's pin, as on the desktop
const HERE_COLOR = '#2F7FE0';     // the device's own place

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: 12, overflow: 'hidden' },
  controls: { position: 'absolute', right: 8, top: 8, gap: 4 },
  ctrl: { width: 34, height: 34, borderRadius: 4, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center' },
  ctrlText: { fontSize: 20, fontWeight: '700', color: '#333333', lineHeight: 24 },
  ctrlAll: { fontSize: 11, fontWeight: '700', color: '#333333' },
  markerLabelPosition: { position: 'absolute', width: 104, alignItems: 'center' },
  markerLabel: { color: '#17251F', backgroundColor: '#FFFFFFEB', borderRadius: 4, overflow: 'hidden',
                 fontSize: 10, fontWeight: '600', paddingHorizontal: 4, paddingVertical: 1, textAlign: 'center' },
  draftGlyph: { position: 'absolute', width: 30, height: 22, textAlign: 'center', fontFamily: 'MaterialSymbolsRounded',
                fontSize: 18, lineHeight: 22, color: '#ffffff' },
  noDataBox: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  noDataText: { fontSize: 11, fontWeight: '600' },
  grabbed: { borderWidth: 2, borderColor: TRACK_COLOR, borderRadius: 12 },
});
