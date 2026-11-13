/**
 * Screenshot and map geometry utilities for the Tarkov companion.
 * Independent implementation using public filename observations and map metadata.
 * Source references:
 * https://github.com/the-hideout/TarkovMonitor/blob/9cb76a01d554b990d54aefa3a90f3c97c5aedd0c/TarkovMonitor/GameWatcher.cs
 * https://github.com/the-hideout/tarkov-dev/blob/9fd29f7f16e5d5408831d9be48274dcb8862de1d/src/pages/map/index.jsx
 * https://blog.devkey.jp/en/posts/escape-from-tarkov-screenshot-location/
 */

export const MAP_CONFIG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';
export const DEFAULT_MAPS_SOURCE = MAP_CONFIG_URL;

const NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const CAPTURE = () => `(${NUMBER_SOURCE})`;
const FILENAME_PATTERN = new RegExp(
  '^(\\d{4}-\\d{2}-\\d{2}\\[\\d{2}-\\d{2}\\])_?' +
  [CAPTURE(), CAPTURE(), CAPTURE()].join(',\\s*') + '_?' +
  [CAPTURE(), CAPTURE(), CAPTURE(), CAPTURE()].join(',\\s*') +
  `(?:_(${NUMBER_SOURCE}))?\\s+\\((\\d+)\\)\\.png$`, 'i'
);

/** Parse an original EFT filename. This does not inspect pixels or identify a map. */
export function parseScreenshotFilename(input) {
  if (typeof input !== 'string') return null;
  const name = input.trim().replace(/^["']|["']$/g, '').split(/[\\/]/).pop();
  const match = FILENAME_PATTERN.exec(name || '');
  if (!match) return null;
  const values = match.slice(2, 9).map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  const [x, y, z, qx, qy, qz, qw] = values;
  const norm = Math.hypot(qx, qy, qz, qw);
  // Exported rotations are approximately unit length. Reject empty or arbitrary data.
  if (norm < 0.5 || norm > 1.5) return null;
  const quaternion = {x: qx / norm, y: qy / norm, z: qz / norm, w: qw / norm};
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})\]$/.exec(match[1]);
  const [, year, month, day, hour, minute] = dateMatch.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 2000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return {
    filename: name,
    captureLabel: match[1],
    capturedAt: match[1],
    // The filename does not include a timezone; do not present this as a UTC time.
    captureParts: {year, month, day, hour, minute},
    position: {x, y, z},
    x, y, z,
    quaternion,
    headingDegrees: (() => { const f = quaternionForward(quaternion); return f ? (Math.atan2(f.x, f.z) * 180 / Math.PI + 360) % 360 : null; })(),
    gameHour: match[9] === undefined ? null : Number(match[9]),
    sequence: Number(match[10]),
    forward: quaternionForward(quaternion),
    source: 'eft-original-filename',
  };
}

/** Unity forward (+Z) transformed by a unit quaternion. */
export function quaternionForward(q) {
  if (!q || ['x', 'y', 'z', 'w'].some(key => !Number.isFinite(q[key]))) return null;
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-10) return null;
  const x = q.x / length, y = q.y / length, z = q.z / length, w = q.w / length;
  const forward = {x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y)};
  return Math.hypot(forward.x, forward.z) < 1e-7 ? null : forward;
}

function isBounds(bounds) {
  return Array.isArray(bounds) && bounds.length >= 2 && bounds.slice(0, 2).every(
    pair => Array.isArray(pair) && pair.length >= 2 && pair.slice(0, 2).every(Number.isFinite)
  );
}

function projection(map) {
  if (!map) throw new Error('Map metadata is required');
  const rotation = map.coordinateRotation ?? 0;
  if (!Number.isFinite(rotation)) throw new Error('Invalid map rotation');
  // Current source uses rotations in right-angle increments. An oblique projection
  // would require matching the renderer's image warp; do not silently misplace it.
  if (Math.abs(rotation / 90 - Math.round(rotation / 90)) > 1e-7) throw new Error('Unsupported oblique map rotation');
  const [sx, ox, sy, oy] = map.transform || [1, 0, 1, 0];
  if (![sx, ox, sy, oy].every(Number.isFinite) || sx === 0 || sy === 0) throw new Error('Invalid map transform');
  const r = rotation * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return ({x, z}) => ({x: sx * (x * c - z * s) + ox, y: -sy * (x * s + z * c) + oy});
}

/**
 * Project onto the complete SVG image rectangle, returning normalized u/v.
 * map.bounds AND map.svgBounds are world [x,z] BEFORE coordinateRotation.
 * svgBounds takes precedence because the upstream SVG overlay uses it when present.
 * Do not clamp outside points: an incorrect map selection must remain detectable.
 */
export function worldToImage(position, map) {
  if (!position || ![position.x, position.z].every(Number.isFinite)) throw new Error('Finite world X and Z are required');
  const bounds = map?.svgBounds || map?.bounds;
  if (!isBounds(bounds)) throw new Error('Valid SVG bounds are required');
  const project = projection(map);
  const corners = [];
  for (const x of [bounds[0][0], bounds[1][0]]) {
    for (const z of [bounds[0][1], bounds[1][1]]) corners.push(project({x, z}));
  }
  const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y)), maxY = Math.max(...corners.map(p => p.y));
  if (maxX - minX < 1e-9 || maxY - minY < 1e-9) throw new Error('Degenerate map bounds');
  const point = project(position);
  const u = (point.x - minX) / (maxX - minX), v = (point.y - minY) / (maxY - minY);
  return {u, v, inside: u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9};
}

export function worldToMap(position, map) {
  const {u, v, inside} = worldToImage(position.position || position, map);
  return {u, v, inBounds: inside};
}

/** CSS rotation for an UP-pointing arrow, adjusted for map aspect ratio. */
export function imageHeading(quaternion, map, width = 1, height = 1) {
  const forward = quaternionForward(quaternion);
  if (!forward || !(width > 0 && height > 0)) return null;
  const a = worldToImage({x: 0, z: 0}, map);
  const b = worldToImage({x: forward.x, z: forward.z}, map);
  const dx = (b.u - a.u) * width, dy = (b.v - a.v) * height;
  return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
}

/** Pass displayed SVG width and height for exact aspect-adjusted arrow orientation. */
export function mapHeading(quaternion, map, width, height) {
  if (width === undefined || height === undefined) {
    const bounds = map.svgBounds || map.bounds;
    if (!isBounds(bounds)) throw new Error('Valid SVG bounds are required');
    const project = projection(map);
    const a = project({x: bounds[0][0], z: bounds[0][1]});
    const b = project({x: bounds[1][0], z: bounds[1][1]});
    width = Math.abs(a.x - b.x);
    height = Math.abs(a.y - b.y);
  }
  return imageHeading(quaternion, map, width, height);
}

/** Flatten upstream maps.json while retaining metadata and aliases. */
export function interactiveMaps(raw) {
  if (!Array.isArray(raw)) throw new Error('Map configuration must be an array');
  return raw.flatMap(entry => (entry.maps || []).filter(map => map.projection === 'interactive').map(map => ({
    ...map,
    normalizedName: entry.normalizedName,
    primaryPath: entry.primaryPath,
  }))).filter(map => isBounds(map.svgBounds || map.bounds) && typeof map.svgPath === 'string');
}

/** Height alone is insufficient for some buildings; match the extent rectangle too. */
export function matchingFloors(position, map) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return [];
  return (map.layers || []).filter(layer => (layer.extents || []).some(extent => {
    if (!Array.isArray(extent.height) || !(position.y >= extent.height[0] && position.y < extent.height[1])) return false;
    if (!extent.bounds?.length) return true;
    return extent.bounds.some(bounds => {
      if (!isBounds(bounds)) return false;
      const [a, b] = bounds;
      return position.x >= Math.min(a[0], b[0]) && position.x <= Math.max(a[0], b[0]) &&
        position.z >= Math.min(a[1], b[1]) && position.z <= Math.max(a[1], b[1]);
    });
  })).map(layer => ({name: layer.name, svgLayer: layer.svgLayer || null}));
}