/**
 * Map-floor metadata helpers. No network, DOM access or game-state inference.
 * Boundaries and building extents come from the selected tarkov.dev map config.
 * Source: https://github.com/the-hideout/tarkov-dev/blob/main/src/data/maps.json
 *
 * A "known" classification means the supplied point matches declared metadata;
 * it is not a claim that the current game build was independently measured.
 */

export const ALL_FLOORS_ID = '__all__';

const words = ['zero','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validRange = range => Array.isArray(range) && range.length >= 2 &&
  finite(range[0]) && finite(range[1]) && range[0] < range[1];
const validBounds = bounds => Array.isArray(bounds) && bounds.length >= 2 &&
  bounds.slice(0, 2).every(pair => Array.isArray(pair) && pair.length >= 2 &&
    finite(pair[0]) && finite(pair[1]));

function insideBounds(point, bounds) {
  if (!validBounds(bounds)) return false;
  const [a,b] = bounds;
  return point.x >= Math.min(a[0],b[0]) && point.x <= Math.max(a[0],b[0]) &&
    point.z >= Math.min(a[1],b[1]) && point.z <= Math.max(a[1],b[1]);
}

function floorNumber(name) {
  const n = normal(name);
  const match = /^(\d+)(?:st|nd|rd|th)?\s*(?:floor|level|층)$/.exec(n) ||
    /^(?:floor|level)\s*(\d+)$/.exec(n);
  if (match) return Number(match[1]);
  const word = /^(\w+) (?:floor|level)$/.exec(n)?.[1];
  const index = words.indexOf(word);
  return index > 0 ? index : null;
}

function describeFloor(name, id, {base=false, separateFirst=false}={}) {
  const n = normal(name), key = normal(id);
  const decks={'control room':['제어실','제어',0],'engine room':['기관실','기관',1],'engine room (upper)':['기관실 상층','기관↑',2],'fuel pumps (lower)':['연료 펌프 하층','펌프↓',3],'fuel pumps':['연료 펌프','펌프',4],'storage/security':['창고 · 보안실','창고',5],infirmary:['의무실','의무',6],helipad:['헬기장','헬기',7],'gym/canteen':['체육실 · 식당','식당',8],'accommodation (lower)':['선실 하층','선실↓',9],'accommodation (mid)':['선실 중층','선실',10],'accommodation (upper)':['선실 상층','선실↑',11],"officers' deck":['장교 갑판','장교',12],'stairs (blocked)':['폐쇄된 계단','계단',13],bridge:['함교','함교',14],'bridge roof':['함교 옥상','옥상',15]};
  if(decks[n]){const[label,shortLabel,order]=decks[n];return{label,shortLabel,order};}
  const combined = `${n} ${key}`;
  // Named floor metadata takes precedence over potentially old SVG group names.
  const number = floorNumber(name) ?? floorNumber(id);
  if (number !== null) return {label:`${number}층`,shortLabel:`${number}F`,order:number};
  const basementNumber = /(?:basement|underground|\bb)\s*(\d+)/.exec(combined)?.[1];
  if (basementNumber) {
    const depth = Number(basementNumber);
    return {label:`지하 ${depth}층`,shortLabel:`B${depth}`,order:-depth};
  }
  if (/garage/.test(n) && /underground|basement/.test(key)) {
    return {label:'지하 주차장',shortLabel:'B1',order:-1};
  }
  if (/tunnels?/.test(n) || /bunkers?/.test(n)) {
    return {label:/bunkers?/.test(n)?'지하 벙커':'지하 터널',shortLabel:'B1',order:-1};
  }
  if (/underground|basement/.test(combined)) return {label:'지하',shortLabel:'B1',order:-1};
  if (/ground (?:level|floor)/.test(combined)) {
    // Some maps have Ground_Level AND First_Floor (for example shopping levels).
    // Never give both planes the same 1F label in that configuration.
    if (separateFirst) return {label:'지상',shortLabel:'G',order:0};
    return {label:/ground level/.test(key)?'1층 · 지상':'1층',shortLabel:'1F',order:1};
  }
  if (/roof|rooftop/.test(combined)) return {label:'옥상',shortLabel:'RF',order:100};
  if (/technical/.test(combined)) return {label:'기술층',shortLabel:'T',order:0};
  return {label:text(name)||text(id)||(base?'기본 도면':'이름 미등록 층'),shortLabel:base?'BASE':'층',order:base?0:50};
}

function definitions(config={}) {
  const baseId = text(config.svgLayer);
  const layers = Array.isArray(config.layers) ? config.layers.filter(layer => layer && typeof layer==='object') : [];
  const separateFirst = layers.some(layer => text(layer.svgLayer)!==baseId &&
    (floorNumber(layer.name)===1 || floorNumber(layer.svgLayer)===1));
  const result = [];
  if (baseId) {
    result.push({
      id:baseId,base:true,sourceName:baseId,
      ...describeFloor(baseId,baseId,{base:true,separateFirst}),
      heightRange:config.heightRange,
    });
  }
  layers.forEach((layer,index) => {
    const id = text(layer.svgLayer);
    if (id && id===baseId) return;
    result.push({
      id,base:false,sourceName:text(layer.name)||id,
      ...describeFloor(layer.name,id,{separateFirst}),
      extents:layer.extents,index,
      svgAvailable:Boolean(id),
    });
  });
  return result;
}

/**
 * Selectable SVG floor options, sorted underground -> ground -> upper floors.
 * Does NOT include __all__; the app may prepend its own all-floors control.
 * availableIds can be an Array or Set of IDs actually found in the loaded SVG.
 * Missing DOM groups remain listed as available:false, so the app can disable
 * them without silently claiming their drawings exist.
 * Tile-only metadata has no SVG ID and is not a selectable SVG option.
 */
export function buildFloorOptions(config={}, availableIds) {
  const present = availableIds===undefined ? null : new Set(availableIds);
  const byId = new Map();
  for (const definition of definitions(config)) {
    if (!definition.id || byId.has(definition.id)) continue;
    const {id,label,shortLabel,order,base,sourceName} = definition;
    byId.set(id,{id,label,shortLabel,order,base,available:present===null||present.has(id),sourceName});
  }
  return [...byId.values()].sort((a,b)=>a.order-b.order || Number(b.base)-Number(a.base) || a.label.localeCompare(b.label,'ko'));
}

function unknown(reason, extras={}) {
  return {ids:[],labels:[],known:false,ambiguous:false,reason,...extras};
}

function extentMatches(point, extent) {
  if (!extent || !validRange(extent.height)) return false;
  if (!(point.y>=extent.height[0] && point.y<extent.height[1])) return false;
  if (extent.bounds===undefined || (Array.isArray(extent.bounds)&&extent.bounds.length===0)) return true;
  if (!Array.isArray(extent.bounds)) return false;
  return extent.bounds.some(bounds=>insideBounds(point,bounds));
}

/**
 * Classifies a point's supplied XYZ, not its trigger volume or screenshot pixels.
 * Additional layer extents take precedence over the base's broad heightRange.
 * Multiple overlapping extents are retained as ambiguous, never collapsed.
 * Missing Y, unclassified regions and partial-metadata base fallbacks stay unknown.
 */
export function classifyLocationFloor(input, config={}) {
  const point = input?.position && typeof input.position==='object' ? input.position : input;
  if (!point || !finite(point.x) || !finite(point.z)) return unknown('missing-position');
  if (!finite(point.y)) return unknown('missing-height');
  if (config.bounds!==undefined && !validBounds(config.bounds)) return unknown('invalid-map-bounds');
  if (validBounds(config.bounds) && !insideBounds(point,config.bounds)) return unknown('outside-map');
  const defs = definitions(config);
  const extraDefs = defs.filter(def=>!def.base);
  const matched = extraDefs.filter(def=>Array.isArray(def.extents)&&def.extents.some(extent=>extentMatches(point,extent)));
  if (matched.length) {
    const ids = [...new Set(matched.map(def=>def.id).filter(Boolean))];
    const labels = [...new Set(matched.map(def=>def.label))];
    const unavailable = matched.some(def=>!def.id);
    const ambiguous = ids.length + matched.filter(def=>!def.id).length > 1;
    return {
      ids,labels,known:!unavailable&&ids.length>0,ambiguous,
      reason:unavailable?'layer-without-svg':ambiguous?'overlapping-extents':'layer-extent',
      unavailable,
      metadataPartial:config.layersPartial===true,
      confidence:'declared-extent',
    };
  }
  if (config.layersPartial===true) return unknown('partial-floor-metadata');
  // A listed plane without spatial metadata could overlap this point. Do not
  // silently fall back to 1F just because that plane has no usable extents.
  if (extraDefs.some(def=>!Array.isArray(def.extents)||!def.extents.length||
      def.extents.some(extent=>!validRange(extent?.height)))) return unknown('incomplete-floor-extents');
  const base = defs.find(def=>def.base);
  if (!base || !validRange(base.heightRange)) return unknown('no-base-height-range');
  if (!validBounds(config.bounds)) return unknown('no-map-bounds');
  if (!(point.y>=base.heightRange[0]&&point.y<base.heightRange[1])) return unknown('outside-floor-ranges');
  return {
    ids:[base.id],labels:[base.label],known:true,ambiguous:false,
    reason:'base-height-range',confidence:'declared-base-range',
  };
}

/**
 * Unknown locations remain visible for a '?' / unknown-floor badge.
 * Ambiguous points are visible in each candidate floor.
 * Known points on other floors are hidden by default; a player marker can instead
 * use otherFloor=true to render a ghost with an explicit floor badge.
 */
export function floorMatches(point, config={}, selectedId=ALL_FLOORS_ID) {
  const classification = classifyLocationFloor(point,config);
  const all = !selectedId || selectedId===ALL_FLOORS_ID;
  const matched = all || classification.ids.includes(selectedId);
  const unknownFloor = !classification.known;
  return {
    visible:all||matched||unknownFloor,
    matched,
    otherFloor:!all&&classification.known&&!matched,
    unknown:unknownFloor,
    ambiguous:classification.ambiguous,
    unavailable:classification.unavailable===true,
    classification,
  };
}

/**
 * Returns only declared SVG floor IDs -> opacity (0 means hide).
 * Arbitrary SVG groups, labels, exits and definitions are intentionally absent:
 * callers must leave them alone. A data-keep-with-group companion should use its
 * referenced ID's opacity when that ID is present in this returned object.
 * The caller owns SVG stacking: put the selected plane and companions above the
 * faded base, or use context:false for a clean selected-floor drawing.
 */
export function floorGroupVisibility(config={}, selectedId=ALL_FLOORS_ID, {context=true}={}) {
  const options = buildFloorOptions(config);
  const all = !selectedId || selectedId===ALL_FLOORS_ID;
  if (!all&&!options.some(option=>option.id===selectedId)) throw new RangeError('Selected floor is not declared by this map');
  return Object.fromEntries(options.map(option=>[
    option.id,
    all||option.id===selectedId ? 1 : (context&&option.base?0.12:0),
  ]));
}
