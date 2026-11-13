import {parseScreenshotFilename} from './geo-core.mjs';

const IMAGE_FILENAME = /\.(?:png|jpe?g|webp|bmp)$/i;
const CAPTURE_PARTS = ['year', 'month', 'day', 'hour', 'minute', 'second'];

function newerThan(candidate, current) {
  if (!current) return true;
  if (candidate.lastModified !== current.lastModified) {
    return candidate.lastModified > current.lastModified;
  }
  // Filename dates have no timezone. Compare their local fields, without
  // pretending they identify UTC instants, only when filesystem times tie.
  for (const key of CAPTURE_PARTS) {
    const left = candidate.parsed?.captureParts?.[key] ?? 0;
    const right = current.parsed?.captureParts?.[key] ?? 0;
    if (left !== right) return left > right;
  }
  const leftSequence = candidate.parsed?.sequence ?? -1;
  const rightSequence = current.parsed?.sequence ?? -1;
  if (leftSequence !== rightSequence) return leftSequence > rightSequence;
  // Directory enumeration order is unspecified. Keep equal-time results stable.
  return candidate.name > current.name;
}

/**
 * Read one level of a user-selected screenshot folder. Only names and File
 * metadata are inspected; image bytes are never opened, decoded, or uploaded.
 *
 * Pass an empty Set for the first scan to include existing screenshots. Later
 * scans inspect only unseen names. totalFiles/imageFiles count all direct files,
 * while newFiles counts previously unseen direct files, including read retries.
 * Non-image filenames are marked without opening them. Image filenames are
 * marked only after getFile succeeds, so a file still being written is retried.
 *
 * Per-file read failures are returned in readErrors and do not stop the scan.
 * Folder iteration/permission failures throw; the caller owns connection state.
 * The incoming Set is never mutated. observedAt is an ISO scan-completion time.
 */
export async function scanScreenshotDirectory(handle, seen = new Set()) {
  const nextSeen = new Set(seen);
  let latest = null;
  let latestImage = null;
  let rejectedCandidate = null;
  let totalFiles = 0;
  let imageFiles = 0;
  let newFiles = 0;
  const readErrors = [];

  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    totalFiles++;
    const isImage = IMAGE_FILENAME.test(entry.name);
    if (isImage) imageFiles++;
    if (nextSeen.has(entry.name)) continue;
    newFiles++;
    if (!isImage) {
      nextSeen.add(entry.name);
      continue;
    }

    let file;
    try {
      file = await entry.getFile();
    } catch (error) {
      readErrors.push({name: entry.name, errorName: error?.name || 'Error'});
      continue;
    }
    nextSeen.add(entry.name);
    const lastModified = Number.isFinite(file.lastModified) ? file.lastModified : 0;
    const parsed = parseScreenshotFilename(entry.name);
    const candidate = {name: entry.name, lastModified, parsed};
    if(newerThan(candidate,latestImage))latestImage={...candidate,size:file.size,file,handle:entry};
    if (parsed) {
      if (newerThan(candidate, latest)) latest = candidate;
    } else if (newerThan(candidate, rejectedCandidate)) {
      rejectedCandidate = candidate;
    }
  }

  return {
    seen: nextSeen,
    latest,
    latestImage,
    latestRejected: rejectedCandidate ? {
      name: rejectedCandidate.name,
      reason: '파일명에서 타르코프 원본 좌표를 읽지 못했어요.',
    } : null,
    totalFiles,
    imageFiles,
    newFiles,
    readErrors,
    observedAt: new Date().toISOString(),
  };
}