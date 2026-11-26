import { activityTrackPalette, elevationSections, nearestElevationSample, routeElevationSamples, slopeBands, trackBandColor } from '../TrackSlope';

const AVL = require('../../config/activityViewLogic');
const CFG = require('../../config/activity_view.json');

test('route and activity use the same slope bands and theme palette', () => {
  const samples = routeElevationSamples([0, 50, 100, 100, 30, 0, null].map((alt, i) => ({
    lat: i * 0.001, lon: 0, alt,
  })));
  const bands = slopeBands(samples);
  const existing = AVL.colourBands(CFG, 'slope', { streams: {
    dist: samples.map(sample => sample.distanceM / 1000),
    alt: samples.map(sample => sample.altitude),
  } }, {}, 'hike');
  expect(bands.bands).toEqual(existing.bands);
  expect(bands.bands).toEqual([5, 5, 2, 0, null, null, null]);
  const palette = activityTrackPalette(true);
  expect(trackBandColor(palette, bands, 5, '#000')).toBe(CFG.palette.zones_dark[4]);
  expect(trackBandColor(palette, bands, 0, '#000')).toBe(CFG.palette.downhill_dark);
  expect(trackBandColor(palette, bands, null, '#000')).toBe('#000');
});

test('scrubbing selects the nearest measured elevation and gaps break sections', () => {
  const samples = [0, 20, null, 27, 40, 100].map((altitude, i) => ({
    distanceM: i * 20, altitude, position: null,
  }));
  expect(nearestElevationSample(samples, 38)).toBe(1);
  expect(nearestElevationSample(samples, 45)).toBe(3);
  expect(nearestElevationSample([], 45)).toBe(-1);
  expect(elevationSections(samples, [4, 4, null, 2, 2, 5])).toEqual([
    { start: 0, end: 1, kind: 'climb', number: 1 },
    { start: 3, end: 5, kind: 'climb', number: 2 },
  ]);
});
