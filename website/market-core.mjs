import {weaponData} from './r12-core.mjs';
/**
 * Read-only market snapshots from the public tarkov.dev JSON API.
 * https://tarkov.dev/api
 * https://json.tarkov.dev/endpoints
 * https://github.com/the-hideout/tarkov-api/blob/main/schema-static.mjs
 * https://github.com/the-hideout/tarkov-api/blob/main/datasources/items.mjs
 *
 * lastLowPrice is the latest observed flea low, not a guaranteed available offer.
 * Its absence never falls back to an average or a trader valuation. Nested `flea`
 * objects and the documented flat item price fields are accepted separately.
 * A successful fetch does not mean the provider produced a new price snapshot.
 */

const BASE_URL = 'https://json.tarkov.dev';
const MODES = ['regular', 'pve', 'pvp-season'];
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const METADATA_CACHE_MS = 30 * 60 * 1000;
const metadataCache = new Map();
let endpointCache = null;
export const MARKET_POLL_INTERVAL_MS = 60 * 1000;
// A display policy chosen by this app, not a provider freshness guarantee.
export const MARKET_STALE_AFTER_MS = 30 * 60 * 1000;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))];
const values = value => Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
const payload = document => isRecord(document?.data) ? document.data : isRecord(document) ? document : {};
function records(document, name) {
  const collection = payload(document)[name];
  if (Array.isArray(collection)) return collection.filter(isRecord);
  if (!isRecord(collection)) return [];
  return Object.entries(collection).filter(([key, value]) => !BLOCKED_KEYS.has(key) && isRecord(value))
    .map(([key, value]) => ({...value, id: text(value.id) || key}));
}
function dictionary(document) {
  const data = payload(document);
  return isRecord(data.translations) ? data.translations : data;
}
function readable(value, fallback = '') {
  const name = text(value);
  return !name || /^[a-f\d]{24}(?:\s.*)?$/i.test(name)
    || /^\{[a-f\d-]+\}(?:\s.*)?$/i.test(name)
    || /^(?:QuestCondition|Quest|Handbook|Hideout|Skills)\//.test(name) ? fallback : name;
}
function translated(key, ko, en, fallback = '') {
  const lookup = locale => typeof key === 'string' && own(locale, key) ? locale[key] : undefined;
  const english = readable(lookup(en), readable(key, fallback));
  return {name: readable(lookup(ko), english), nameEn: english};
}
function number(value) {
  if (!['string', 'number'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function amount(value) {
  const result = number(value);
  return result !== null && result >= 0 ? result : null;
}
function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}
function idOf(value) {
  return typeof value === 'string' ? value : isRecord(value) ? text(value.id) || null : null;
}
function timestamp(value) {
  const source = text(value);
  // Unknown timezone or numeric epoch units are not silently assumed.
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(source);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  const milliseconds = Date.parse(source);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
const vendorKey = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function traderContext(bundle) {
  const ko = {...dictionary(bundle.itemsKo), ...dictionary(bundle.tradersKo)};
  const en = {...dictionary(bundle.itemsEn), ...dictionary(bundle.tradersEn)};
  const traders = records(bundle.traders, 'traders').map(trader => ({
    id: idOf(trader), normalizedName: readable(trader.normalizedName),
    ...translated(trader.name || trader.nickname, ko, en,
      readable(trader.normalizedName, '상인 이름 미등록')),
  })).filter(trader => trader.id);
  const index = new Map();
  for (const trader of traders) {
    for (const key of [trader.id, trader.normalizedName, trader.nameEn]) {
      if (key) index.set(vendorKey(key), trader);
    }
  }
  return {ko, en, index};
}

function traderOffer(raw, context, fromTraderPrices = false) {
  if (!isRecord(raw)) return null;
  const vendor = isRecord(raw.vendor) ? raw.vendor : {};
  const traderRef = raw.trader || vendor.trader || vendor.trader_id || raw.vendor;
  const embeddedTrader = isRecord(traderRef) ? traderRef : {};
  const referenceId = idOf(traderRef);
  const descriptors = [raw.source, referenceId, vendor.name, vendor.normalizedName,
    vendor.__typename, embeddedTrader.name, embeddedTrader.normalizedName];
  if (descriptors.some(value => vendorKey(value) === 'fleamarket')) return null;
  const known = descriptors.map(value => context.index.get(vendorKey(value))).find(Boolean);
  if (!fromTraderPrices && !known && !referenceId && !vendor.name && !vendor.normalizedName) return null;
  const names = translated(embeddedTrader.name || vendor.name, context.ko, context.en,
    readable(embeddedTrader.normalizedName || vendor.normalizedName || raw.source, '상인 이름 미등록'));
  const currency = text(raw.currency).toUpperCase() || null;
  const price = amount(raw.price);
  // PriceRUB is supplied by the provider; same-currency RUB needs no conversion.
  const priceRUB = amount(raw.priceRUB) ?? (currency === 'RUB' ? price : null);
  return {
    price, currency, priceRUB,
    traderId: known?.id || referenceId || null,
    traderName: known?.name || names.name,
    traderNameEn: known?.nameEn || names.nameEn,
  };
}

function traderSales(item, context) {
  // sellFor is player -> vendor. buyFor must never be used as a selling value.
  const saleRows = values(item.sellFor).map(offer => traderOffer(offer, context));
  const legacyRows = values(item.traderPrices).map(offer => traderOffer(offer, context, true));
  const offers = [...new Map([...saleRows, ...legacyRows].filter(Boolean).map(offer =>
    [`${offer.traderId || offer.traderName}|${offer.currency}|${offer.price}|${offer.priceRUB}`, offer])).values()];
  const priced = offers.filter(offer => offer.price !== null && offer.currency);
  let best = null;
  if (priced.length && priced.every(offer => offer.priceRUB !== null)) {
    best = priced.reduce((a, b) => b.priceRUB > a.priceRUB ? b : a);
  } else if (priced.length && new Set(priced.map(offer => offer.currency)).size === 1) {
    best = priced.reduce((a, b) => b.price > a.price ? b : a);
  }
  // Mixed currencies without comparable provider values cannot have a claimed best.
  return {traderSellPrices: offers, bestTraderSell: best};
}

/** Provider timestamp age, with a caller-adjustable app display threshold. */
export function marketPriceAge(itemOrFlea, now = Date.now(), {staleAfterMs = MARKET_STALE_AFTER_MS} = {}) {
  const flea = itemOrFlea?.flea || itemOrFlea || {};
  const updatedAt = timestamp(flea.updatedAt);
  const current = typeof now === 'number' ? now : Date.parse(now);
  const thresholdMs = amount(staleAfterMs) ?? MARKET_STALE_AFTER_MS;
  if (!updatedAt || !Number.isFinite(current)) return {status: 'unknown', ageMs: null, stale: null, thresholdMs};
  const ageMs = current - Date.parse(updatedAt);
  if (ageMs < -60000) return {status: 'future', ageMs: null, stale: null, thresholdMs};
  return {status: 'known', ageMs: Math.max(0, ageMs), stale: ageMs >= thresholdMs, thresholdMs};
}

/**
 * Pure normalization of {items,itemsKo,itemsEn,traders?,tradersKo?,tradersEn?,
 * mode?,fetchedAt?,partialWarnings?}. Documents retain their original API shape.
 */
export function normalizeMarketCatalog(bundle = {}) {
  const mode = bundle.mode || 'regular';
  const source = MODES.includes(mode) ? `${BASE_URL}/${mode}/items` : '';
  const fetchedAt = timestamp(bundle.fetchedAt);
  const ko = dictionary(bundle.itemsKo), en = dictionary(bundle.itemsEn);
  const context = traderContext(bundle);
  const partialWarnings = [...(bundle.partialWarnings || [])];
  const items = records(bundle.items, 'items').map(item => {
    const fallback = readable(item.normalizedName).replace(/[-_]+/g, ' ') || '이름 미등록 아이템';
    const names = translated(item.name || item.shortName, ko, en, fallback);
    const shortNames = translated(item.shortName, ko, en, names.nameEn);
    const types = values(item.types).filter(value => typeof value === 'string');
    const nested = isRecord(item.flea);
    const fields = nested ? item.flea : item;
    const currentPrice = amount(fields.lastLowPrice);
    const restricted = types.includes('noFlea');
    const updatedAt = timestamp(fields.updated);
    const flea = {
      currentPrice, average24h: amount(fields.avg24hPrice),
      low24h: amount(fields.low24hPrice), high24h: amount(fields.high24hPrice),
      updatedAt, currency: 'RUB', lastOfferCount: amount(fields.lastOfferCount),
      change48h: number(fields.changeLast48h), change48hPercent: number(fields.changeLast48hPercent),
      priceStatus: restricted ? 'restricted' : currentPrice === null ? 'missing'
        : currentPrice === 0 ? 'zero' : 'observed',
      providerField: nested ? 'flea.lastLowPrice' : 'lastLowPrice',
      timestampField: updatedAt ? (nested ? 'flea.updated' : 'updated') : null,
    };
    const categoryEntries = [...values(item.categories),...values(item.handbookCategories),...(item.category?[item.category]:[]),...(item.bsgCategory?[item.bsgCategory]:[])];
    const categoryLabels = unique(categoryEntries.map(entry => {
      if (typeof entry === 'string') return translated(entry, ko, en, readable(entry)).name;
      if (!isRecord(entry)) return '';
      return translated(entry.name || entry.id, ko, en, readable(entry.normalizedName || entry.name)).name;
    }).filter(Boolean));
    return {
      categoryLabels, categoryIds: unique(categoryEntries.map(entry => idOf(entry)).filter(Boolean)),
      id: idOf(item), ...names, normalizedName: readable(item.normalizedName),
      shortName: shortNames.name, shortNameEn: shortNames.nameEn,
      iconLink: safeURL(item.iconLink || item.gridImageLink), wikiLink: safeURL(item.wikiLink),
      itemLink: readable(item.normalizedName) ? `https://tarkov.dev/item/${encodeURIComponent(item.normalizedName)}` : '',
      types, minLevelForFlea: amount(item.minLevelForFlea), flea,
      grid: {
        width: amount(item.width ?? item.gridWidth ?? item.grid?.width ?? item.gridSize?.width),
        height: amount(item.height ?? item.gridHeight ?? item.grid?.height ?? item.gridSize?.height),
      },
      weapon: weaponData(item),
      stats: {
        ammo: (()=>{
          const raw = item.propertiesAmmo || item.ammo || item.properties?.ammo || (item.properties?.penetrationPower!==undefined ? item.properties : null);
          if(!isRecord(raw))return null;
          const damage=number(raw.damage),penetration=number(raw.penetrationPower??raw.penetration);
          return damage!==null || penetration!==null ? {damage,penetration,caliber:text(raw.caliber),armorDamage:number(raw.armorDamage),tracer:raw.tracer===true} : null;
        })(),
        armor: (()=>{
          const raw=item.propertiesArmor || item.armor || item.properties?.armor || (item.properties?.class!==undefined ? item.properties : null);
          if(!isRecord(raw))return null;
          const armorClass=number(raw.class ?? raw.armorClass);
          return armorClass!==null ? {class:armorClass,durability:amount(raw.durability??item.durability)} : null;
        })(),
      },
      ...traderSales(item, context), source, fetchedAt,
      searchText: [names.name, names.nameEn, shortNames.name, shortNames.nameEn,
        readable(item.normalizedName), idOf(item)].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR'),
    };
  }).filter(item => item.id);
  const priceCoverage = {totalItems: items.length, observed: 0, zero: 0, missing: 0, restricted: 0,
    timestamped: 0};
  for (const item of items) {
    priceCoverage[item.flea.priceStatus] += 1;
    if (item.flea.updatedAt) priceCoverage.timestamped += 1;
  }
  if (items.length && !priceCoverage.observed) {
    partialWarnings.push('불러온 데이터에서 0보다 큰 플리 관측 가격을 찾지 못했습니다. 아이템 이름은 검색할 수 있습니다.');
  }
  return {
    items, mode, fetchedAt, source, providerUpdatedAt: timestamp(payload(bundle.items).updated || bundle.items?.updated),
    priceCoverage, partialWarnings: unique(partialWarnings),
    refreshInfo: {
      pollIntervalMs: MARKET_POLL_INTERVAL_MS,
      providerCadenceText: '제공처에 새 데이터가 생기면 갱신됩니다. 60초 확인은 제공처 갱신 주기와 다릅니다.',
    },
  };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('마켓 데이터 불러오기가 취소되었습니다.', 'AbortError');
}
async function requestJSON(path, {signal, timeoutMs = 35000} = {}) {
  abortIfNeeded(signal);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, {once: true});
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}/${path}`, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-cache',
      headers: {Accept: 'application/json'}, signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`tarkov.dev HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const document = await response.json();
    if (!isRecord(document)) throw new Error('유효한 JSON 응답이 아닙니다.');
    return document;
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      const timeoutError = new Error('마켓 데이터 응답 시간이 초과되었습니다.');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Clear optional locale/trader metadata; prices themselves are never memory-cached here. */
export function clearMarketMetadataCache(mode) {
  if (mode) metadataCache.delete(mode);
  else { metadataCache.clear(); endpointCache = null; }
}

/** Fetch latest published item data for one mode, without a GraphQL fallback or credentials. */
export async function fetchMarketCatalog(mode = 'regular', {signal, onProgress, forceMetadata = false} = {}) {
  if (!MODES.includes(mode)) {
    const error = new Error('지원하지 않는 마켓 게임 모드입니다.'); error.code = 'MARKET_MODE'; throw error;
  }
  abortIfNeeded(signal);
  const partialWarnings = [];
  onProgress?.('마켓 데이터 목록을 확인하고 있습니다…');
  let catalog = endpointCache && Date.now() - endpointCache.fetchedAt < METADATA_CACHE_MS
    ? endpointCache.document : null;
  if (!catalog) {
    try {
      catalog = payload(await requestJSON('endpoints', {signal, timeoutMs: 10000}));
      abortIfNeeded(signal);
      endpointCache = {document: catalog, fetchedAt: Date.now()};
    } catch {
      abortIfNeeded(signal);
      partialWarnings.push('공개 API 목록 확인에 실패해 선택한 모드의 알려진 주소로 조회했습니다.');
    }
  }
  if (Array.isArray(catalog?.gameModes) && !catalog.gameModes.includes(mode)) {
    const error = new Error('제공처에서 선택한 모드의 마켓 데이터를 제공하지 않습니다.');
    error.code = 'MARKET_MODE'; throw error;
  }
  const previous = metadataCache.get(mode);
  const useCachedMetadata = !forceMetadata && previous && Date.now() - previous.fetchedAt < METADATA_CACHE_MS;
  const metadataPaths = [
    ['itemsKo', 'items_ko', '아이템 한국어'], ['itemsEn', 'items_en', '아이템 영어'],
    ['traders', 'traders', '상인 목록'], ['tradersKo', 'traders_ko', '상인 한국어'],
    ['tradersEn', 'traders_en', '상인 영어'],
  ];
  const requests = [['items', 'items', '아이템 가격'], ...metadataPaths.filter(([key]) =>
    !useCachedMetadata || !previous.documents[key])];
  let completed = 0;
  const responses = await Promise.allSettled(requests.map(async ([, endpoint]) => {
    try { return await requestJSON(`${mode}/${endpoint}`, {signal}); }
    finally { completed += 1; onProgress?.(`마켓 데이터 불러오는 중 · ${completed}/${requests.length}`); }
  }));
  abortIfNeeded(signal);
  const bundle = {...(useCachedMetadata ? previous.documents : {}), mode,
    fetchedAt: new Date().toISOString(), partialWarnings};
  const freshMetadata = {...(previous?.documents || {})};
  responses.forEach((response, index) => {
    const [key, , label] = requests[index];
    if (response.status === 'fulfilled') {
      bundle[key] = response.value;
      if (key !== 'items') freshMetadata[key] = response.value;
    } else if (key !== 'items') {
      if (previous?.documents[key]) {
        bundle[key] = previous.documents[key];
        partialWarnings.push(`${label} 갱신에 실패해 이전 이름 정보를 사용합니다.`);
      } else partialWarnings.push(`${label} 정보를 불러오지 못했습니다.`);
    }
  });
  if (responses[0].status !== 'fulfilled') {
    const error = new Error('마켓 가격 데이터를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    error.code = 'MARKET_NETWORK'; error.cause = responses[0].reason; throw error;
  }
  const normalized = normalizeMarketCatalog(bundle);
  if (!normalized.items.length) {
    const error = new Error('제공처 응답에 유효한 아이템 목록이 없습니다.');
    error.code = 'MARKET_EMPTY'; throw error;
  }
  // Only locale and trader metadata are reused. Every call still retrieves items.
  metadataCache.set(mode, {documents: freshMetadata,
    fetchedAt: useCachedMetadata ? previous.fetchedAt : Date.now()});
  onProgress?.(`${normalized.items.length.toLocaleString('ko-KR')}개 아이템의 마켓 데이터를 불러왔습니다.`);
  return normalized;
}