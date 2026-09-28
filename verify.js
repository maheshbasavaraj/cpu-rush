// Headless DOM-free verification: simulate exact form flow from index.html + app.js
// Can't run DOM in node; instead verify the wiring statically + API end-to-end.
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('public/index.html','utf8');
const app = fs.readFileSync('public/app.js','utf8');

// 1. Every mode dropdown has a unique name= (FormData collision fix)
const selects = [...html.matchAll(/<select\b[^>]*>/g)].map(m => m[0]);
const algoNames = selects.map(s => (s.match(/name="([^"]*)"/) || [])[1]).filter(Boolean);
assert.deepStrictEqual(algoNames,
  ['mode','algorithm','mem-algo','disk-algo','alloc-algo','deadlock-algo','vm-algo','fs-algo'],
  'select names');
console.log('PASS form select names unique:', JSON.stringify(algoNames));

// 2. Each start* reads its own dropdown, not player.algorithm
const ownSelects = {
  memory:  "#memory-algo-select",
  disk:    "#disk-algo-select",
  alloc:   "#alloc-algo-select",
  deadlock:"#deadlock-algo-select",
  vm:      "#vm-algo-select",
  fs:      "#fs-algo-select",
};
for (const [mode, sel] of Object.entries(ownSelects)) {
  assert(app.includes(`const algorithm=$('${sel}').value;`), `${mode} reads own select ${sel}`);
}
console.log('PASS all 6 non-scheduler start* fns read their own dropdown');

// 3. scheduler path still uses form algorithm (only remaining name="algorithm")
assert(/const \{ algorithm, mode='scheduler', \.\.\.playerInfo \} = player;/.test(app), 'scheduler uses form algorithm');
console.log('PASS scheduler uses form algorithm');

// 4. API end-to-end: every mode with its REAL dropdown default
(async()=>{
  const cases = {
    scheduler:{algo:'fcfs',       keys:['processes']},
    memory:   {algo:'fifo',       keys:['refString','frames']},
    disk:     {algo:'fcfs',       keys:['requests','head']},
    alloc:    {algo:'first',      keys:['holes','reqSizes']},
    deadlock: {algo:'avoidance',  keys:['allocation','max','available']},
    vm:       {algo:'fifo',       keys:['frames','maxPage','refs','access','shared']},
    fs:       {algo:'contiguous', keys:['diskSize','disk','files']},
  };
  for (const [mode, {algo, keys}] of Object.entries(cases)) {
    const r = await fetch('http://localhost:3000/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:{name:'T',usn:'U'},algorithm:algo,level:1,mode})});
    assert.strictEqual(r.status, 201, `${mode} status`);
    const g = await r.json();
    assert.strictEqual(g.algorithm, algo, `${mode} echo`);
    assert.strictEqual(g.mode, mode, `${mode} mode echo`);
    for (const k of keys) assert(g[k] != null, `${mode} payload has ${k}`);
    console.log(`PASS api ${mode}/${algo} → ${keys.join(', ')} ok`);
  }
  console.log('ALL CHECKS PASS');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
