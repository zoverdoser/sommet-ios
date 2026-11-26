import { filterRoutePoints, routeSpacing } from '../RoutePointFilter';

const point = (meters: number, alt: number | null = 0) => ({ lat: meters / 111195, lon: 0, alt });

test('filters against the last retained point and leaves space before the original finish', () => {
  const points = [point(0), point(25), point(60), point(100), point(121), point(164)];
  expect(filterRoutePoints(points, 50)).toEqual([points[0], points[2], points[5]]);
  expect(filterRoutePoints(points, 1)).toEqual(points);
  expect(filterRoutePoints(points, 1000)).toEqual([points[0], points[5]]);
  expect(points).toHaveLength(6);
});

test('keeps earlier points near the finish when the route passes it more than once', () => {
  const points = [point(0), point(110), point(200), point(160), point(120)];
  expect(filterRoutePoints(points, 50)).toEqual([points[0], points[1], points[2], points[4]]);
});

test('clamps the slider to a tenth of a metre through 100 m in 0.1 m steps', () => {
  expect([0, 0.1, 0.18, 1, 30.84, 100, 100.1].map(routeSpacing)).toEqual([0.1, 0.1, 0.2, 1, 30.8, 100, 100]);
});
