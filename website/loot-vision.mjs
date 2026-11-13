// The atlas stores sampled inventory artwork. Its text and stack-counter bands are
// masked on both the reference and the photograph, including after rotation.
export const ICON_SIDE = 16;
const channels = 3;
const sampleBytes = ICON_SIDE * ICON_SIDE * channels;
const rotations = [0, 1, 3];

export function sampleIcon(image, box) {
  const {data, width, height} = image;
  const output = new Uint8Array(sampleBytes);
  // Average the inner pixels of each bin to tolerate UI scaling and JPEG noise.
  const density = 4;
  for (let y = 0; y < ICON_SIDE; y++) {
    for (let x = 0; x < ICON_SIDE; x++) {
      const sums = [0, 0, 0];
      for (let j = 0; j < density; j++) {
        const sy = Math.max(0, Math.min(height - 1, Math.floor(box.y + (y + (j + .5) / density) * box.h / ICON_SIDE)));
        for (let i = 0; i < density; i++) {
          const sx = Math.max(0, Math.min(width - 1, Math.floor(box.x + (x + (i + .5) / density) * box.w / ICON_SIDE)));
          const offset = (sy * width + sx) * 4;
          for (let c = 0; c < channels; c++) sums[c] += data[offset + c];
        }
      }
      const offset = (y * ICON_SIDE + x) * channels;
      for (let c = 0; c < channels; c++) output[offset + c] = Math.round(sums[c] / (density * density));
    }
  }
  return output;
}

function isArtwork(x, y, w, h) {
  const u = (x + .5) / ICON_SIDE, v = (y + .5) / ICON_SIDE;
  if (v < .22 / h && u > 1 - 2.6 / w) return false;
  if (v > 1 - .22 / h && (u > 1 - 1.3 / w || u < .28 / w)) return false;
  return true;
}

const groupKey = (w, h) => w + 'x' + h;
function makeProfile(w, h, rotation) {
  const reference = [], photo = [], coarse = [];
  for (let y = 0; y < ICON_SIDE; y++) {
    for (let x = 0; x < ICON_SIDE; x++) {
      const px = rotation === 1 ? ICON_SIDE - 1 - y : rotation === 3 ? y : x;
      const py = rotation === 1 ? x : rotation === 3 ? ICON_SIDE - 1 - x : y;
      if (!isArtwork(x, y, w, h) || !isArtwork(px, py, rotation ? h : w, rotation ? w : h)) continue;
      if ((x % 2 === 1) && (y % 2 === 1)) coarse.push(reference.length * channels);
      reference.push((y * ICON_SIDE + x) * channels);
      photo.push((py * ICON_SIDE + px) * channels);
    }
  }
  return {reference, photo, coarse, templates: []};
}

function appearance(rgb, positions) {
  const values = new Int16Array(positions.length * channels);
  let sum = 0, red = 0, blue = 0, squares = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], r = rgb[p], g = rgb[p + 1], b = rgb[p + 2];
    const luma = (r + g * 2 + b) / 4;
    values[i*3] = luma;
    values[i*3 + 1] = r - g;
    values[i*3 + 2] = b - g;
    sum += luma; squares += luma * luma; red += r - g; blue += b - g;
  }
  const n = positions.length, mean = sum / n, contrast = Math.sqrt(Math.max(0, squares / n - mean * mean));
  const scale = 40 / Math.max(10, contrast);
  for (let i = 0; i < values.length; i += 3) {
    values[i] = Math.round((values[i] - mean) * scale);
    values[i+1] = Math.round(values[i+1] * scale * .65);
    values[i+2] = Math.round(values[i+2] * scale * .65);
  }
  const blurred = new Int16Array(values.length);
  const indices = new Map(positions.map((p,i)=>[p,i*3]));
  for (let i=0; i<positions.length; i++) {
    const at = positions[i]/3, x = at % ICON_SIDE, y = Math.floor(at/ICON_SIDE);
    let weight = 0;
    const sum = [0,0,0];
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      if (x+dx<0 || x+dx>=ICON_SIDE || y+dy<0 || y+dy>=ICON_SIDE) continue;
      const neighbor = indices.get(((y+dy)*ICON_SIDE+x+dx)*3);
      if (neighbor===undefined) continue;
      const w = (dx===0?2:1)*(dy===0?2:1);
      weight+=w;
      for (let c=0;c<3;c++) sum[c]+=values[neighbor+c]*w;
    }
    for (let c=0;c<3;c++) blurred[i*3+c]=Math.round(sum[c]/weight);
  }
  return {values, blurred, mean, contrast, red: red/n, blue: blue/n};
}

export function readIconAtlas(bytes) {
  const data = new Uint8Array(bytes);
  const reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  if (decoder.decode(data.subarray(0, 4)) !== 'TFI1') throw Error('아이콘 도감 버전을 확인해 주세요.');
  const count = reader.getUint32(4, true), groups = new Map(), names = new Map(), pictures = new Map(), footprints = new Map();
  let p = 8;
  for (let i = 0; i < count; i++) {
    const idLength = data[p++];
    const id = decoder.decode(data.subarray(p, p + idLength));
    p += idLength;
    const w = data[p++], h = data[p++], length = data[p++];
    const name = decoder.decode(data.subarray(p, p + length));
    p += length;
    if (!w || !h || p + sampleBytes > data.length) throw Error('아이콘 도감 파일이 손상되었습니다.');
    const rgb = data.subarray(p, p + sampleBytes);
    p += sampleBytes;
    names.set(id, name);
    footprints.set(id,w*h);
    pictures.set(id,rgb);
    for (const rotation of rotations) {
      const key = groupKey(rotation ? h : w, rotation ? w : h);
      if (!groups.has(key)) groups.set(key, {w: rotation ? h : w, h: rotation ? w : h, profiles: new Map()});
      const profiles = groups.get(key).profiles;
      if (!profiles.has(rotation)) profiles.set(rotation, makeProfile(w, h, rotation));
      const profile = profiles.get(rotation);
      profile.templates.push({id, ...appearance(rgb, profile.reference)});
    }
  }
  if (p !== data.length || !names.size) throw Error('아이콘 도감을 읽을 수 없습니다.');
  return {groups, names, pictures, footprints};
}

function pixelError(a, b, p) {
  const light = a[p] - b[p], red = a[p+1] - b[p+1], blue = a[p+2] - b[p+2];
  return light * light + red * red + blue * blue;
}

function distances(profile, rgb, best) {
  const query = appearance(rgb, profile.photo);
  if (query.contrast < 6) return;
  const a = query.blurred, shortlist = [];
  let worst = Infinity;
  for (const item of profile.templates) {
    const color = .07 * Math.abs(query.mean - item.mean) + .12 * (Math.abs(query.red - item.red) + Math.abs(query.blue - item.blue));
    const contrast = Math.abs(Math.log((query.contrast + 8) / (item.contrast + 8))) * 4;
    let coarse = 0;
    for (const p of profile.coarse) coarse += pixelError(a, item.blurred, p);
    const rank = Math.sqrt(coarse / profile.coarse.length) + color + contrast;
    if (rank >= worst) continue;
    shortlist.push({item, rank, penalty: color + contrast});
    shortlist.sort((left, right) => left.rank - right.rank);
    if (shortlist.length >= 9) {shortlist.length = 9; worst = shortlist[8].rank;}
  }
  for (const entry of shortlist) {
    const b = entry.item.blurred;
    let sum = 0;
    for (let p = 0; p < a.length; p += 3) sum += .82*pixelError(a, b, p) + .18*pixelError(query.values, entry.item.values, p);
    const score = Math.sqrt(sum / profile.photo.length) + entry.penalty;
    if (score < (best.get(entry.item.id) ?? Infinity)) best.set(entry.item.id, score);
  }
}

function compareIcon(rgb, groups) {
  const best = new Map();
  for (const group of groups) for (const profile of group.profiles.values()) distances(profile, rgb, best);
  return [...best].map(([id, score]) => ({id, score})).sort((a, b) => a.score - b.score).slice(0, 6);
}

function classify(image, box, groups, atlas, single) {
  const ranked = compareIcon(sampleIcon(image, box), groups);
  if (!ranked.length) return null;
  const score = ranked[0].score, second = ranked[1]?.score ?? Infinity;
  if (score > (single ? 39 : 30)) return null;
  const small = atlas.footprints.get(ranked[0].id) === 1;
  const confirmed = score <= (small ? 18 : 23) && second - score > Math.max(3.5, score * (small ? .55 : .30));
  return {box, score, confirmed, candidates: ranked.filter((r,i) => !i || r.score <= Math.max(score + 6, score * 1.52)).map(r => ({...r, name: atlas.names.get(r.id), picture: confirmed ? undefined : atlas.pictures.get(r.id)}))};
}

// Tarkov draws a thin light outline around occupied item rectangles. Look for
// long, nearly uniform ridges, allowing antialiasing, exposure shifts and JPEG.
function findLines(image, horizontal) {
  const {data, width, height} = image;
  const length = horizontal ? width : height, depth = horizontal ? height : width;
  const along = horizontal ? 4 : width*4, across = horizontal ? width*4 : 4;
  const rows = [];
  for (let y = 0; y < depth; y++) {
    const segments = [];
    let start = -1, last = -1;
    for (let x = 0; x < length + 3; x++) {
      let hit = false;
      if (x >= 2 && x < length - 2) {
        const p = y*across + x*along, g = data[p+1];
        if (g >= 33 && g <= 190 && Math.abs(g - data[p]) < 30 && Math.abs(g - data[p+2]) < 26) {
          const before = y > 1 ? data[p-2*across+1] : 0, after = y < depth-2 ? data[p+2*across+1] : 0;
          hit = g - Math.min(before, after) >= 9 && g - Math.max(before, after) >= -10 &&
                Math.abs(g - data[p-2*along+1]) <= 8 && Math.abs(g - data[p+2*along+1]) <= 8;
        }
      }
      if (hit) {
        if (start < 0) start = x;
        last = x;
      } else if (start >= 0 && x-last > 2) {
        if (last-start >= 16) segments.push([start-2, last+2]);
        start = -1;
      }
    }
    if (segments.length) rows.push({at:y, segments, strength:segments.reduce((n,s)=>n+s[1]-s[0],0)});
  }
  // Take the strongest center of each thick edge. Keep coordinates from other panels.
  const lines = [];
  for (const row of rows) {
    const prev = lines[lines.length - 1];
    if (!prev || row.at - prev.at > 2) {lines.push(row);continue;}
    const joined = [];
    for (const s of [...prev.segments,...row.segments].sort((a,b)=>a[0]-b[0])) {
      const last = joined[joined.length-1];
      if (last && s[0]<=last[1]+3) last[1]=Math.max(last[1],s[1]);
      else joined.push([...s]);
    }
    if (row.strength>prev.strength) prev.at=row.at;
    prev.strength=Math.max(prev.strength,row.strength);
    prev.segments=joined;
  }
  return lines;
}

function covers(line, from, to) {
  if (!line) return false;
  let covered = 0;
  for (const [a,b] of line.segments) {
    if (b < from) continue;
    if (a > to) break;
    covered += Math.max(0, Math.min(b,to) - Math.max(a,from));
  }
  return covered >= (to-from)*.78;
}

function pitches(xLines, yLines) {
  const counts = new Map(), vote = (n,weight) => {if(n>=23 && n<=180) counts.set(n,(counts.get(n)||0)+weight);};
  for (const lines of [xLines, yLines]) {
    for (let i = 0; i < lines.length; i++) {
      for (let j = i+1; j < lines.length && lines[j].at-lines[i].at <= 180; j++) {
        // Parallel edges count when they belong to the same part of the image.
        const shared = lines[i].segments.some(([a,b]) => lines[j].segments.some(([c,d])=>Math.min(b,d)-Math.max(a,c)>17));
        if (shared) vote(lines[j].at-lines[i].at, 2);
      }
      for (const [a,b] of lines[i].segments) vote(b-a, 1);
    }
  }
  const ranked = [...counts].map(([n,hits])=>[n,hits + .7*((counts.get(n-1)||0)+(counts.get(n+1)||0))]).sort((a,b)=>b[1]-a[1]);
  const selected = [];
  for (const [n] of ranked) {
    if (selected.every(value=>Math.abs(value-n)>3)) selected.push(n);
    if (selected.length === 5) break;
  }
  return selected;
}

function nearest(lines, position, tolerance, from, to) {
  let low = 0, high = lines.length;
  while (low < high) {
    const mid = (low+high) >>> 1;
    if (lines[mid].at < position) low = mid+1; else high = mid;
  }
  let line = null;
  function consider(candidate) {
    if ((!line || Math.abs(position-candidate.at)<Math.abs(position-line.at)) && covers(candidate,from,to)) line=candidate;
  }
  for(let j=low-1;j>=0 && position-lines[j].at<=tolerance;j--) consider(lines[j]);
  for(let j=low;j<lines.length && lines[j].at-position<=tolerance;j++) consider(lines[j]);
  return line;
}

function gridBoxes(image, atlas) {
  const xLines = findLines(image,false), yLines = findLines(image,true);
  const boxes = new Map(), sizes = [...atlas.groups.values()];
  for (const pitch of pitches(xLines,yLines)) {
    const inset = Math.min(6, Math.ceil(pitch*.08));
    for (const left of xLines) for (const top of yLines) {
      const x = left.at, y = top.at;
      if (!covers(top,x+inset,x+pitch-inset) || !covers(left,y+inset,y+pitch-inset)) continue;
      for (const group of sizes) {
        const right = nearest(xLines,x+pitch*group.w,2+group.w*.65,y+inset,y+pitch*group.h-inset);
        const bottom = nearest(yLines,y+pitch*group.h,2+group.h*.65,x+inset,x+pitch*group.w-inset);
        if (!right || !bottom) continue;
        const endX = right.at, endY = bottom.at;
        if (!covers(top,x+inset,endX-inset) || !covers(bottom,x+inset,endX-inset) ||
            !covers(left,y+inset,endY-inset) || !covers(right,y+inset,endY-inset)) continue;
        let divided = false;
        for (let n=1; n<group.w && !divided; n++) divided=!!nearest(xLines,x+(endX-x)*n/group.w,2,y+inset,endY-inset);
        for (let n=1; n<group.h && !divided; n++) divided=!!nearest(yLines,y+(endY-y)*n/group.h,2,x+inset,endX-inset);
        if (divided) continue;
        const key = [x,y,endX,endY].join(',');
        if (!boxes.has(key)) boxes.set(key,{box:{x,y,w:endX-x+1,h:endY-y+1}, groups:new Set()});
        boxes.get(key).groups.add(group);
      }
    }
  }
  return [...boxes.values()];
}

function hasPicture(image, box) {
  // Empty slots can contain bright grid lines. The interior must have real
  // texture after excluding the border, in-slot label and counter.
  const {data,width} = image;
  const pixels=[];
  for(let j=0;j<19;j++) for(let i=0;i<19;i++) {
    const x=Math.floor(box.x+box.w*(.08+.84*(i+.5)/19));
    const y=Math.floor(box.y+box.h*(.23+.52*(j+.5)/19));
    const p=(y*width+x)*4;
    pixels.push((data[p]+2*data[p+1]+data[p+2])/4);
  }
  pixels.sort((a,b)=>a-b);
  return pixels[Math.floor(pixels.length*.98)]-pixels[Math.floor(pixels.length*.12)]>14;
}

function overlap(a,b) {
  const w = Math.max(0, Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
  const h = Math.max(0, Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return w*h/Math.min(a.w*a.h,b.w*b.h);
}

export function recognizeInventory(image, atlas, {single = false} = {}) {
  const full = {x:0,y:0,w:image.width,h:image.height};
  const boxes = single ? [] : gridBoxes(image,atlas);
  const found = [];
  for (const entry of boxes) {
    if (!hasPicture(image,entry.box)) continue;
    const match = classify(image,entry.box,entry.groups,atlas,false);
    if (match) found.push(match);
  }
  if (single || !found.length) {
    const ratio = image.width/image.height;
    const groups = [...atlas.groups.values()].filter(g=>Math.abs(Math.log(ratio*g.h/g.w)) < .14);
    const match = classify(image,full,groups,atlas,single);
    if (match) found.push(match);
  }
  const accepted = [];
  for (const hit of found.sort((a,b)=>a.score-b.score)) {
    if (accepted.every(existing=>overlap(existing.box,hit.box)<.35)) accepted.push(hit);
  }
  return accepted.sort((a,b)=>a.box.y-b.box.y || a.box.x-b.box.x);
}
