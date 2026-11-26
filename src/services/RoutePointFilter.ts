import { haversineM } from './race/geo';

export interface RouteCoordinate {
  lat: number;
  lon: number;
  alt: number | null;
}

export const MIN_ROUTE_SPACING = 0.1;
export const ROUTE_SPACING_STEP = 0.1;
export const MAX_ROUTE_SPACING = 100;
export const DEFAULT_ROUTE_SPACING = 30;

export function routeSpacing(value: number): number {
  return Math.max(MIN_ROUTE_SPACING, Math.min(MAX_ROUTE_SPACING, Math.round(value * 10) / 10));
}

const distance = (a: RouteCoordinate, b: RouteCoordinate) => haversineM(a.lat, a.lon, b.lat, b.lon);

/** Keep both endpoints, even on routes shorter than the requested spacing. */
export function filterRoutePoints<T extends RouteCoordinate>(points: T[], spacing: number): T[] {
  if (points.length <= 2) return points;
  const minimum = routeSpacing(spacing);
  const end = points[points.length - 1];
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const candidate = points[i];
    if (distance(result[result.length - 1], candidate) >= minimum) {
      result.push(candidate);
    }
  }
  while (result.length > 1 && distance(result[result.length - 1], end) < minimum) result.pop();
  result.push(end);
  return result;
}
