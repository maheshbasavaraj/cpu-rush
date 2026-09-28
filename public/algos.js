// ==================== DISK SCHEDULING ====================
// Head starts at `head`, moves through queue per algorithm. Return order of seeks.
function diskFCFS(requests, head) {
  return { order: [...requests], name: 'FCFS' };
}
function diskSSTF(requests, head) {
  const remaining = [...requests]; const order = []; let pos = head;
  while (remaining.length) {
    remaining.sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos) || a - b);
    const next = remaining.shift();
    order.push(next); pos = next;
  }
  return { order, name: 'SSTF' };
}
function diskSCAN(requests, head, max = 199, direction = 'up') {
  const up = requests.filter(r => r >= head).sort((a, b) => a - b);
  const down = requests.filter(r => r < head).sort((a, b) => b - a);
  let order;
  if (direction === 'up') {
    order = [...up, ...(down.length ? [max] : []), ...down];
  } else {
    order = [...down, ...(up.length ? [0] : []), ...up];
  }
  return { order, name: 'SCAN' };
}
function diskSchedule(requests, head, algorithm) {
  switch (algorithm) {
    case 'sstf': return diskSSTF(requests, head);
    case 'scan': return diskSCAN(requests, head);
    default: return diskFCFS(requests, head);
  }
}
function totalSeek(head, order) {
  let pos = head, total = 0;
  for (const t of order) { if (t === null) continue; total += Math.abs(t - pos); pos = t; }
  return total;
}

// ==================== MEMORY ALLOCATION ====================
// First Fit / Best Fit / Worst Fit. blocks = [{id,size}], holes=[{id,size}]
function allocateHoles(holesIn, reqSizes, strategy) {
  const holes = holesIn.map((h, i) => ({ ...h }));
  const steps = [];
  reqSizes.forEach((req, idx) => {
    // candidates sorted by hole id for deterministic scan
    let chosen = null;
    if (strategy === 'first') {
      chosen = holes.find(h => h.size >= req) || null;
    } else if (strategy === 'best') {
      const fits = holes.filter(h => h.size >= req).sort((a, b) => a.size - b.size || a.id - b.id);
      chosen = fits[0] || null;
    } else { // worst
      const fits = holes.filter(h => h.size >= req).sort((a, b) => b.size - a.size || a.id - b.id);
      chosen = fits[0] || null;
    }
    let result = null;
    if (chosen) {
      chosen.size -= req;
      result = { holeId: chosen.id, leftover: chosen.size };
      if (chosen.size === 0) holes.splice(holes.indexOf(chosen), 1);
    }
    steps.push({ req, holeId: result ? result.holeId : null });
  });
  return { steps, finalHoles: holes.map(h=>({...h})) };
}

// Export to window for non-module scripts
if (typeof window !== 'undefined') {
  window.DiskAlgos = { diskFCFS, diskSSTF, diskSCAN, diskSchedule, totalSeek };
  window.AllocAlgos = { allocateHoles };
  window.DeadlockAlgos = { bankersSafe, bankersRequest };
  window.VmAlgos = { demandPagingSim };
  window.FsAlgos = { fileAllocSim };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diskFCFS, diskSSTF, diskSCAN, diskSchedule, totalSeek, allocateHoles,
    bankersSafe, bankersRequest, demandPagingSim, fileAllocSim };
}

// ==================== DEADLOCK AVOIDANCE (BANKER'S) ====================
// allocation[i][j], max[i][j], available[j] -> is the state safe?
function bankersSafe(allocation, max, available) {
  const n = allocation.length, m = available.length;
  const need = allocation.map((row, i) => row.map((a, j) => max[i][j] - a));
  const work = [...available];
  const finish = new Array(n).fill(false);
  const seq = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < n; i++) {
      if (finish[i]) continue;
      if (need[i].every((v, j) => v <= work[j])) {
        for (let j = 0; j < m; j++) work[j] += allocation[i][j];
        finish[i] = true; seq.push(i); progress = true;
      }
    }
  }
  return { safe: finish.every(Boolean), seq };
}

// Should process `pid`'s request `req` be granted under Banker's algorithm?
function bankersRequest(allocation, max, available, pid, req) {
  const m = available.length;
  const need = allocation.map((row, i) => row.map((a, j) => max[i][j] - a));
  if (req.some((v, j) => v > need[pid][j])) return { grant: false, reason: 'exceeds-need', seq: [] };
  if (req.some((v, j) => v > available[j])) return { grant: false, reason: 'not-available', seq: [] };
  const alloc2 = allocation.map(r => [...r]);
  for (let j = 0; j < m; j++) alloc2[pid][j] += req[j];
  const avail2 = available.map((v, j) => v - req[j]);
  const chk = bankersSafe(alloc2, max, avail2);
  return { grant: chk.safe, reason: chk.safe ? 'safe' : 'unsafe', seq: chk.seq };
}

// ==================== DEMAND PAGING / VIRTUAL MEMORY ====================
// refs: page numbers. opts: { access:['R'|'W'], shared:[pages], maxPage }
// fault types: PURE (not loaded) | COW (write to shared page) | PROT (illegal page)
function demandPagingSim(pages, frames, refs, opts) {
  const valid = new Array(pages).fill(false);
  const resident = [];
  const fifo = [];
  const shared = [...(opts.shared || [])];
  const steps = [];
  refs.forEach((p, idx) => {
    const isWrite = opts.access[idx] === 'W';
    const legal = p >= 0 && p < opts.maxPage;
    let hit = null, fault = null;
    if (!legal) {
      hit = false; fault = 'PROT';
    } else if (valid[p]) {
      if (isWrite && shared.includes(p)) {
        hit = false; fault = 'COW';
        shared.splice(shared.indexOf(p), 1);
      } else {
        hit = true; fault = null;
      }
    } else {
      hit = false; fault = 'PURE';
      if (resident.length < frames) { resident.push(p); fifo.push(p); valid[p] = true; }
      else {
        const v = fifo.shift(); valid[v] = false;
        resident[resident.indexOf(v)] = p; fifo.push(p); valid[p] = true;
      }
    }
    steps.push({ page: p, access: opts.access[idx], hit, fault, frames: [...resident] });
  });
  return { steps };
}

// ==================== FILE SYSTEM ALLOCATION ====================
// disk: array of booleans (true = free). files: [{id,size}]
// strategy: contiguous | linked | indexed
function fileAllocSim(disk, files, strategy) {
  const free = disk.map((f, i) => ({ i, f })).filter(o => o.f).map(o => o.i);
  const freeSet = new Set(free);
  const steps = [];
  for (const file of files) {
    let chosen = null;
    if (strategy === 'contiguous') {
      let runStart = -1;
      for (let st = 0; st + file.size <= disk.length; st++) {
        let ok = true;
        for (let k = 0; k < file.size; k++) if (!freeSet.has(st + k)) { ok = false; break; }
        if (ok) { runStart = st; break; }
      }
      chosen = runStart >= 0 ? Array.from({ length: file.size }, (_, k) => runStart + k) : null;
    } else if (strategy === 'linked') {
      chosen = free.length >= file.size ? free.slice(0, file.size) : null;
    } else { // indexed: 1 index block + N data blocks
      chosen = free.length >= file.size + 1 ? free.slice(0, file.size + 1) : null;
    }
    if (chosen) chosen.forEach(b => { freeSet.delete(b); free.splice(free.indexOf(b), 1); });
    steps.push({ fileId: file.id, size: file.size, blocks: chosen });
  }
  return { steps };
}

