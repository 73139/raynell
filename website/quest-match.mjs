/**
 * Pure matching of OCR text against already loaded task.name / task.nameEn.
 * No OCR engine, requests, progress changes, pins, or inferred task definitions.
 *
 * Confidence values use Tesseract's 0–100 scale. `matches` contains only rows
 * safe for automatic selection; every fuzzy/ambiguous/low-confidence result is
 * in `candidates`. A score describes text similarity, not a probability.
 */

const AUTO_CONFIDENCE = 80;
const SHORT_AUTO_CONFIDENCE = 90;
const MAX_TEXT_LENGTH = 100000;
const MAX_LINES = 250;
const MAX_LINE_LENGTH = 500;
const MAX_CANDIDATES = 40;
const UI_LABELS = [
  'ready for turn in', 'ready to complete', 'in progress', 'task completed',
  'completed', 'complete', 'available', 'active', 'accepted', 'started',
  'locked', 'failed', 'finished', 'success', 'status', 'tasks', 'task', 'quests', 'quest',
  '진행 중', '수행 중', '수락 가능', '완료 가능', '수락됨', '선택됨', '미완료',
  '완료', '시작', '수락', '실패', '잠김', '진행', '상태', '퀘스트', '임무',
];
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LATIN = /[a-z]/i;
const DIGIT = /\d/;

function confidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : null;
}
function surface(value) {
  return typeof value === 'string' ? value.normalize('NFKC').normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').toLowerCase() : '';
}
/** Unicode/case/spacing/punctuation normalization; digits are never corrected. */
export function normalizeQuestText(value) {
  return surface(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const compact = value => normalizeQuestText(value).replace(/ /g, '');

function representation(value) {
  const chars = Array.from(surface(value));
  const positions = [], letters = [];
  chars.forEach((char, index) => {
    if (LETTER_OR_NUMBER.test(char)) {
      letters.push(char);
      // String.indexOf returns UTF-16 offsets, including supplementary letters.
      for (let unit = 0; unit < char.length; unit += 1) positions.push(index);
    }
  });
  return {chars, positions, compact: letters.join('')};
}
function readableName(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const name = value.trim();
  return /^[a-f\d]{24}(?:\s.*)?$/i.test(name) || /^(?:Quest|QuestCondition)\//.test(name)
    || /^(?:이름 번역 미등록 퀘스트|퀘스트 이름 미등록|이름 미등록 퀘스트)$/.test(name) ? '' : name;
}
function digitSignature(value) { return (value.match(/\d+/g) || []).join('|'); }
function shortAlias(alias) {
  return alias.length < 5 || (/^[a-z0-9]+$/i.test(alias.compact)
    && alias.words === 1 && alias.length < 8);
}
function uiTokens(task) {
  return [...new Set([...UI_LABELS, task.traderName, task.traderNameEn]
    .map(compact).filter(Boolean))].sort((a, b) => b.length - a.length);
}
function stripStructuredUI(value) {
  return surface(value)
    .replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/(?:\blv\.?|\blevel|레벨)\s*\.?\s*\d+/gu, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/^\s*\d{1,3}[.)]\s*/u, ' ');
}
function uiAffix(value, tokens) {
  let remaining = compact(stripStructuredUI(value));
  if (remaining.length > 100) return false;
  while (remaining) {
    const token = tokens.find(candidate => remaining.startsWith(candidate));
    if (!token) return false;
    remaining = remaining.slice(token.length);
  }
  return true;
}
function fuzzyLine(value, tokens) {
  let remaining = compact(stripStructuredUI(value));
  let changed = true;
  while (remaining && changed) {
    changed = false;
    for (const token of tokens) {
      if (remaining.startsWith(token)) { remaining = remaining.slice(token.length); changed = true; break; }
      if (remaining.endsWith(token)) { remaining = remaining.slice(0, -token.length); changed = true; break; }
    }
  }
  return remaining;
}

function buildTasks(tasks) {
  const byId = new Map(), aliases = new Map();
  for (const raw of Array.isArray(tasks) ? tasks : []) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
    const names = [readableName(raw.name), readableName(raw.nameEn)].filter(Boolean);
    if (!names.length) continue;
    let task = byId.get(raw.id);
    if (!task) {
      task = {id: raw.id, name: names[0], aliases: [], tokens: uiTokens(raw)};
      byId.set(raw.id, task);
    }
    for (const name of names) {
      const normalized = normalizeQuestText(name), key = normalized.replace(/ /g, '');
      if (!key || task.aliases.some(alias => alias.compact === key)) continue;
      const alias = {name, compact: key, length: Array.from(key).length,
        words: normalized.split(' ').length, digits: digitSignature(normalized)};
      task.aliases.push(alias);
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(raw.id);
    }
  }
  return {tasks: [...byId.values()], aliases};
}

function lineConfidenceResolver(globalConfidence, lineConfidences) {
  const fallback = confidence(globalConfidence);
  const indexed = new Map();
  for (const row of Array.isArray(lineConfidences) ? lineConfidences : []) {
    if (!row || typeof row.text !== 'string') continue;
    const key = compact(row.text);
    if (!key) continue;
    // Invalid duplicate confidence is not silently discarded in favor of a high one.
    const value = confidence(row.confidence);
    if (!indexed.has(key)) indexed.set(key, []);
    indexed.get(key).push(value);
  }
  return line => {
    const supplied = indexed.get(line.compact);
    if (!supplied) return {value: fallback, source: fallback === null ? 'missing' : 'global'};
    if (supplied.every(value => value === null)) return {value: fallback, source: fallback === null ? 'missing' : 'global'};
    const resolved = supplied.map(value => value ?? fallback);
    return {value: resolved.some(value => value === null) ? null : Math.min(...resolved), source: 'line'};
  };
}

function exactOccurrence(line, alias, tokens) {
  const found = [];
  let start = line.compact.indexOf(alias.compact);
  while (start !== -1) {
    const end = start + alias.compact.length;
    const firstPosition = line.positions[start], lastPosition = line.positions[end - 1];
    const before = line.chars[firstPosition - 1] || '', after = line.chars[lastPosition + 1] || '';
    // A part number cannot be a prefix/suffix of another number, even if OCR adds spaces.
    const prefix = line.chars.slice(0, firstPosition).join('');
    const suffix = line.chars.slice(lastPosition + 1).join('');
    const full = start === 0 && end === line.compact.length;
    const titleContext = full || (uiAffix(prefix, tokens) && uiAffix(suffix, tokens));
    const numeralConflict = (DIGIT.test(alias.compact[0]) && DIGIT.test(line.compact[start - 1] || '')
      && (DIGIT.test(before) || !titleContext))
      || (DIGIT.test(alias.compact.at(-1)) && DIGIT.test(line.compact[end] || '')
        && (DIGIT.test(after) || !titleContext));
    const lexicalBoundary = !(LATIN.test(alias.compact[0]) && LETTER_OR_NUMBER.test(before))
      && !(LATIN.test(alias.compact.at(-1)) && LETTER_OR_NUMBER.test(after));
    if (!numeralConflict && (titleContext || lexicalBoundary)) {
      const observedTitle = line.chars.slice(firstPosition, lastPosition + 1).join('');
      found.push({start, end, titleContext,
        numericAmbiguity: digitSignature(observedTitle) !== alias.digits,
        kind: full ? 'exact' : 'exact-phrase',
        score: full ? 1 : titleContext ? 0.99 : 0.98});
    }
    start = line.compact.indexOf(alias.compact, start + 1);
  }
  return found.sort((a, b) => Number(b.titleContext) - Number(a.titleContext) || b.score - a.score)[0] || null;
}

// Optimal-string-alignment distance catches a single OCR transposition without
// changing any observed character (especially I/l/1 and O/0) into an exact match.
function editDistance(left, right) {
  const a = Array.from(left), b = Array.from(right);
  let previousPrevious = null, previous = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], previousPrevious[j - 2] + 1);
      }
    }
    previousPrevious = previous; previous = current;
  }
  return previous[b.length];
}
const rank = row => row.kind === 'exact' ? 3 : row.kind === 'exact-phrase' ? 2 : 1;
function compareRows(a, b) {
  return Number(b.automatic) - Number(a.automatic) || rank(b) - rank(a) || b.score - a.score
    || (b.ocrConfidence ?? -1) - (a.ocrConfidence ?? -1) || a.lineIndex - b.lineIndex
    || a.taskId.localeCompare(b.taskId);
}
function resultRow(task, alias, line, certainty, properties) {
  return {taskId: task.id, name: task.name, matchedName: alias.name,
    evidence: line.original, lineIndex: line.index,
    ocrConfidence: certainty.value, confidenceSource: certainty.source,
    ...properties};
}

/**
 * matchQuestText(text,tasks,{ocrConfidence?,lineConfidences?:[{text,confidence}]}).
 * Returns {matches,candidates,lines,summary}. No cross-line name stitching.
 * A later data load can safely call this again with the same OCR text.
 */
export function matchQuestText(text, taskInput, {ocrConfidence, lineConfidences} = {}) {
  const input = typeof text === 'string' ? text : '';
  const rawLines = input.slice(0, MAX_TEXT_LENGTH).split(/\r\n?|\n|\f|\u2028|\u2029/);
  const lines = rawLines.slice(0, MAX_LINES).map((original, index) => ({
    original: original.slice(0, MAX_LINE_LENGTH).trim(), index,
    truncated: original.length > MAX_LINE_LENGTH,
    ...representation(original.slice(0, MAX_LINE_LENGTH)),
  })).filter(line => line.compact);
  const catalog = buildTasks(taskInput);
  const resolveConfidence = lineConfidenceResolver(ocrConfidence, lineConfidences);
  const found = [];
  let limited = false;

  for (const line of lines) {
    const certainty = resolveConfidence(line), exact = [];
    for (const task of catalog.tasks) {
      let best = null;
      for (const alias of task.aliases) {
        const occurrence = exactOccurrence(line, alias, task.tokens);
        if (!occurrence) continue;
        const row = {task, alias, ...occurrence};
        if (!best || Number(row.titleContext) > Number(best.titleContext)
          || (row.titleContext === best.titleContext && row.score > best.score)) best = row;
      }
      if (best) exact.push(best);
    }
    // Prefer a complete longer title over another task's name occurring inside it.
    const specific = exact.filter(row => !exact.some(other => other !== row && other.titleContext
      && other.start <= row.start && other.end >= row.end
      && (other.start < row.start || other.end > row.end)));
    const distinctTitles = specific.length > 1;
    const usableExact = specific.filter(row => row.titleContext || !shortAlias(row.alias) || distinctTitles);
    for (const row of usableExact) {
      const collision = catalog.aliases.get(row.alias.compact).size > 1;
      const requiredConfidence = shortAlias(row.alias) ? SHORT_AUTO_CONFIDENCE : AUTO_CONFIDENCE;
      let reason = null;
      if (collision) reason = 'ambiguous-name';
      else if (distinctTitles) reason = 'multiple-titles';
      else if (row.numericAmbiguity) reason = 'part-ambiguous';
      else if (!row.titleContext) reason = 'unrecognized-context';
      else if (line.truncated) reason = 'truncated-line';
      else if (row.alias.length < 2) reason = 'name-too-short';
      else if (certainty.value === null) reason = 'confidence-missing';
      else if (certainty.value < requiredConfidence) reason = 'low-confidence';
      found.push(resultRow(row.task, row.alias, line, certainty, {
        kind: row.kind, score: row.score, automatic: reason === null, reason,
      }));
    }
    if (usableExact.length) continue;

    const fuzzy = [];
    for (const task of catalog.tasks) {
      const candidate = fuzzyLine(line.original, task.tokens);
      const candidateLength = Array.from(candidate).length;
      if (candidateLength < 4 || candidateLength > 120) continue;
      let best = null;
      for (const alias of task.aliases) {
        if (alias.length < 5 || alias.length > 120) continue;
        const observedDigits = digitSignature(candidate);
        // Never suggest Part 1 for an explicit Part 2. Missing or I/l-like part
        // digits can yield several confirmation-only suggestions.
        if (observedDigits && observedDigits !== alias.digits) continue;
        const maxLength = Math.max(alias.length, candidateLength);
        const budget = Math.min(4, Math.max(1, Math.floor(maxLength * 0.18)));
        if (Math.abs(alias.length - candidateLength) > budget) continue;
        const distance = editDistance(alias.compact, candidate);
        const score = 1 - distance / maxLength;
        if (distance > budget || score < 0.78 || distance === 0) continue;
        if (!best || score > best.score) best = {alias, score,
          reason: alias.digits && !observedDigits ? 'part-ambiguous' : 'fuzzy'};
      }
      if (best) fuzzy.push(resultRow(task, best.alias, line, certainty, {
        kind: 'fuzzy', score: Number(best.score.toFixed(4)), automatic: false, reason: best.reason,
      }));
    }
    fuzzy.sort(compareRows);
    if (fuzzy.length > 5) limited = true;
    const selected = fuzzy.slice(0, 5);
    if (selected.length > 1 && selected[0].score - selected[1].score <= 0.04) {
      for (const row of selected) if (row.reason === 'fuzzy') row.reason = 'ambiguous-fuzzy';
    }
    found.push(...selected);
  }

  const byTask = new Map();
  for (const row of found.sort(compareRows)) {
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, {...row, evidenceLines: [row.evidence]});
    else {
      const existing = byTask.get(row.taskId);
      if (!existing.evidenceLines.includes(row.evidence)) existing.evidenceLines.push(row.evidence);
    }
  }
  const deduplicated = [...byTask.values()].sort(compareRows);
  const matches = deduplicated.filter(row => row.automatic);
  const allCandidates = deduplicated.filter(row => !row.automatic);
  const candidates = allCandidates.slice(0, MAX_CANDIDATES);
  return {
    matches, candidates,
    lines: lines.map(line => ({text: line.original, index: line.index,
      confidence: resolveConfidence(line).value})),
    summary: {
      tasksEmpty: catalog.tasks.length === 0, taskCount: catalog.tasks.length,
      lineCount: lines.length, automaticCount: matches.length, candidateCount: candidates.length,
      candidatesLimited: limited || allCandidates.length > MAX_CANDIDATES,
      truncatedInput: input.length > MAX_TEXT_LENGTH || rawLines.length > MAX_LINES
        || rawLines.some(line => line.length > MAX_LINE_LENGTH),
      confidenceScale: '0-100', automaticConfidenceThreshold: AUTO_CONFIDENCE,
      shortNameConfidenceThreshold: SHORT_AUTO_CONFIDENCE,
    },
  };
}