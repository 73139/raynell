/**
 * Static map details from already fetched tarkov.dev data. No network requests.
 *
 * Sources:
 * https://github.com/the-hideout/tarkov-api/blob/main/schema-static.mjs
 * https://json.tarkov.dev/endpoints
 *
 * MapExtract provides faction, switches, transferItem, position, outline, top,
 * and bottom. MapTransit additionally provides description, conditions, and map.
 * Neither describes whether an exit is open in the user's current raid.
 * Floors come from the separately sourced maps.json geometry, not from exit
 * names or a universal height threshold. Unknown positions remain list entries.
 */

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAP_ALIASES = Object.freeze({
  'ground-zero-21': 'ground-zero',
  'night-factory': 'factory', 'infected-factory': 'factory',
  'factory-day': 'factory', 'factory-night': 'factory',
  'laboratory': 'the-lab', 'the-laboratory': 'the-lab', 'labs': 'the-lab',
  'streets': 'streets-of-tarkov',
});

const string = value => typeof value === 'string' ? value.trim() : '';
function readable(value, fallback = '') {
  const text = string(value);
  return !text || /^[a-f\d]{24}(?:\s.*)?$/i.test(text)
    || /^\{[a-f\d-]+\}(?:\s.*)?$/i.test(text)
    || /^(?:QuestCondition|Quest|Handbook|Hideout|Skills)\//.test(text) ? fallback : text;
}
function idOf(value) {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    return string(value.id || value.itemId || value.mapId) || null;
  }
  return null;
}
function number(value) {
  if (!['number', 'string'].includes(typeof value)
      || (typeof value === 'string' && !value.trim())) return null;
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}
function point(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = number(value.x), y = number(value.y), z = number(value.z);
  return x === null || y === null || z === null ? null : {x, y, z};
}
function rows(value) {
  if (Array.isArray(value)) return value.filter(row => row &&
    (typeof row === 'string' || typeof row === 'object'));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([key, row]) => !BLOCKED_KEYS.has(key) && row
    && (typeof row === 'string' || typeof row === 'object'))
    .map(([key, row]) => typeof row === 'object' ? {...row, id: idOf(row) || key} : row);
}
function sourceURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}
function retrievedAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Canonical UI map key. Individual source map IDs remain on every result. */
export function canonicalMapKey(value) {
  const key = string(value && typeof value === 'object'
    ? value.normalizedName || value.key || value.id : value)
    .toLowerCase().replace(/[\s_]+/g, '-');
  return MAP_ALIASES[key] || key;
}

/** An empty/unknown faction never means shared, and shared never means co-op. */
export function classifyExtractFaction(value) {
  const faction = string(value).toLowerCase();
  if (faction === 'pmc') return 'pmc';
  if (faction === 'scav' || faction === 'scavs') return 'scav';
  if (['all', 'both', 'shared'].includes(faction)) return 'shared';
  return 'unknown';
}

/** Resolve switch references without recursively following potentially cyclic links. */
export function normalizeMapSwitches(references, knownSwitches = []) {
  const index = new Map(rows(knownSwitches).filter(row => idOf(row)).map(row => [idOf(row), row]));
  return rows(references).map(reference => {
    const id = idOf(reference), known = index.get(id);
    const raw = {...(known && typeof known === 'object' ? known : {}),
      ...(reference && typeof reference === 'object' ? reference : {})};
    const name = readable(raw.name, readable(raw.nameEn, '이름 미등록 스위치'));
    const position = point(raw.position) || point(raw);
    return {
      id, name, nameEn: readable(raw.nameEn, name), switchType: readable(raw.switchType),
      position, ...(position || {}),
      activatedById: idOf(raw.activatedById || raw.activatedBy),
      activates: rows(raw.activates).filter(operation => typeof operation === 'object').map(operation => ({
        operation: readable(operation.operation), targetId: idOf(operation.targetId || operation.target),
        targetName: readable(operation.targetName || operation.target?.name),
        targetNameEn: readable(operation.targetNameEn || operation.target?.nameEn),
      })),
    };
  });
}

function transferItemDetails(value, items) {
  if (!value || typeof value !== 'object') return null;
  const reference = value.item || value;
  const id = idOf(reference);
  if (!id) return null;
  const supplied = reference && typeof reference === 'object' ? reference : {};
  const known = items.find(item => idOf(item) === id);
  const name = readable(known?.name, readable(known?.nameEn,
    readable(supplied.name, readable(supplied.nameEn, '이름 미등록 아이템'))));
  const nameEn = readable(known?.nameEn, readable(supplied.nameEn, name));
  const suppliedCount = number(value.count) ?? number(value.quantity);
  return {
    id, name, nameEn, nameAvailable: name !== '이름 미등록 아이템',
    count: suppliedCount !== null && suppliedCount >= 0 ? suppliedCount : null,
    attributes: rows(value.attributes).filter(attribute => typeof attribute === 'object').map(attribute => ({...attribute})),
  };
}

/** Only confirmed switch/item evidence; not a complete extraction rules engine. */
export function normalizeExtractConditions(extract, {switches = [], items = []} = {}) {
  const resolvedSwitches = normalizeMapSwitches(extract?.switches, switches);
  const transferItem = transferItemDetails(extract?.transferItem, rows(items));
  const conditionNotes = [];
  if (resolvedSwitches.length) {
    conditionNotes.push(`연결 스위치: ${resolvedSwitches.map(item => item.name).join(', ')}`);
  }
  if (transferItem) {
    conditionNotes.push(`아이템 조건: ${transferItem.name}${transferItem.count === null
      ? ' (수량 미등록)' : ` × ${transferItem.count}`}`);
    if (transferItem.attributes.length) conditionNotes.push('추가 아이템 속성 조건은 원문에서 확인하세요.');
  }
  return {switches: resolvedSwitches, transferItem, conditionNotes};
}

/**
 * Return extract and transit entries for a canonical map key or exact source ID.
 *
 * Each entry includes {key,id,mapId,mapName,kind,category,name,nameEn,faction,
 * position,x?,y?,z?,canPin,outline,top,bottom,switches,transferItem,conditionNotes,
 * destinationMapId,destinationName,sourceURL,fetchedAt,availability:'unknown'}.
 * `key` is a UI key, never an invented provider ID. `canPin` means a complete
 * source XYZ exists; callers must still check map bounds and floor geometry.
 */
export function exitsForMap(maps, key, {items = []} = {}) {
  const mapList = rows(Array.isArray(maps) ? maps : maps?.maps);
  const desired = canonicalMapKey(key);
  if (!desired) return [];
  const exactId = string(key && typeof key === 'object' ? key.id : key);
  const exactMaps = mapList.filter(map => map.id === exactId);
  const matching = exactMaps.length ? exactMaps : mapList.filter(map =>
    [map.normalizedName, map.key, map.nameEn, map.name].some(candidate => canonicalMapKey(candidate) === desired));
  const mapIndex = new Map(mapList.map(map => [map.id, map]));

  return matching.flatMap(map => {
    const common = (entry, kind, index) => {
      const position = point(entry.position) || point(entry);
      return {
        key: `${map.id || canonicalMapKey(map)}:${kind}:${idOf(entry) || index}`,
        id: idOf(entry), mapId: idOf(map), mapName: readable(map.name),
        mapNameEn: readable(map.nameEn), mapNormalizedName: string(map.normalizedName),
        kind, position, ...(position || {}), canPin: position !== null,
        outline: rows(entry.outline).map(point).filter(Boolean),
        top: number(entry.top), bottom: number(entry.bottom),
        sourceURL: sourceURL(entry.sourceURL) || sourceURL(map.sourceURL),
        fetchedAt: retrievedAt(entry.fetchedAt) || retrievedAt(map.fetchedAt),
        wikiLink: sourceURL(map.wikiLink), availability: 'unknown',
      };
    };
    const extracts = rows(map.extracts).filter(entry => typeof entry === 'object').map((entry, index) => {
      const name = readable(entry.name, readable(entry.nameEn, '이름 미등록 탈출구'));
      return {
        ...common(entry, 'extract', index), name, nameEn: readable(entry.nameEn, name),
        faction: string(entry.faction), category: classifyExtractFaction(entry.faction),
        ...normalizeExtractConditions(entry, {switches: map.switches, items}),
        destinationMapId: null, destinationName: '',
      };
    });
    const transits = rows(map.transits).filter(entry => typeof entry === 'object').map((entry, index) => {
      const name = readable(entry.description, readable(entry.descriptionEn, '지도 이동'));
      const destinationMapId = idOf(entry.destinationMapId || entry.map);
      const destination = mapIndex.get(destinationMapId);
      const conditions = readable(entry.conditions, readable(entry.conditionsEn));
      return {
        ...common(entry, 'transit', index), name, nameEn: readable(entry.descriptionEn, name),
        faction: '', category: 'transit', switches: [], transferItem: null,
        conditionNotes: conditions ? [conditions] : [],
        destinationMapId,
        destinationName: readable(entry.destinationName, readable(destination?.name, '도착 지도 미등록')),
        destinationNameEn: readable(entry.destinationNameEn, readable(destination?.nameEn)),
      };
    });
    return [...extracts, ...transits];
  });
}