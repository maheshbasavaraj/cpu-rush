const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedOrder, lockdownSim, generateLockdownPuzzle } = require('./server');

test('FCFS selects ready processes by arrival time and waits for future arrivals', () => {
  assert.deepEqual(expectedOrder([{ id: 'P1', arrival: 0, burst: 2 }, { id: 'P2', arrival: 4, burst: 1 }, { id: 'P3', arrival: 1, burst: 5 }]).map(p => p.id), ['P1', 'P3', 'P2']);
});

test('Lockdown mutex: owner-only release and no recursive lock', () => {
  const puzzle = { kind: 'mutex', units: 1, threads: ['T1', 'T2'],
    script: [{ t: 'T1', op: 'enter' }, { t: 'T1', op: 'enter' }, { t: 'T2', op: 'leave' }, { t: 'T2', op: 'enter' }, { t: 'T1', op: 'leave' }] };
  const { steps } = lockdownSim('mutex', puzzle);
  assert.deepEqual(steps.map(s => s.answerKey), ['acquire', 'reject', 'reject', 'block', 'release']);
});

test('Lockdown counting semaphore: N permits, extra waiter blocks, release wakes it', () => {
  const puzzle = { kind: 'counting', units: 2, threads: ['T1', 'T2', 'T3', 'T4'],
    script: [{ t: 'T1', op: 'enter' }, { t: 'T2', op: 'enter' }, { t: 'T3', op: 'enter' }, { t: 'T1', op: 'leave' }, { t: 'T4', op: 'enter' }] };
  const { steps } = lockdownSim('counting', puzzle);
  assert.deepEqual(steps.map(s => s.answerKey), ['acquire', 'acquire', 'block', 'release', 'block']);
  assert.deepEqual(steps[3].view.holders.map(h => h.t), ['T1', 'T2'], 'two permits, so T3 must wait');
  assert.deepEqual(steps[4].view.holders.map(h => h.t), ['T2', 'T3'], 'release hands the permit straight to the queued waiter');
  assert.deepEqual(steps[4].view.queue, [], 'queue drains after the handoff');
});

test('Lockdown generator always produces a gradable script with a real spread of calls', () => {
  for (const kind of ['mutex', 'binary', 'counting']) {
    for (let i = 0; i < 25; i++) {
      const puzzle = generateLockdownPuzzle(kind);
      const { steps } = lockdownSim(puzzle.kind, puzzle);
      assert.ok(steps.length >= 4, `${kind}: expected steps`);
      for (const st of steps) {
        assert.ok(st.options.some(o => o.key === st.answerKey), `${kind}: answerKey must be selectable`);
      }
      const kinds = new Set(steps.map(s => s.answerKey));
      assert.ok(kinds.size >= 2, `${kind}: puzzle should not be a single call repeated`);
    }
  }
});
