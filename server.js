const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { bankersRequest, demandPagingSim, fileAllocSim } = require('./public/algos.js');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dbFile = path.join(__dirname, 'scores.json');
const sessions = new Map();
const scores = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : [];

function workload(algorithm = 'fcfs', count = 6) {
  const processes = Array.from({ length: count }, (_, i) => ({
    id: `P${i + 1}`,
    arrival: i === 0 ? 0 : Math.floor(Math.random() * 8),
    burst: 2 + Math.floor(Math.random() * 7),
    priority: 1 + Math.floor(Math.random() * 5)
  })).sort((a, b) => a.arrival - b.arrival || a.id.localeCompare(b.id))
   // display order shuffled — player must find the right one, not read it top-down
   .sort(() => Math.random() - 0.5);
  
  // Ensure varied workloads for different algorithms
  if (algorithm === 'sjf') {
    // For SJF, make sure there are clear short/long jobs
    processes.forEach((p, i) => {
      if (i % 3 === 0) p.burst = 1 + Math.floor(Math.random() * 3); // Short jobs
      else if (i % 3 === 1) p.burst = 8 + Math.floor(Math.random() * 5); // Long jobs
    });
  }
  return processes;
}

function expectedOrderFCFS(processes) {
  const remaining = [...processes]; const order = []; let now = 0;
  while (remaining.length) {
    const ready = remaining.filter(p => p.arrival <= now);
    if (!ready.length) { now = Math.min(...remaining.map(p => p.arrival)); continue; }
    const next = ready.sort((a, b) => a.arrival - b.arrival || a.id.localeCompare(b.id))[0];
    order.push({ id: next.id, burst: next.burst, arrival: next.arrival }); now += next.burst; remaining.splice(remaining.indexOf(next), 1);
  }
  return order;
}

function expectedOrderSJF(processes) {
  const remaining = [...processes]; const order = []; let now = 0;
  while (remaining.length) {
    const ready = remaining.filter(p => p.arrival <= now);
    if (!ready.length) { now = Math.min(...remaining.map(p => p.arrival)); continue; }
    // SJF: shortest burst time first
    const next = ready.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.id.localeCompare(b.id))[0];
    order.push({ id: next.id, burst: next.burst, arrival: next.arrival }); now += next.burst; remaining.splice(remaining.indexOf(next), 1);
  }
  return order;
}

function expectedOrderRR(processes, quantum = 3) {
  const remaining = processes.map(p => ({ ...p, remaining: p.burst }));
  const order = []; let now = 0;
  const queue = [];
  const queued = new Set();
  const completed = new Set();
  
  while (completed.size < processes.length) {
    // Add newly arrived processes to queue
    remaining.forEach(p => {
      if (p.arrival <= now && !queued.has(p.id) && !completed.has(p.id)) {
        queue.push(p); queued.add(p.id);
      }
    });
    
    if (queue.length === 0) {
      // Advance time to next arrival
      const nextArrival = Math.min(...processes.filter(p => !completed.has(p.id)).map(p => p.arrival));
      now = nextArrival;
      continue;
    }
    
    const current = queue.shift();
    const execTime = Math.min(quantum, current.remaining);
    order.push({ id: current.id, burst: execTime, arrival: current.arrival, preempted: current.remaining > quantum });
    current.remaining -= execTime;
    now += execTime;
    
    // Add processes that arrived during execution
    remaining.forEach(p => {
      if (p.arrival <= now && !queued.has(p.id) && !completed.has(p.id) && p !== current) {
        queue.push(p); queued.add(p.id);
      }
    });
    
    if (current.remaining > 0) {
      queue.push(current);
    } else {
      completed.add(current.id);
    }
  }
  return order;
}

function expectedOrderPriority(processes) {
  const remaining = [...processes]; const order = []; let now = 0;
  while (remaining.length) {
    const ready = remaining.filter(p => p.arrival <= now);
    if (!ready.length) { now = Math.min(...remaining.map(p => p.arrival)); continue; }
    // Priority: lower number = higher priority
    const next = ready.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.id.localeCompare(b.id))[0];
    order.push({ id: next.id, burst: next.burst, arrival: next.arrival, priority: next.priority }); now += next.burst; remaining.splice(remaining.indexOf(next), 1);
  }
  return order;
}

function expectedOrder(processes, algorithm = 'fcfs') {
  switch (algorithm) {
    case 'sjf': return expectedOrderSJF(processes);
    case 'rr': return expectedOrderRR(processes);
    case 'priority': return expectedOrderPriority(processes);
    default: return expectedOrderFCFS(processes);
  }
}

// ==================== MEMORY MANAGEMENT ====================

function generateReferenceString(length = 20, maxPage = 7) {
  // Generate a reference string with some locality
  const refs = [];
  let current = Math.floor(Math.random() * maxPage) + 1;
  for (let i = 0; i < length; i++) {
    refs.push(current);
    // 60% chance to stay near current, 40% random jump
    if (Math.random() < 0.6) {
      current = Math.max(1, Math.min(maxPage, current + Math.floor(Math.random() * 3) - 1));
    } else {
      current = Math.floor(Math.random() * maxPage) + 1;
    }
  }
  return refs;
}

function pageReplacementFIFO(refString, frames) {
  const memory = [];
  const order = []; // Track insertion order for FIFO
  const faults = [];
  const steps = [];
  
  refString.forEach((page, idx) => {
    const hit = memory.includes(page);
    let victim = null;
    
    if (!hit) {
      if (memory.length < frames) {
        memory.push(page);
        order.push(page);
      } else {
        victim = order.shift();
        const victimIdx = memory.indexOf(victim);
        memory[victimIdx] = page;
        order.push(page);
      }
      faults.push(idx);
    }
    
    steps.push({
      page,
      memory: [...memory],
      hit,
      victim,
      faultCount: faults.length
    });
  });
  
  return { steps, totalFaults: faults.length, algorithm: 'FIFO' };
}

function pageReplacementLRU(refString, frames) {
  const memory = [];
  const recentUse = {}; // Track last use index
  const faults = [];
  const steps = [];
  
  refString.forEach((page, idx) => {
    const hit = memory.includes(page);
    let victim = null;
    
    if (!hit) {
      if (memory.length < frames) {
        memory.push(page);
      } else {
        // Find least recently used
        victim = memory.reduce((lru, p) => 
          recentUse[p] < recentUse[lru] ? p : lru, memory[0]);
        const victimIdx = memory.indexOf(victim);
        memory[victimIdx] = page;
      }
      faults.push(idx);
    }
    
    recentUse[page] = idx;
    
    steps.push({
      page,
      memory: [...memory],
      hit,
      victim,
      faultCount: faults.length
    });
  });
  
  return { steps, totalFaults: faults.length, algorithm: 'LRU' };
}

function pageReplacementOptimal(refString, frames) {
  const memory = [];
  const faults = [];
  const steps = [];
  
  refString.forEach((page, idx) => {
    const hit = memory.includes(page);
    let victim = null;
    
    if (!hit) {
      if (memory.length < frames) {
        memory.push(page);
      } else {
        // Find page used farthest in future (or never)
        let farthest = -1;
        victim = memory[0];
        
        memory.forEach(p => {
          const nextUse = refString.slice(idx + 1).indexOf(p);
          if (nextUse === -1) {
            victim = p;
            farthest = Infinity;
          } else if (nextUse > farthest) {
            farthest = nextUse;
            victim = p;
          }
        });
        
        const victimIdx = memory.indexOf(victim);
        memory[victimIdx] = page;
      }
      faults.push(idx);
    }
    
    steps.push({
      page,
      memory: [...memory],
      hit,
      victim,
      faultCount: faults.length
    });
  });
  
  return { steps, totalFaults: faults.length, algorithm: 'OPTIMAL' };
}

function pageReplacementClock(refString, frames) {
  const memory = [];
  const refBits = [];
  let clockHand = 0;
  const faults = [];
  const steps = [];
  
  refString.forEach((page, idx) => {
    const hit = memory.includes(page);
    let victim = null;
    
    if (hit) {
      // Set reference bit
      const pageIdx = memory.indexOf(page);
      refBits[pageIdx] = 1;
    } else {
      if (memory.length < frames) {
        memory.push(page);
        refBits.push(1);
      } else {
        // Clock algorithm: sweep until find refBit = 0
        while (true) {
          if (refBits[clockHand] === 0) {
            victim = memory[clockHand];
            memory[clockHand] = page;
            refBits[clockHand] = 1;
            clockHand = (clockHand + 1) % frames;
            break;
          } else {
            refBits[clockHand] = 0;
            clockHand = (clockHand + 1) % frames;
          }
        }
      }
      faults.push(idx);
    }
    
    steps.push({
      page,
      memory: [...memory],
      refBits: [...refBits],
      clockHand,
      hit,
      victim,
      faultCount: faults.length
    });
  });
  
  return { steps, totalFaults: faults.length, algorithm: 'CLOCK' };
}

function pageReplacement(refString, frames, algorithm = 'fifo') {
  switch (algorithm) {
    case 'lru': return pageReplacementLRU(refString, frames);
    case 'optimal': return pageReplacementOptimal(refString, frames);
    case 'clock': return pageReplacementClock(refString, frames);
    default: return pageReplacementFIFO(refString, frames);
  }
}

// ==================== DISK SCHEDULING ====================
function generateDiskRequests(count = 8, max = 199) {
  const set = new Set();
  while (set.size < count) set.add(5 + Math.floor(Math.random() * (max - 10)));
  return [...set].sort(() => Math.random() - 0.5); // shuffled — sorted strip would leak FCFS answer
}
function diskFCFS(requests, head) { return { order: [...requests] }; }
function diskSSTF(requests, head) {
  const remaining = [...requests]; const order = []; let pos = head;
  while (remaining.length) {
    remaining.sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos) || a - b);
    const next = remaining.shift(); order.push(next); pos = next;
  }
  return { order };
}
function diskSCAN(requests, head, max = 199, direction = 'up') {
  const up = requests.filter(r => r >= head).sort((a, b) => a - b);
  const down = requests.filter(r => r < head).sort((a, b) => b - a);
  const order = direction === 'up'
    // Boundary travel is not a request and must not appear in the answer list.
    ? [...up, ...down]
    : [...down, ...up];
  return { order };
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
  for (const t of order) total += Math.abs(t - pos), pos = t;
  return total;
}

// ==================== MEMORY ALLOCATION ====================
function generateAllocPuzzle(holeCount = 5, reqCount = 5) {
  const holes = Array.from({ length: holeCount }, (_, i) => ({ id: i, size: 20 + Math.floor(Math.random() * 180) }))
    .sort(() => Math.random() - 0.5); // shuffled — hole size order shouldn't hint first-fit
  // requests guaranteed to mostly fit
  const reqSizes = Array.from({ length: reqCount }, () => 10 + Math.floor(Math.random() * 90));
  return { holes, reqSizes };
}
function allocateHoles(holesIn, reqSizes, strategy) {
  const holes = holesIn.map((h, i) => ({ ...h }));
  const steps = [];
  reqSizes.forEach(req => {
    let chosen = null;
    if (strategy === 'first') chosen = holes.find(h => h.size >= req) || null;
    else if (strategy === 'best') chosen = holes.filter(h => h.size >= req).sort((a, b) => a.size - b.size || a.id - b.id)[0] || null;
    else chosen = holes.filter(h => h.size >= req).sort((a, b) => b.size - a.size || a.id - b.id)[0] || null;
    let result = null;
    if (chosen) {
      chosen.size -= req;
      result = { holeId: chosen.id, leftover: chosen.size };
      if (chosen.size === 0) holes.splice(holes.indexOf(chosen), 1);
    }
    steps.push({ req, holeId: result ? result.holeId : null });
  });
  return { steps };
}

// ---------- Generators for new modes ----------
function generateDeadlockPuzzle() {
  const n = 4, m = 3;
  const max = Array.from({ length: n }, () => Array.from({ length: m }, () => 1 + Math.floor(Math.random() * 5)));
  const allocation = max.map(row => row.map(v => Math.floor(Math.random() * (v + 1))));
  const used = Array.from({ length: m }, (_, j) => allocation.reduce((acc, row) => acc + row[j], 0));
  const total = Array.from({ length: m }, (_, j) => Math.max(
    ...allocation.map(r => r[j])) + used[j] + Math.floor(Math.random() * 3));
  const available = total.map((t, j) => Math.max(0, t - used[j]));
  return { allocation, max, available };
}

function generateVmPuzzle(level) {
  const frames = 3 + Math.min(2, level - 1);
  const maxPage = 8;
  const refs = Array.from({ length: 16 }, () => Math.floor(Math.random() * maxPage));
  const access = refs.map(() => (Math.random() < 0.35 ? 'W' : 'R'));
  const shared = [refs[Math.floor(Math.random() * refs.length)]];
  return { frames, maxPage, refs, access, shared };
}

let strategyForPuzzle = 'indexed';

function generateFsPuzzle() {
  const diskSize = 24;
  const fileCount = 4;
  const files = Array.from({ length: fileCount }, (_, i) => ({
    id: i + 1, size: 2 + Math.floor(Math.random() * 4)
  }));
  // Indexed needs size+1 blocks per file; contiguous needs a run that long.
  // Cap total demand so every generated puzzle is actually solvable.
  const strategy = strategyForPuzzle || 'indexed';
  const overhead = strategy === 'indexed' ? fileCount : 0;
  const demand = files.reduce((n, f) => n + f.size, 0) + overhead;
  const maxUsed = Math.max(0, diskSize - demand - 2);
  const disk = Array(diskSize).fill(true);
  const usedCount = Math.min(4 + Math.floor(Math.random() * 3), maxUsed);
  for (let k = 0; k < usedCount; k++) {
    disk[Math.floor(Math.random() * diskSize)] = false;
  }
  return { diskSize, disk, files };
}

function send(res, status, body, type = 'application/json') { res.writeHead(status, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
function read(req) { return new Promise(resolve => { let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data ? JSON.parse(data) : {})); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/session') {
    const { player, algorithm = 'fcfs', level = 1, mode = 'scheduler' } = await read(req);
    const id = randomUUID();

    if (mode === 'memory') {
      const frames = 3 + level;
      const refString = generateReferenceString(20, 7);
      sessions.set(id, { player, refString, frames, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, refString, frames, algorithm, level, mode });
    }
    if (mode === 'disk') {
      const head = 20 + Math.floor(Math.random() * 100);
      const requests = generateDiskRequests(8);
      sessions.set(id, { player, requests, head, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, requests, head, algorithm, level, mode });
    }
    if (mode === 'deadlock') {
      const { allocation, max, available } = generateDeadlockPuzzle();
      sessions.set(id, { player, allocation, max, available, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, allocation, max, available, algorithm, level, mode });
    }
    if (mode === 'vm') {
      const { frames, maxPage, refs, access, shared } = generateVmPuzzle(level);
      sessions.set(id, { player, frames, maxPage, refs, access, shared, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, frames, maxPage, refs, access, shared, algorithm, level, mode });
    }
    if (mode === 'fs') {
      strategyForPuzzle = algorithm;
      const { diskSize, disk, files } = generateFsPuzzle();
      sessions.set(id, { player, diskSize, disk, files, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, diskSize, disk, files, algorithm, level, mode });
    }
    if (mode === 'alloc') {
      const { holes, reqSizes } = generateAllocPuzzle();
      sessions.set(id, { player, holes, reqSizes, algorithm, level, mode, createdAt: Date.now() });
      return send(res, 201, { id, holes, reqSizes, algorithm, level, mode });
    }
    // scheduler
    const processes = workload(algorithm);
    sessions.set(id, { player, processes, algorithm, level, mode, createdAt: Date.now() });
    return send(res, 201, { id, processes, algorithm, level, mode });
  }
  if (req.method === 'POST' && req.url === '/api/submit') {
    const { sessionId, actions, elapsed } = await read(req);
    const session = sessions.get(sessionId);
    if (!session || !Array.isArray(actions)) return send(res, 400, { error: 'Invalid game session.' });

    let correct = 0, total = 0, extra = {};
    let baseScore = 0;

    if (session.mode === 'memory') {
      const expected = pageReplacement(session.refString, session.frames, session.algorithm);
      total = expected.steps.length;
      actions.forEach((action, index) => {
        const step = expected.steps[index];
        if (!step) return;
        if (step.hit === action.hit && (step.hit || step.victim == null || step.victim === action.victim)) correct++;
      });
      const perfect = correct === total;
      baseScore = Math.max(0, correct * 50 + (perfect ? 300 : 0) + Math.max(0, 200 - Math.floor(elapsed / 2)) - (total - correct) * 30);
      extra = { totalFaults: expected.totalFaults, expected };
    } else if (session.mode === 'disk') {
      const { order: optimalOrder } = diskSchedule(session.requests, session.head, session.algorithm);
      total = optimalOrder.length;
      // actions = array of track numbers in chosen order
      actions.forEach((track, index) => {
        if (Number(track) === Number(optimalOrder[index])) correct++;
      });
      const perfect = correct === total;
      const seek = totalSeek(session.head, optimalOrder);
      baseScore = Math.max(0, correct * 60 + (perfect ? 350 : 0) + Math.max(0, 250 - Math.floor(elapsed / 2)));
      extra = { seekTotal: seek, expectedOrder: optimalOrder };
    } else if (session.mode === 'deadlock') {
      // actions: [{ pid, req:[a,b,c], grant:bool }]
      const { allocation, max, available } = session;
      const work = { allocation: allocation.map(r => [...r]), available: [...available] };
      total = actions.length;
      actions.forEach(act => {
        const chk = bankersRequest(work.allocation, max, work.available, act.pid, act.req);
        if (!!chk.grant === !!act.grant) correct++;
        if (chk.grant && act.grant) {
          for (let j = 0; j < work.available.length; j++) {
            work.allocation[act.pid][j] += act.req[j];
            work.available[j] -= act.req[j];
          }
        }
      });
      const perfect = correct === total;
      baseScore = Math.max(0, correct * 90 + (perfect ? 450 : 0) + Math.max(0, 220 - Math.floor(elapsed / 2)) - (total - correct) * 45);
      extra = { expected: actions.map(a => bankersRequest(work.allocation, max, work.available, a.pid, a.req).grant) };
    } else if (session.mode === 'vm') {
      const { steps } = demandPagingSim(16, session.frames, session.refs,
        { access: session.access, shared: session.shared, maxPage: session.maxPage });
      total = steps.length;
      actions.forEach((act, index) => {
        const st = steps[index];
        if (!st) return;
        if (act.hit === st.hit && (act.fault || null) === (st.fault || null)) correct++;
      });
      const perfect = correct === total;
      const faults = steps.filter(s => !s.hit).length;
      baseScore = Math.max(0, correct * 55 + (perfect ? 400 : 0) + Math.max(0, 200 - Math.floor(elapsed / 2)) - (total - correct) * 25);
      extra = { faults, expected: steps };
    } else if (session.mode === 'fs') {
      const { steps: expectedSteps } = fileAllocSim(session.disk, session.files, session.algorithm);
      // Only files that actually fit are gradeable. A file with no room on disk
      // (blocks === null) is unsolvable by design — counting it in `total`
      // would make a perfect score unreachable.
      const gradeable = expectedSteps.filter(s => s && s.blocks);
      total = gradeable.length || 1;
      actions.forEach((blocks, index) => {
        const st = expectedSteps[index];
        if (!st || !st.blocks) return;
        if (Array.isArray(blocks) && blocks.length === st.blocks.length &&
            blocks.every((b, k) => Number(b) === st.blocks[k])) correct++;
      });
      const perfect = correct === total;
      baseScore = Math.max(0, correct * 80 + (perfect ? 420 : 0) + Math.max(0, 220 - Math.floor(elapsed / 2)) - (total - correct) * 35);
      extra = { expectedBlocks: expectedSteps.map(s => s.blocks) };
    } else if (session.mode === 'alloc') {
      const { steps } = allocateHoles(session.holes, session.reqSizes, session.algorithm);
      total = steps.length;
      // actions = array of holeIds
      actions.forEach((holeId, index) => {
        const s = steps[index];
        if (s && Number(holeId) === s.holeId) correct++;
      });
      const perfect = correct === total;
      baseScore = Math.max(0, correct * 70 + (perfect ? 400 : 0) + Math.max(0, 200 - Math.floor(elapsed / 2)) - (total - correct) * 40);
      extra = { expectedHoles: steps.map(s=>s.holeId) };
    } else {
      const expected = expectedOrder(session.processes, session.algorithm);
      total = expected.length;
      let streak = 0, bestStreak = 0;
      actions.forEach((id, index) => { if (id === expected[index]?.id) { correct++; streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0; });
      const perfect = correct === expected.length;
      baseScore = Math.max(0, correct * 100 + (perfect ? 500 : 0) + (bestStreak >= 3 ? bestStreak * 25 : 0) + Math.max(0, 250 - Math.floor(elapsed / 2)) - (actions.length - correct) * 50);
      extra = { expected, bestStreak };
    }

    const score = baseScore;
    const result = { name: String(session.player.name || 'Anonymous').slice(0, 30), usn: String(session.player.usn || '').slice(0, 30), score, correct, total, elapsed: Number(elapsed) || 0, at: Date.now(), algorithm: session.algorithm, level: session.level, mode: session.mode, ...extra };
    scores.push(result); scores.sort((a, b) => b.score - a.score || a.elapsed - b.elapsed); scores.splice(20); fs.writeFileSync(dbFile, JSON.stringify(scores, null, 2)); sessions.delete(sessionId);
    return send(res, 200, result);
  }
  if (req.method === 'GET' && req.url === '/api/leaderboard') return send(res, 200, scores);
  const requested = req.url === '/' ? 'index.html' : req.url.replace(/^\//, ''); const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
});

if (require.main === module) server.listen(port, () => console.log(`CPU RUSH running on http://localhost:${port}`));
module.exports = { expectedOrder, pageReplacement, generateReferenceString, diskSchedule, totalSeek, allocateHoles };
