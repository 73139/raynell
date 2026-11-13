import {extractBossIntel,extractHazards,extractSpawns} from './r12-core.mjs';
/**
 * Read-only tarkov.dev JSON API adapter.
 *
 * Primary API: https://json.tarkov.dev/endpoints
 * The base documents contain translation keys, not translated names.
 * Locale documents are separate /{mode}/{endpoint}_ko and _en resources.
 *
 * normalizeDataset accepts:
 * {tasks, tasksKo, tasksEn, maps, mapsKo, mapsEn,
 *  traders, tradersKo, tradersEn, items?, itemsKo?, itemsEn?,
 *  mode?, fetchedAt?, partialWarnings?}
 * Each document is the original parsed HTTP JSON response.
 * onProgress in fetchQuestDataset receives a short Korean string.
 * onMaps receives {maps, mode, fetchedAt, source, partialWarnings} as soon as the
 * three existing map requests settle, even when the later task request fails.
 */

const BASE_URL = 'https://json.tarkov.dev';
const KNOWN_MODES = ['regular', 'pve', 'pvp-season'];
const OWN = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function payload(document) {
  if (!document || typeof document !== 'object') return {};
  return document.data && typeof document.data === 'object' ? document.data : document;
}

function dictionary(document) {
  const data = payload(document);
  return data.translations && !Array.isArray(data.translations)
    && typeof data.translations === 'object' ? data.translations : data;
}

function records(document, name) {
  const data = payload(document);
  const collection = data[name];
  if (Array.isArray(collection)) {
    return collection.filter(row => row && typeof row === 'object');
  }
  if (!collection || typeof collection !== 'object') return [];
  return Object.entries(collection)
    .filter(([key, row]) => !blockedKeys.has(key) && row && typeof row === 'object')
    .map(([key, row]) => ({...row, id: String(row.id || key)}));
}

// Nested API collections may be arrays or ID-keyed objects. Keep real dictionary
// IDs and unresolved string references; never manufacture a coordinate or ID.
function references(collection) {
  if (Array.isArray(collection)) return collection.filter(row => row &&
    (typeof row === 'string' || typeof row === 'object'));
  if (!collection || typeof collection !== 'object') return [];
  return Object.entries(collection).filter(([key, row]) => !blockedKeys.has(key)
    && row && (typeof row === 'string' || typeof row === 'object'))
    .map(([key, row]) => typeof row === 'object' ? {...row, id: idOf(row) || key} : row);
}

function idOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') {
    const id = value.id || value.itemId || value.taskId || value.mapId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

function unique(valuesToCheck) {
  return [...new Set(valuesToCheck.filter(value => typeof value === 'string' && value))];
}

function idsOf(value) {
  return unique((Array.isArray(value) ? value : value == null ? [] : [value]).map(idOf));
}

function looksLikeTranslationKey(value) {
  return typeof value !== 'string' || !value.trim()
    || /^[a-f\d]{24}(?:\s.*)?$/i.test(value.trim())
    || /^\{[a-f\d-]+\}(?:\s.*)?$/i.test(value.trim())
    || /^(?:QuestCondition|Quest|Handbook|Hideout|Skills)\//.test(value.trim());
}

function readable(value, fallback = '') {
  if (typeof value !== 'string' || looksLikeTranslationKey(value)) return fallback;
  return value.trim();
}

function slugName(slug, fallback) {
  const text = readable(slug);
  return text ? text.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : fallback;
}

function lookup(key, translations) {
  if (typeof key !== 'string' || !OWN(translations, key)) return undefined;
  return typeof translations[key] === 'string' ? translations[key] : undefined;
}

function textPair(key, ko, en, fallback = '') {
  const english = readable(lookup(key, en), readable(key, fallback));
  return {
    value: readable(lookup(key, ko), english),
    english,
  };
}

function finite(value) {
  if (!['number', 'string'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function point(position) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) return null;
  const x = finite(position.x);
  const y = finite(position.y);
  const z = finite(position.z);
  return x === null || y === null || z === null ? null : {x, y, z};
}

function safeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function countValue(value) {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizedMaps(bundle, fetchedAt) {
  const ko = dictionary(bundle.mapsKo), en = dictionary(bundle.mapsEn);
  const rawMaps = records(bundle.maps, 'maps');
  const mode = bundle.mode || 'regular';
  const sourceURL = KNOWN_MODES.includes(mode) ? `${BASE_URL}/${mode}/maps` : '';
  const namesFor = map => textPair(map.name, ko, en,
    slugName(map.normalizedName, '이름 미등록 지도'));
  const mapNames = new Map(rawMaps.map(map => [idOf(map), namesFor(map)]));

  return rawMaps.map(map => {
    const names = namesFor(map);
    const rawSwitches = references(map.switches);
    const switchIndex = new Map(rawSwitches.filter(row => idOf(row)).map(row => [idOf(row), row]));
    const switchDetails = reference => {
      const id = idOf(reference);
      const known = switchIndex.get(id);
      const raw = {...(known && typeof known === 'object' ? known : {}),
        ...(reference && typeof reference === 'object' ? reference : {})};
      const translated = textPair(raw.name, ko, en, '이름 미등록 스위치');
      const xyz = point(raw.position);
      return {
        id, name: translated.value, nameEn: translated.english,
        switchType: readable(raw.switchType), position: xyz, ...(xyz || {}),
        activatedById: idOf(raw.activatedBy),
        activates: values(raw.activates).filter(operation => operation && typeof operation === 'object')
          .map(operation => {
            const target = operation.target;
            const targetNames = textPair(target?.name, ko, en, '');
            return {operation: readable(operation.operation), targetId: idOf(target),
              targetName: targetNames.value, targetNameEn: targetNames.english};
          }),
      };
    };
    const geometry = entry => {
      const xyz = point(entry.position);
      return {position: xyz, ...(xyz || {}),
        outline: values(entry.outline).map(point).filter(Boolean),
        top: finite(entry.top), bottom: finite(entry.bottom), sourceURL, fetchedAt};
    };
    const extracts = references(map.extracts).filter(row => typeof row === 'object').map(extract => {
      const translated = textPair(extract.name, ko, en, '이름 미등록 탈출구');
      return {
        id: idOf(extract), name: translated.value, nameEn: translated.english,
        faction: readable(extract.faction), ...geometry(extract),
        // These are static provider facts, not current-raid availability.
        switches: references(extract.switches).map(switchDetails),
        transferItem: extract.transferItem || null,
      };
    });
    const transits = references(map.transits).filter(row => typeof row === 'object').map(transit => {
      const description = textPair(transit.description, ko, en, '지도 이동');
      const conditions = textPair(transit.conditions, ko, en, '');
      const destinationMapId = idOf(transit.map);
      const destination = mapNames.get(destinationMapId)
        || textPair(transit.map?.name, ko, en, '도착 지도 미등록');
      return {
        id: idOf(transit), description: description.value, descriptionEn: description.english,
        conditions: conditions.value, conditionsEn: conditions.english,
        destinationMapId, destinationName: destination.value, destinationNameEn: destination.english,
        ...geometry(transit),
      };
    });
    return {
      id: idOf(map), name: names.value, nameEn: names.english,
      normalizedName: readable(map.normalizedName),
      minPlayerLevel: countValue(map.minPlayerLevel), maxPlayerLevel: countValue(map.maxPlayerLevel),
      btrStops:references(map.btrStops).map(row=>({name:textPair(row.name,ko,en,'BTR 정류장').value,position:point(row.position||row)})).filter(row=>row.position),
      raidDuration: countValue(map.raidDuration), wikiLink: safeUrl(map.wiki),
      sourceURL, fetchedAt, switches: rawSwitches.map(switchDetails), extracts, transits,
      bosses: extractBossIntel(map,payload(bundle.maps).mobs).map(b=>({...b,name:textPair(b.name,ko,en,b.name).value,locations:b.locations.map(l=>({...l,name:textPair(l.name,ko,en,l.name).value}))})),
      hazards: extractHazards(map).map(h=>({...h,name:textPair(h.name,ko,en,h.name).value})),
      spawns: extractSpawns(map).map(s=>({...s,name:textPair(s.name,ko,en,s.name).value})),
      lootContainers: references(map.lootContainers).map(row=>({position:point(row.position),lootContainer:{name:textPair(row.lootContainer?.name,ko,en,row.lootContainer?.normalizedName||'파밍 컨테이너').value}})).filter(row=>row.position),
      lootLoose: references(map.lootLoose).map(row=>({position:point(row.position),items:references(row.items).map(item=>({id:idOf(item),name:textPair(item.name,ko,en,item.normalizedName||'').value})).filter(i=>i.name)})).filter(row=>row.position),
    };
  }).filter(map => map.id);
}

function normalizedOrdinaryItems(bundle) {
  const ko = dictionary(bundle.itemsKo), en = dictionary(bundle.itemsEn);
  return records(bundle.items, 'items').map(item => {
    const fallback = slugName(item.normalizedName, '이름 미등록 아이템');
    const names = textPair(item.name || item.shortName, ko, en, fallback);
    return {
      id: idOf(item), name: names.value, nameEn: names.english,
      imageLink: safeUrl(item.iconLink || item.imageLink),
      nameAvailable: names.value !== '이름 미등록 아이템',
      kind: 'item',
    };
  }).filter(item => item.id);
}

function detailContext(items, traders, tasks, ko = {}, en = {}) {
  const itemIndex = new Map(items.map(item => [item.id, item]));
  const traderIndex = new Map(traders.map(trader => [trader.id, trader]));
  const taskIndex = new Map(tasks.map(task => [task.id, task]));
  const local = (value, fallback = '') => textPair(value, ko, en, fallback).value;
  const resolveItem = (value, suppliedCount = null) => {
    const outer = value && typeof value === 'object' ? value : {};
    const reference = outer.item || value;
    const record = reference && typeof reference === 'object' ? reference : {};
    const id = idOf(reference);
    if (!id) return null;
    const known = itemIndex.get(id);
    const names = textPair(record.name || record.shortName, ko, en,
      slugName(record.normalizedName, '이름 미등록 아이템'));
    return {
      id,
      name: known?.name || names.value,
      nameEn: known?.nameEn || names.english,
      nameAvailable: known?.nameAvailable ?? names.value !== '이름 미등록 아이템',
      count: countValue(outer.count) ?? countValue(suppliedCount),
      imageLink: known?.imageLink || safeUrl(record.iconLink || record.imageLink),
    };
  };
  return {
    local, resolveItem,
    traderName: ref => traderIndex.get(idOf(ref))?.name
      || local(ref?.name || ref?.nickname, '상인 이름 미등록'),
    taskName: ref => taskIndex.get(idOf(ref))?.name
      || local(ref?.name, '퀘스트 이름 미등록'),
  };
}

function comparator(value) {
  if (!value || typeof value !== 'object') return null;
  const number = finite(value.value);
  const operator = ['>', '>=', '<', '<=', '=', '==', '!='].includes(value.compareMethod)
    ? value.compareMethod : null;
  return number === null ? null : {value: number, operator};
}

const comparisonText = comparison => comparison
  ? `${comparison.operator || '조건값'} ${comparison.value}` : '';
const BODY_NAMES = {Head: '머리', Chest: '가슴', Stomach: '복부',
  LeftArm: '왼팔', RightArm: '오른팔', LeftLeg: '왼다리', RightLeg: '오른다리'};
const STATE_NAMES = {complete: '완료', active: '진행 중', failed: '실패',
  succeeded: '목표 달성', available: '수락 가능', locked: '잠김'};
const HEALTH_NAMES = {Tremor: '떨림', Pain: '통증', Fracture: '골절',
  LightBleeding: '가벼운 출혈', HeavyBleeding: '심한 출혈', Dehydration: '탈수',
  Exhaustion: '탈진', Contusion: '혼란', Intoxication: '중독'};
const ATTRIBUTE_NAMES = {ergonomics: '인체공학', recoil: '반동', weight: '무게',
  durability: '내구도', effectiveDistance: '유효 거리', magazineCapacity: '탄창 용량',
  width: '가로 크기', height: '세로 크기', baseAccuracy: '정확도'};

function itemGroups(value, context) {
  if (!Array.isArray(value)) return [];
  // Preserve array boundaries. Do not flatten combinations into independent items.
  return value.map(group => (Array.isArray(group) ? group : [group])
    .map(item => context.resolveItem(item)).filter(Boolean)).filter(group => group.length);
}

function normalizeConditions(raw, context) {
  const localList = field => values(field).map(value => context.local(value)).filter(Boolean);
  const from = finite(raw.timeFromHour), until = finite(raw.timeUntilHour);
  const time = from !== null && until !== null && from >= 0 && from <= 24
    && until >= 0 && until <= 24 && from !== until && !(from === 0 && until === 24)
    ? {from, until} : null;
  const distance = comparator(raw.distance);
  const bodyParts = values(raw.bodyParts).map(value => {
    const suffix = typeof value === 'string' ? value.split('/').at(-1) : '';
    return BODY_NAMES[suffix] || context.local(value);
  }).filter(Boolean);
  const healthNotes = [];
  for (const [field, label] of [['playerHealthEffect', '본인 상태'], ['enemyHealthEffect', '대상 상태']]) {
    const effects = raw[field] ? (Array.isArray(raw[field]) ? raw[field] : [raw[field]]) : [];
    for (const effect of effects) {
      const names = values(effect.effects).map(value => HEALTH_NAMES[value] || context.local(value)).filter(Boolean);
      if (names.length) healthNotes.push(`${label}: ${names.join(' / ')}${effect.time ? ` · 시간 ${comparisonText(comparator(effect.time))}` : ''}`);
    }
  }
  return {
    requiredKeys: itemGroups(raw.requiredKeys, context),
    usingWeapon: values(raw.usingWeapon).map(value => context.resolveItem(value)).filter(Boolean),
    usingWeaponMods: itemGroups(raw.usingWeaponMods, context),
    wearing: itemGroups(raw.wearing, context),
    notWearing: itemGroups(raw.notWearing, context),
    containsAll: values(raw.containsAll).map(value => context.resolveItem(value)).filter(Boolean),
    targetNames: localList(raw.targetNames), bodyParts, time,
    distance: distance && !(distance.operator === '>=' && distance.value === 0) ? distance : null,
    zoneNames: localList(raw.zoneNames),
    exitName: context.local(raw.exitName),
    exitStatus: (Array.isArray(raw.exitStatus) ? raw.exitStatus : raw.exitStatus ? [raw.exitStatus] : [])
      .map(value => ({Survived: '생존 탈출', survived: '생존 탈출', Runner: '런스루', runner: '런스루'})[value] || context.local(value)).filter(Boolean),
    dogTagLevel: countValue(raw.dogTagLevel),
    minDurability: countValue(raw.minDurability), maxDurability: countValue(raw.maxDurability),
    attributes: values(raw.attributes).filter(Boolean).map(attribute => ({
      name: ATTRIBUTE_NAMES[attribute.name] || context.local(attribute.name, '조립 성능'),
      comparison: comparator(attribute.requirement),
    })).filter(attribute => attribute.comparison),
    healthNotes,
  };
}

function conditionNotes(conditions) {
  const notes = [];
  if (conditions.requiredKeys.length) {
    notes.push(`필요 열쇠: ${conditions.requiredKeys.map(group => `(${group.map(item => item.name).join(' 또는 ')})`).join(' + ')}`);
  }
  if (conditions.usingWeapon.length) notes.push(`사용 무기: ${conditions.usingWeapon.map(item => item.name).join(' 또는 ')}`);
  for (const [field, label] of [['usingWeaponMods', '무기 부착물'], ['wearing', '착용 장비'], ['notWearing', '착용 금지 장비']]) {
    const groups = conditions[field];
    if (groups.length) {
      // Group logic is not assumed to match the key-alternative convention.
      notes.push(`${label} 조건: ${groups.map((group, index) => `${groups.length > 1 ? `그룹 ${index + 1} ` : ''}(${group.map(item => item.name).join(', ')})`).join(' / ')}${groups.length > 1 || groups.some(group => group.length > 1) ? ' · 조합은 원문 확인' : ''}`);
    }
  }
  if (conditions.containsAll.length) notes.push(`모두 포함할 부품: ${conditions.containsAll.map(item => item.name).join(' + ')}`);
  if (conditions.targetNames.length) notes.push(`대상: ${conditions.targetNames.join(' / ')}`);
  if (conditions.bodyParts.length) notes.push(`명중 부위: ${conditions.bodyParts.join(' / ')}`);
  if (conditions.time) {
    const clock = value => {
      const minutes = Math.round(value * 60);
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    };
    notes.push(`게임 시간: ${clock(conditions.time.from)}–${clock(conditions.time.until)}`);
  }
  if (conditions.distance) notes.push(`거리: ${comparisonText(conditions.distance)} m`);
  if (conditions.zoneNames.length) notes.push(`구역: ${conditions.zoneNames.join(' / ')}`);
  if (conditions.exitName) notes.push(`탈출구: ${conditions.exitName}`);
  if (conditions.exitStatus.length) notes.push(`탈출 결과 조건: ${conditions.exitStatus.join(' / ')}`);
  if (conditions.dogTagLevel > 0) notes.push(`인식표 레벨: ${conditions.dogTagLevel} 이상`);
  if (conditions.minDurability > 0) notes.push(`최소 내구도: ${conditions.minDurability}`);
  if (conditions.maxDurability !== null && conditions.maxDurability < 100) notes.push(`최대 내구도: ${conditions.maxDurability}`);
  for (const attribute of conditions.attributes) notes.push(`${attribute.name}: ${comparisonText(attribute.comparison)}`);
  notes.push(...conditions.healthNotes);
  return notes;
}

function normalizeRewards(raw = {}, context) {
  const reward = raw || {};
  const normalized = {
    items: values(reward.items).map(item => context.resolveItem(item)).filter(Boolean),
    traderStanding: values(reward.traderStanding).filter(Boolean).map(standing => ({
      traderId: idOf(standing.trader), traderName: context.traderName(standing.trader),
      standing: finite(standing.standing),
    })).filter(standing => standing.standing !== null),
    offerUnlock: values(reward.offerUnlock).filter(Boolean).map(offer => ({
      traderId: idOf(offer.trader), traderName: context.traderName(offer.trader),
      level: countValue(offer.level), item: context.resolveItem(offer.item),
    })),
    skillLevelReward: values(reward.skillLevelReward).filter(Boolean).map(skill => ({
      name: context.local(skill.name, '스킬 이름 미등록'), level: finite(skill.level),
    })),
    traderUnlock: values(reward.traderUnlock).map(trader => ({id: idOf(trader), name: context.traderName(trader)})),
    craftUnlockCount: values(reward.craftUnlock).length,
    achievementCount: values(reward.achievement).length,
    customizationCount: values(reward.customization).length,
  };
  return {...normalized, notes: rewardNotes(normalized)};
}

function rewardNotes(reward) {
  const notes = reward.items.map(item => `${item.name}${item.count !== null ? ` × ${item.count.toLocaleString('ko-KR')}` : ''}`);
  notes.push(...reward.traderStanding.map(standing => `${standing.traderName} 평판 ${standing.standing >= 0 ? '+' : ''}${standing.standing}`));
  notes.push(...reward.offerUnlock.map(offer => `판매 해금: ${offer.traderName}${offer.level !== null ? ` LL${offer.level}` : ''}${offer.item ? ` · ${offer.item.name}` : ''}`));
  notes.push(...reward.skillLevelReward.map(skill => `스킬 보상: ${skill.name}${skill.level !== null ? ` ${skill.level}` : ''}`));
  notes.push(...reward.traderUnlock.map(trader => `상인 해금: ${trader.name}`));
  if (reward.craftUnlockCount) notes.push(`제작법 해금 ${reward.craftUnlockCount}개 · 상세 원문 참고`);
  if (reward.achievementCount) notes.push(`업적 보상 ${reward.achievementCount}개 · 상세 원문 참고`);
  if (reward.customizationCount) notes.push(`커스터마이징 보상 ${reward.customizationCount}개 · 상세 원문 참고`);
  return notes;
}

function addTaskDetails(task, context) {
  const raw = task.raw || {};
  const requirementNotes = [];
  if (task.factionName && !['any', 'all'].includes(task.factionName.toLowerCase())) requirementNotes.push(`진영: ${task.factionName}`);
  if (task.requiredPrestige > 0) requirementNotes.push(`프레스티지: ${task.requiredPrestige}`);
  const traderRequirements = values(raw.traderRequirements).filter(Boolean).map(requirement => {
    const type = readable(requirement.requirementType, '조건');
    const compare = comparator(requirement);
    const name = context.traderName(requirement.trader);
    const label = {level: '충성도', reputation: '평판', standing: '평판'}[type] || type;
    if (compare) requirementNotes.push(`${name} ${label}: ${comparisonText(compare)}`);
    return {traderId: idOf(requirement.trader), traderName: name, type, comparison: compare};
  });
  const delayMin = countValue(raw.availableDelaySecondsMin), delayMax = countValue(raw.availableDelaySecondsMax);
  if (delayMin > 0 || delayMax > 0) {
    requirementNotes.push(`수락 대기 시간: ${delayMin ?? '?'}${delayMax !== null && delayMax !== delayMin ? `–${delayMax}` : ''}초`);
  }
  const failureNotes = values(raw.failConditions).filter(Boolean).map(condition => {
    const description = context.local(condition.description);
    if (description) return description;
    if (condition.task) {
      const status = (Array.isArray(condition.status) ? condition.status : [condition.status])
        .map(value => STATE_NAMES[value] || context.local(value)).filter(Boolean);
      return `${context.taskName(condition.task)}${status.length ? `: ${status.join(' 또는 ')}` : ''}`;
    }
    return '실패 조건이 등록되어 있습니다. 상세 원문을 확인하세요.';
  });
  return {
    ...task, requirementNotes, traderRequirements, failureNotes,
    startRewards: normalizeRewards(raw.startRewards, context),
    finishRewards: normalizeRewards(raw.finishRewards, context),
    failureOutcome: normalizeRewards(raw.failureOutcome, context),
    objectives: task.objectives.map(objective => {
      const conditions = normalizeConditions(objective.raw || {}, context);
      return {...objective, conditions, requiredKeys: conditions.requiredKeys,
        itemChoiceMode: objective.items.length > 1 ? 'alternatives' : 'single',
        conditionNotes: conditionNotes(conditions)};
    }),
  };
}

/**
 * Uses only the API's explicit map-position associations.
 * A quest's main map is never used to guess a missing location's map.
 * Zone centres are marked as zones; possibleLocations are candidate spawns.
 */
function objectiveLocations(objective, label) {
  const result = [];
  const seen = new Set();
  const add = (mapReference, position, kind, extra = {}) => {
    const mapId = idOf(mapReference);
    const xyz = point(position);
    if (!mapId || !xyz) return;
    const key = `${mapId}:${xyz.x}:${xyz.y}:${xyz.z}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({mapId, ...xyz, label, kind, ...extra});
  };

  for (const zone of values(objective.zones)) {
    if (!zone || typeof zone !== 'object') continue;
    const outline = values(zone.outline).map(point).filter(Boolean);
    add(zone.map, zone.position, 'zone', {
      zoneId: idOf(zone),
      outline,
      top: finite(zone.top),
      bottom: finite(zone.bottom),
    });
  }
  for (const location of values(objective.possibleLocations)) {
    if (!location || typeof location !== 'object') continue;
    for (const position of values(location.positions)) {
      add(location.map, position, 'possible');
    }
  }
  return result;
}

// Official/community trader IDs are only used when documented. New API traders
// are added dynamically; names are never guessed from unknown 24-character IDs.
const TRADER_ROSTER = [
  ['prapor', '프라퍼', 'Prapor', '54cb50c76803fa8b248b4571'],
  ['therapist', '테라피스트', 'Therapist', '54cb57776803fa99248b456e'],
  ['fence', '펜스', 'Fence', '579dc571d53a0658a154fbec'],
  ['skier', '스키어', 'Skier', '58330581ace78e27b8b10cee'],
  ['peacekeeper', '피스키퍼', 'Peacekeeper', '5935c25fb3acc3127c3d8cd9'],
  ['mechanic', '메카닉', 'Mechanic', '5a7c2eca46aef81a7ca2145d'],
  ['ragman', '래그맨', 'Ragman', '5ac3b934156ae10c4430e83c'],
  ['jaeger', '예거', 'Jaeger', '5c0647fdd443bc2504c2d371'],
  ['lightkeeper', '라이트키퍼', 'Lightkeeper', '638f541a29ffd1183d187f57'],
  ['btr-driver', 'BTR 운전수', 'BTR Driver', null],
  ['ref', '레프', 'Ref', '6617beeaa9cfa777ca915b7c'],
];
const TRADERS_BY_ID = new Map(TRADER_ROSTER.filter(row => row[3]).map(row => [row[3], row]));
const TRADERS_BY_SLUG = new Map(TRADER_ROSTER.map(row => [row[0], row]));
const TRADER_ALIASES = new Map([
  ['btrdriver', 'btr-driver'], ['btr-driver', 'btr-driver'],
  ['lighthousekeeper', 'lightkeeper'], ['lighthouse-keeper', 'lightkeeper'],
  ['arena', 'ref'], ['arena-ref', 'ref'],
]);
function traderSlug(value) {
  const key = readable(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return TRADER_ALIASES.get(key) || key;
}
function officialTrader(rawId, slugOrName = '') {
  return TRADERS_BY_ID.get(rawId) || TRADERS_BY_SLUG.get(traderSlug(slugOrName)) || null;
}
function localizedTraderName(raw, translationsKo, translationsEn, fallback = '') {
  if (!raw || typeof raw !== 'object') return null;
  const alias = officialTrader(idOf(raw), raw.normalizedName || raw.nickname || raw.name);
  const provided = textPair(raw.name || raw.nickname, translationsKo, translationsEn);
  const translated = provided.value && !/^상인 정보/.test(provided.value);
  return {id: idOf(raw) || alias?.[3] || (alias ? 'trader:'+alias[0] : ''),
    name: translated ? provided.value : alias?.[1] || slugName(raw.normalizedName, fallback),
    nameEn: provided.english || alias?.[2] || slugName(raw.normalizedName, fallback),
    normalizedName: traderSlug(raw.normalizedName || alias?.[0] || ''),
    imageLink: safeUrl(raw.imageLink)};
}

/** Pure normalization: no network and no mutation of the caller's documents. */
export function normalizeDataset(rawBundle = {}) {
  const tasksKo = dictionary(rawBundle.tasksKo);
  const tasksEn = dictionary(rawBundle.tasksEn);
  const tradersKo = dictionary(rawBundle.tradersKo);
  const tradersEn = dictionary(rawBundle.tradersEn);
  const itemsKo = dictionary(rawBundle.itemsKo);
  const itemsEn = dictionary(rawBundle.itemsEn);
  const partialWarnings = [...(rawBundle.partialWarnings || [])];
  const fetchedAt = rawBundle.fetchedAt || new Date().toISOString();
  const maps = normalizedMaps(rawBundle, rawBundle.mapsFetchedAt || fetchedAt);

  const suppliedTraders = records(rawBundle.traders, 'traders')
    .map(trader => localizedTraderName(trader, tradersKo, tradersEn))
    .filter(trader => trader && trader.id && trader.name);
  // Always show the eleven supported traders in the filter, even when an API
  // entry is missing or the game mode has no tasks for that trader.
  // Keep newly introduced / non-standard traders from the data feed too.
  const traders = [...suppliedTraders];
  const traderIds = new Set(traders.map(trader => trader.id));
  const traderSlugs = new Set(traders.map(trader => trader.normalizedName));
  for (const [slug, name, nameEn, knownId] of TRADER_ROSTER) {
    if (traderSlugs.has(slug) || (knownId && traderIds.has(knownId))) continue;
    const id = knownId || 'trader:'+slug;
    traders.push({id, name, nameEn, normalizedName:slug, imageLink:''});
    traderIds.add(id); traderSlugs.add(slug);
  }
  const tradersById = new Map(traders.map(trader => [trader.id, trader]));
  const tradersBySlug = new Map(traders.map(trader => [trader.normalizedName, trader]));

  // Collectibles are bundled with /tasks. Ordinary item metadata is a separate,
  // much larger endpoint and is deliberately not downloaded on first load.
  const questItems = records(rawBundle.tasks, 'questItems');
  const ordinaryItems = normalizedOrdinaryItems(rawBundle);
  const collectibleItems = questItems.map(item => {
    const names = textPair(item.name || item.shortName, tasksKo, tasksEn,
      slugName(item.normalizedName, '퀘스트 물품'));
    return {
      id: idOf(item), name: names.value, nameEn: names.english,
      imageLink: safeUrl(item.imageLink || item.iconLink),
      nameAvailable: names.value !== '퀘스트 물품', kind: 'questItem',
    };
  }).filter(item => item.id);
  const items = [...new Map([...ordinaryItems, ...collectibleItems].map(item => [item.id, item])).values()];
  const itemsById = new Map(items.map(item => [item.id, item]));

  let untranslatedNames = 0;
  const tasks = records(rawBundle.tasks, 'tasks').map(task => {
    const fallbackName = slugName(task.normalizedName, '이름 번역 미등록 퀘스트');
    const names = textPair(task.name, tasksKo, tasksEn, fallbackName);
    if (!lookup(task.name, tasksKo)) untranslatedNames += 1;
    const rawTrader = task.trader ?? task.traderId ?? task.taskGiver ?? task.giver ?? task.vendor;
    const rawTraderId = idOf(rawTrader);
    const embedded = rawTrader && typeof rawTrader === 'object'
      ? localizedTraderName(rawTrader, tradersKo, tradersEn) : null;
    const fallbackSlug = traderSlug(embedded?.normalizedName || task.traderNormalizedName
      || task.traderName || (typeof rawTrader === 'string' ? rawTrader : ''));
    const official = officialTrader(rawTraderId, fallbackSlug);
    const trader = tradersById.get(rawTraderId) || tradersBySlug.get(fallbackSlug)
      || (official && (tradersById.get(official[3]) || tradersBySlug.get(official[0])));
    const traderId = trader?.id || rawTraderId || embedded?.id || null;
    // Missing translations do not prevent showing the canonical Korean name.
    // If an unknown trader really cannot be determined, say so explicitly.
    const traderName = trader?.name || embedded?.name || official?.[1] || '상인 확인 필요';
    const traderNameEn = trader?.nameEn || embedded?.nameEn || official?.[2] || '';

    const objectives = values(task.objectives).filter(Boolean).map(objective => {
      const descriptions = textPair(objective.description, tasksKo, tasksEn, '목표 설명 번역 미등록');
      const locations = objectiveLocations(objective, descriptions.value);
      const itemCandidates = [
        ...values(objective.items),
        ...(objective.item ? [objective.item] : []),
        ...(objective.questItem ? [objective.questItem] : []),
      ];
      const seenItems = new Set();
      const normalizedItems = itemCandidates.flatMap(candidate => {
        const record = candidate && typeof candidate === 'object' ? candidate : {};
        const itemReference = record.item || candidate;
        const itemId = idOf(itemReference);
        if (!itemId || seenItems.has(itemId)) return [];
        seenItems.add(itemId);
        const resolved = itemsById.get(itemId);
        const itemRecord = itemReference && typeof itemReference === 'object' ? itemReference : record;
        const localizedName = textPair(itemRecord.name || itemRecord.shortName, tasksKo, tasksEn).value;
        return [{
          id: itemId,
          name: resolved?.name || localizedName || '아이템 이름은 목표 설명 참고',
          nameEn: resolved?.nameEn || readable(itemRecord.name),
          count: countValue(record.count) ?? countValue(objective.count),
          nameAvailable: Boolean(resolved?.name || localizedName),
        }];
      });
      return {
        id: idOf(objective),
        type: readable(objective.type, 'unknown'),
        description: descriptions.value,
        descriptionEn: descriptions.english,
        count: countValue(objective.count),
        foundInRaid: objective.foundInRaid === true,
        optional: objective.optional === true,
        mapIds: unique([...idsOf(objective.maps), ...locations.map(location => location.mapId)]),
        locations,
        items: normalizedItems,
        // Conditions such as keys, time, weapon and distance remain available.
        raw: objective,
      };
    });

    const requirements = values(task.taskRequirements).filter(Boolean).flatMap(requirement => {
      const taskId = idOf(requirement.task);
      if (!taskId) return [];
      const status = (Array.isArray(requirement.status) ? requirement.status : [requirement.status])
        .filter(state => typeof state === 'string' && state);
      return [{taskId, status}];
    });

    return {
      id: idOf(task),
      name: names.value,
      nameEn: names.english,
      normalizedName: readable(task.normalizedName),
      traderId,
      traderName,
      traderNameEn,
      minPlayerLevel: countValue(task.minPlayerLevel),
      experience: countValue(task.experience),
      kappaRequired: task.kappaRequired === true,
      lightkeeperRequired: task.lightkeeperRequired === true,
      wikiLink: safeUrl(task.wikiLink),
      taskImageLink: safeUrl(task.taskImageLink),
      factionName: readable(task.factionName),
      requiredPrestige: countValue(task.requiredPrestige),
      mapIds: unique([...idsOf(task.map), ...objectives.flatMap(objective => objective.mapIds)]),
      objectives,
      requirements,
      neededKeys: values(task.neededKeys || task.keysNeeded || task.requiredKeys).map(key => {
        const row = key && typeof key === 'object' ? key : {item:key};
        const item = row.item || row.key || key;
        const itemId = idOf(item);
        const resolved = itemsById.get(itemId);
        return itemId ? {id:itemId,name:resolved?.name || (typeof item === 'object' ? readable(item.name) : ''),nameEn:resolved?.nameEn || '',quantity:countValue(row.count || row.quantity) || 1} : null;
      }).filter(Boolean),
      raw: task,
    };
  }).filter(task => task.id);

  if (!maps.length) partialWarnings.push('지도 목록을 불러오지 못했습니다. 지도 이름과 지도별 필터가 제한됩니다.');
  if (!suppliedTraders.length) partialWarnings.push('상인 서버 응답이 없어 확인된 기본 명칭으로 표시했습니다. 새 상인은 추가 확인이 필요합니다.');
  const unresolvedTraders = tasks.filter(task => task.traderName === '상인 확인 필요').length;
  if (unresolvedTraders) partialWarnings.push(`상인 소속을 확인할 수 없는 퀘스트 ${unresolvedTraders}개가 있습니다.`);
  if (tasks.length && untranslatedNames === tasks.length) {
    partialWarnings.push('한국어 퀘스트 이름을 불러오지 못해 영어 또는 공개 식별명을 표시합니다.');
  }

  const context = detailContext(items, traders, tasks,
    {...itemsKo, ...tasksKo, ...tradersKo}, {...itemsEn, ...tasksEn, ...tradersEn});
  return {
    tasks: tasks.map(task => addTaskDetails(task, context)),
    maps,
    traders,
    items,
    allItemNamesLoaded: ordinaryItems.length > 0,
    mode: rawBundle.mode || 'regular',
    fetchedAt,
    source: BASE_URL,
    partialWarnings: unique(partialWarnings),
  };
}

async function getJson(path, {signal, timeoutMs = 22000} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, {once: true});
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}/${path}`, {
      method: 'GET', mode: 'cors', credentials: 'omit',
      headers: {Accept: 'application/json'}, signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`tarkov.dev HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const document = await response.json();
    if (!document || typeof document !== 'object') throw new Error('유효한 JSON 응답이 아닙니다.');
    return document;
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      const timeoutError = new Error('tarkov.dev 응답 시간이 초과되었습니다.');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Fetch the requested game mode without silently substituting another mode. */
export async function fetchQuestDataset(mode = 'regular', {signal, onProgress, onMaps} = {}) {
  if (!KNOWN_MODES.includes(mode)) throw new Error('지원하지 않는 게임 모드입니다.');
  const partialWarnings = [];
  const progress = message => {
    if (typeof onProgress === 'function') onProgress(message);
  };
  const assertNotAborted = () => {
    if (signal?.aborted) throw new DOMException('데이터 불러오기가 취소되었습니다.', 'AbortError');
  };

  assertNotAborted();
  progress('공개 데이터 목록을 확인하고 있습니다…');
  let catalog;
  try {
    catalog = payload(await getJson('endpoints', {signal, timeoutMs: 10000}));
  } catch (error) {
    assertNotAborted();
    partialWarnings.push('데이터 목록 확인에 실패했습니다. 선택한 모드의 알려진 주소로 조회했습니다.');
  }
  if (Array.isArray(catalog?.gameModes) && !catalog.gameModes.includes(mode)) {
    throw new Error('공개 데이터에서 선택한 게임 모드를 제공하지 않습니다. 다른 모드를 선택해 주세요.');
  }

  progress('퀘스트·지도·한국어 이름을 불러오고 있습니다…');
  const names = ['tasks', 'maps', 'traders'];
  const requests = names.flatMap(name => [
    {key: name, path: `${mode}/${name}`, kind: name},
    {key: `${name}Ko`, path: `${mode}/${name}_ko`, kind: `${name}_ko`},
    {key: `${name}En`, path: `${mode}/${name}_en`, kind: `${name}_en`},
  ]);
  let complete = 0;
  const pendingRequests = requests.map(async request => {
    try {
      return await getJson(request.path, {signal});
    } finally {
      complete += 1;
      progress(`공개 데이터 불러오는 중 · ${complete}/${requests.length}`);
    }
  });
  const labels = {
    maps: '지도 목록', traders: '상인 목록',
    tasks_ko: '퀘스트 한국어', tasks_en: '퀘스트 영어',
    maps_ko: '지도 한국어', maps_en: '지도 영어',
    traders_ko: '상인 한국어', traders_en: '상인 영어',
  };
  // Reuse exactly the requests above. An unrelated task outage must not hide
  // successfully retrieved extracts or make users wait for the task timeout.
  const mapsReady = Promise.allSettled(pendingRequests.slice(3, 6)).then(async responses => {
    assertNotAborted();
    const mapBundle = {mode, fetchedAt: new Date().toISOString()};
    const mapWarnings = [...partialWarnings];
    responses.forEach((response, offset) => {
      const request = requests[offset + 3];
      if (response.status === 'fulfilled') mapBundle[request.key] = response.value;
      else mapWarnings.push(`${labels[request.kind]} 데이터를 불러오지 못했습니다.`);
    });
    const maps = normalizedMaps(mapBundle, mapBundle.fetchedAt);
    if (!maps.length && responses[0].status === 'fulfilled') {
      mapWarnings.push('공개 데이터에 유효한 지도 목록이 없습니다.');
    }
    const snapshot = {maps, mode, fetchedAt: mapBundle.fetchedAt, source: BASE_URL,
      partialWarnings: unique(mapWarnings)};
    if (typeof onMaps === 'function') await onMaps(snapshot);
    return snapshot;
  });
  const [responses, mapSnapshot] = await Promise.all([Promise.allSettled(pendingRequests), mapsReady]);
  assertNotAborted();

  const bundle = {mode, fetchedAt: new Date().toISOString(), mapsFetchedAt: mapSnapshot.fetchedAt, partialWarnings};
  const failed = [];
  responses.forEach((response, index) => {
    const request = requests[index];
    if (response.status === 'fulfilled') bundle[request.key] = response.value;
    else failed.push(request.kind);
  });
  if (!bundle.tasks || !records(bundle.tasks, 'tasks').length) {
    const error = new Error('퀘스트 데이터를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    error.failedEndpoints = failed;
    throw error;
  }
  if (failed.length) {
    partialWarnings.push(`일부 데이터를 불러오지 못했습니다: ${failed.map(name => labels[name] || name).join(', ')}.`);
  }
  progress('퀘스트와 지도 목표를 정리하고 있습니다…');
  const dataset = normalizeDataset(bundle);
  progress(`${dataset.tasks.length.toLocaleString('ko-KR')}개 퀘스트를 불러왔습니다.`);
  return dataset;
}

/** Fetch ordinary item names on demand. No prices or giant raw payload are retained. */
export async function fetchItemCatalog(mode = 'regular', {signal, onProgress} = {}) {
  if (!KNOWN_MODES.includes(mode)) throw new Error('지원하지 않는 게임 모드입니다.');
  if (signal?.aborted) throw new DOMException('데이터 불러오기가 취소되었습니다.', 'AbortError');
  onProgress?.('아이템 이름을 추가로 불러오고 있습니다…');
  const endpoints = ['items', 'items_ko', 'items_en'];
  const responses = await Promise.allSettled(endpoints.map(endpoint => getJson(`${mode}/${endpoint}`, {
    signal, timeoutMs: 35000,
  })));
  if (signal?.aborted) throw new DOMException('데이터 불러오기가 취소되었습니다.', 'AbortError');
  if (responses[0].status !== 'fulfilled') throw new Error('아이템 이름 목록을 불러오지 못했습니다.');
  const bundle = {
    items: responses[0].value,
    itemsKo: responses[1].status === 'fulfilled' ? responses[1].value : {},
    itemsEn: responses[2].status === 'fulfilled' ? responses[2].value : {},
  };
  const items = normalizedOrdinaryItems(bundle);
  if (!items.length) throw new Error('공개 데이터에 유효한 아이템 목록이 없습니다.');
  const partialWarnings = [];
  if (responses[1].status !== 'fulfilled') partialWarnings.push('아이템 한국어 번역을 불러오지 못해 영어 이름을 사용합니다.');
  if (responses[2].status !== 'fulfilled') partialWarnings.push('아이템 영어 번역을 불러오지 못했습니다.');
  onProgress?.(`${items.length.toLocaleString('ko-KR')}개 아이템 이름을 불러왔습니다.`);
  return {items, mode, fetchedAt: new Date().toISOString(), source: BASE_URL, partialWarnings};
}

/** Apply a lazily fetched item catalog without changing quest progress or coordinates. */
export function applyItemCatalog(dataset, catalog) {
  if (!dataset || !catalog || dataset.mode !== catalog.mode) {
    throw new Error('아이템 목록과 퀘스트 데이터의 게임 모드가 다릅니다.');
  }
  const items = [...new Map([...(dataset.items || []), ...(catalog.items || [])]
    .map(item => [item.id, item])).values()];
  const index = new Map(items.map(item => [item.id, item]));
  const refresh = item => {
    if (!item) return item;
    const named = index.get(item.id);
    return named ? {...item, name: named.name, nameEn: named.nameEn,
      nameAvailable: named.nameAvailable, imageLink: named.imageLink} : {...item};
  };
  const refreshReward = reward => {
    if (!reward) return reward;
    const result = {...reward, items: reward.items.map(refresh),
      offerUnlock: reward.offerUnlock.map(offer => ({...offer, item: refresh(offer.item)}))};
    result.notes = rewardNotes(result);
    return result;
  };
  return {
    ...dataset, items, allItemNamesLoaded: true, itemNamesFetchedAt: catalog.fetchedAt,
    partialWarnings: unique([...(dataset.partialWarnings || []), ...(catalog.partialWarnings || [])]),
    tasks: dataset.tasks.map(task => ({
      ...task,
      startRewards: refreshReward(task.startRewards),
      finishRewards: refreshReward(task.finishRewards),
      failureOutcome: refreshReward(task.failureOutcome),
      objectives: task.objectives.map(objective => {
        const conditions = objective.conditions ? {...objective.conditions} : null;
        if (conditions) {
          for (const field of ['requiredKeys', 'usingWeaponMods', 'wearing', 'notWearing']) {
            conditions[field] = conditions[field].map(group => group.map(refresh));
          }
          for (const field of ['usingWeapon', 'containsAll']) conditions[field] = conditions[field].map(refresh);
        }
        return {...objective, items: objective.items.map(refresh),
          ...(conditions ? {conditions, requiredKeys: conditions.requiredKeys,
            conditionNotes: conditionNotes(conditions)} : {})};
      }),
    })),
  };
}
