const test = require('node:test'); const assert = require('node:assert/strict'); const { expectedOrder } = require('./server');
test('FCFS selects ready processes by arrival time and waits for future arrivals', () => {
  assert.deepEqual(expectedOrder([{ id: 'P1', arrival: 0, burst: 2 }, { id: 'P2', arrival: 4, burst: 1 }, { id: 'P3', arrival: 1, burst: 5 }]).map(p => p.id), ['P1', 'P3', 'P2']);
});
