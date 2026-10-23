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
  window.FsAlgos = { fileAllocSim, fsPlacementOk };
  window.SyncAlgos = { syncSim };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diskFCFS, diskSSTF, diskSCAN, diskSchedule, totalSeek, allocateHoles,
    bankersSafe, bankersRequest, demandPagingSim, fileAllocSim, fsPlacementOk, syncSim };
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

// Grading rule for file allocation. Any placement that obeys the strategy's
// stated rule counts as correct — not just the first-fit one the hint shows.
//   contiguous : exactly `size` blocks, all free, one unbroken run
//   linked     : exactly `size` free blocks, any order
//   indexed    : exactly `size` + 1 free blocks (1 index + `size` data)
function fsPlacementOk(disk, blocks, file, strategy) {
  if (!Array.isArray(blocks) || !file) return false;
  const need = strategy === 'indexed' ? file.size + 1 : file.size;
  if (blocks.length !== need) return false;
  const seen = new Set();
  for (const b of blocks) {
    const n = Number(b);
    if (!Number.isInteger(n) || n < 0 || n >= disk.length) return false;
    if (!disk[n]) return false;      // block is already in use
    if (seen.has(n)) return false;   // same block picked twice
    seen.add(n);
  }
  if (strategy === 'contiguous') {
    const s = [...seen].sort((a, b) => a - b);
    for (let k = 1; k < s.length; k++) if (s[k] !== s[k - 1] + 1) return false;
  }
  return true;
}

// ==================== SYNCHRONIZATION ====================
// Turns a generated synchronization puzzle into an ordered list of questions,
// each with exactly one correct answer. The browser loads this file as a plain
// script and the server require()s it, so a single implementation drives both
// the on-screen feedback and the server-side score.
//
// Sub-modes: critical | peterson | hardware | mutex | semaphore
function syncSim(algorithm, puzzle) {
  const steps = [];
  const trace = [];
  const push = (o) => { steps.push(Object.assign({ index: steps.length, trace: trace.slice() }, o)); };
  const pz = puzzle || {};

  // ---------- The Critical-Section Problem ----------
  if (algorithm === 'critical') {
    let who = [];
    (pz.events || []).forEach((ev) => {
      const before = [...who];
      let key, explain;
      if (ev.op === 'enter') {
        key = before.length === 0 ? 'ok' : 'violation';
        explain = before.length === 0
          ? 'The critical section was empty, so P' + ev.p + ' may enter. Mutual exclusion holds.'
          : 'P' + ev.p + ' enters while P' + before.join(' and P') + ' ' + (before.length === 1 ? 'is' : 'are') +
            ' still inside. Two processes share the critical section — mutual exclusion is violated.';
        who.push(ev.p);
      } else if (ev.op === 'exit') {
        const holds = before.indexOf(ev.p) >= 0;
        key = holds ? 'ok' : 'violation';
        explain = holds
          ? 'P' + ev.p + ' leaves the critical section, so it becomes free for the other process.'
          : 'P' + ev.p + ' exits without ever holding the lock — an illegal, unbalanced release.';
        if (holds) who = who.filter((x) => x !== ev.p);
      } else {
        key = 'ok';
        explain = 'P' + ev.p + ' is doing ordinary work outside the critical section. No shared data is touched, so this is always legal.';
      }
      push({
        event: ev.op, p: ev.p,
        prompt: 'P' + ev.p + ' executes ' + ev.op.toUpperCase() + '. Is this legal?',
        options: [
          { key: 'ok', label: 'LEGAL', desc: 'Mutual exclusion still holds' },
          { key: 'violation', label: 'VIOLATION', desc: 'Two inside at once, or an unbalanced exit' }
        ],
        answerKey: key, explain,
        state: [
          { k: 'Critical section', v: before.length ? 'P' + before.join(', P') + ' inside' : 'empty' },
          { k: 'Event', v: 'P' + ev.p + ' ' + ev.op.toUpperCase() }
        ]
      });
      trace.push('P' + ev.p + ' ' + ev.op.toUpperCase());
    });
  }

  // ---------- Peterson's Solution ----------
  if (algorithm === 'peterson') {
    const flag = [false, false];
    let turn = null, inside = [];
    (pz.schedule || []).forEach((ev) => {
      const p = ev.p, o = 1 - p;
      if (ev.ins === 'flagT') flag[p] = true;
      else if (ev.ins === 'turn') turn = o;                 // process i sets turn = j
      else if (ev.ins === 'cs') inside.push(p);
      else if (ev.ins === 'flagF') { flag[p] = false; inside = inside.filter((x) => x !== p); }
      if (ev.ins === 'check') {
        const blocked = flag[o] && turn === o;
        push({
          event: 'check', p,
          prompt: 'P' + p + ' reaches its while-loop: while (flag[' + o + '] && turn == ' + o + '). Does it get into the critical section?',
          options: [
            { key: 'enter', label: 'ENTERS', desc: 'The loop condition is false, so it proceeds' },
            { key: 'wait', label: 'SPINS', desc: 'The loop condition is true, so it keeps waiting' }
          ],
          answerKey: blocked ? 'wait' : 'enter',
          explain: blocked
            ? 'flag[' + o + '] is true AND turn is ' + o + ', so the condition holds and P' + p +
              ' spins. It cannot enter until P' + o + ' clears its flag or turn changes.'
            : 'Either flag[' + o + '] is false, or turn is ' + p + ' instead of ' + o +
              '. The condition is false, so P' + p + ' enters the critical section.',
          state: [
            { k: 'flag[0]', v: String(flag[0]) },
            { k: 'flag[1]', v: String(flag[1]) },
            { k: 'turn', v: turn === null ? '—' : String(turn) },
            { k: 'Critical section', v: inside.length ? 'P' + inside.join(', P') : 'empty' }
          ]
        });
      }
      trace.push('P' + p + ' ' + ev.ins);
    });
  }

  // ---------- Hardware support: test-and-set / swap ----------
  if (algorithm === 'hardware') {
    let lock = 0, holder = null;
    (pz.ops || []).forEach((op) => {
      const p = op.p;
      let key, explain, opts, event;
      if (op.kind === 'tsl') {
        const busy = lock === 1;
        key = busy ? 'busy' : 'acquired';
        event = 'tsl';
        opts = [
          { key: 'acquired', label: 'ACQUIRES', desc: 'TSL returned 0 — this process now holds the lock' },
          { key: 'busy', label: 'SPINS', desc: 'TSL returned 1 — the lock was already taken' }
        ];
        explain = busy
          ? 'The lock was already 1, so TSL returns 1 (and writes 1 again). P' + p + ' sees 1 and must keep spinning.'
          : 'The lock was 0, so TSL returns 0 and writes 1 in one indivisible step. P' + p + ' sees 0 and now owns the lock.';
        if (!busy) { lock = 1; holder = p; }
      } else {
        const mine = holder === p;
        key = mine ? 'freed' : 'error';
        event = 'release';
        opts = [
          { key: 'freed', label: 'FREED', desc: 'The lock becomes 0 again' },
          { key: 'error', label: 'ERROR', desc: 'Releasing a lock this process does not hold' }
        ];
        explain = mine
          ? 'P' + p + ' holds the lock, so storing 0 releases it. The next TSL will now return 0.'
          : 'P' + p + ' does not hold the lock, so this release is illegal — it would free a lock another process is using.';
        if (mine) { lock = 0; holder = null; }
      }
      push({
        event, p,
        prompt: 'P' + p + ' executes the atomic ' + (op.kind === 'tsl' ? 'TSL lock' : 'STORE lock, #0 (release)') + ' instruction. What happens?',
        options: opts, answerKey: key, explain,
        state: [
          { k: 'lock', v: String(lock) },
          { k: 'Held by', v: holder === null ? 'nobody' : 'P' + holder },
          { k: 'Operation', v: 'P' + p + ' ' + (op.kind === 'tsl' ? 'TSL lock' : 'release') }
        ]
      });
      trace.push('P' + p + ' ' + op.kind.toUpperCase());
    });
    push({
      event: 'concept', p: null,
      prompt: 'P0 and P1 execute TSL lock at exactly the same instant. Can both acquire the lock?',
      options: [
        { key: 'no', label: 'NO', desc: 'TSL is one indivisible instruction' },
        { key: 'yes', label: 'YES', desc: 'Both could read 0 before either writes 1' }
      ],
      answerKey: 'no',
      explain: 'TSL reads the old value and writes 1 in a single indivisible step, so only one process can ever observe 0. The other must see 1 and spin. That atomicity is exactly what hardware support buys you.',
      state: [
        { k: 'lock', v: String(lock) },
        { k: 'Held by', v: holder === null ? 'nobody' : 'P' + holder },
        { k: 'Operation', v: 'P0 and P1 TSL simultaneously' }
      ]
    });
  }

  // ---------- Mutex locks ----------
  if (algorithm === 'mutex') {
    let holder = null;
    (pz.ops || []).forEach((op) => {
      const p = op.p;
      let key, explain, opts;
      if (op.kind === 'acquire') {
        key = holder === null ? 'acquired' : (holder === p ? 'error' : 'block');
        opts = [
          { key: 'acquired', label: 'ACQUIRES', desc: 'The mutex was free' },
          { key: 'block', label: 'BLOCKS', desc: 'Someone else holds it, so this call waits' },
          { key: 'error', label: 'ERROR', desc: 'This process already holds the mutex' }
        ];
        explain = key === 'acquired'
          ? 'The mutex was free, so P' + p + ' acquires it. Any other acquire() now blocks.'
          : key === 'block'
            ? 'P' + holder + ' already holds the mutex, so P' + p + ' blocks until it is released.'
            : 'P' + p + ' already holds the mutex. A plain non-recursive mutex cannot be acquired twice — that is a programming error, not a wait.';
        if (key === 'acquired') holder = p;
      } else {
        key = holder === p ? 'freed' : 'error';
        opts = [
          { key: 'freed', label: 'FREES', desc: 'The holder releases the mutex' },
          { key: 'error', label: 'ERROR', desc: 'Release without holding it' }
        ];
        explain = key === 'freed'
          ? 'P' + p + ' holds the mutex, so release() frees it and a blocked process may now acquire it.'
          : 'P' + p + ' does not hold the mutex ' + (holder === null ? '(it is free)' : '(P' + holder + ' holds it)') + ', so this release is illegal.';
        if (key === 'freed') holder = null;
      }
      push({
        event: op.kind, p,
        prompt: 'P' + p + ' calls ' + op.kind + '() on the mutex. What happens?',
        options: opts, answerKey: key, explain,
        state: [
          { k: 'Mutex', v: holder === null ? 'free' : 'held by P' + holder },
          { k: 'Operation', v: 'P' + p + ' ' + op.kind + '()' }
        ]
      });
      trace.push('P' + p + ' ' + op.kind + '()');
    });
  }

  // ---------- Semaphores ----------
  if (algorithm === 'semaphore') {
    let s = Number(pz.initial) || 0, blocked = 0;
    (pz.ops || []).forEach((op) => {
      const p = op.p, before = s;
      let after, explain;
      if (op.kind === 'P') {
        if (before > 0) {
          after = before - 1;
          explain = 'S is ' + before + ' (greater than 0), so P' + p + ' decrements it to ' + after + ' and continues immediately.';
        } else {
          after = before; blocked++;
          explain = 'S is 0, so P' + p + ' cannot continue — it blocks and joins the queue. S stays 0.';
        }
      } else {
        if (blocked > 0) {
          blocked--; after = before;
          explain = 'S is ' + before + '. The signal wakes one blocked process, which immediately consumes that unit, so S stays ' + before + '.';
        } else {
          after = before + 1;
          explain = 'No process is waiting, so V increments S from ' + before + ' to ' + after + '.';
        }
      }
      s = after;
      const wrong = [...new Set([before, after - 1, after + 1])].filter((v) => v >= 0 && v !== after).slice(0, 2);
      push({
        event: op.kind, p,
        prompt: 'P' + p + ' calls ' + (op.kind === 'P' ? 'P(S)  (wait)' : 'V(S)  (signal)') + ' while S = ' + before + '. What is S afterwards?',
        options: [after, ...wrong].sort((a, b) => a - b).map((v) => ({ key: 's' + v, label: 'S = ' + v, desc: '' })),
        answerKey: 's' + after, explain,
        state: [
          { k: 'Semaphore S', v: String(before) },
          { k: 'Blocked', v: String(blocked) },
          { k: 'Operation', v: 'P' + p + ' ' + op.kind + '(S)' }
        ]
      });
      trace.push('P' + p + ' ' + op.kind + '(S)');
    });
  }

  return { steps };
}

