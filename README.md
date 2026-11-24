# CPU Rush 🎮

> **Become the Scheduler. Beat the Clock. Rule the CPU.**

An interactive, Socratic-teaching web game for **Operating Systems**. Instead of reading about scheduling, paging, and deadlock, students *predict* what the OS would do — then the server grades the prediction against a real algorithm.

**Zero runtime dependencies.** Plain Node.js HTTP server, vanilla JS frontend.

---

## Quick Start

```bash
git clone https://github.com/maheshbasavaraj/cpu-rush.git
cd cpu-rush
npm start          # → CPU RUSH running on http://localhost:3000
```

Open **http://localhost:3000**, enter your name and USN, pick a mode and algorithm, and play.

Requires **Node.js 18+** (uses the built-in `fetch` and `node --test`; verified on Node 22).

```bash
PORT=8080 npm start   # override the default port 3000
```

---

## Game Modes

Nine modes, each driven by a real algorithm in [`public/algos.js`](public/algos.js):

| # | Mode | Algorithms | What you learn |
|---|------|-----------|----------------|
| 1 | **CPU Scheduling** | FCFS · SJF · Round Robin (q=3) · Priority | Order of execution, waiting time, turnaround |
| 2 | **Page Replacement** | FIFO · LRU · Optimal (Belady's) · Clock | Frame contents, page faults, Belady's anomaly |
| 3 | **Disk Scheduling** | FCFS · SSTF · SCAN (Elevator) | Seek order, total head movement |
| 4 | **Memory Allocation** | First Fit · Best Fit · Worst Fit | Hole selection, external fragmentation |
| 5 | **Deadlock Management** | Deadlock Avoidance (Banker's) | Safe/unsafe states, grant or deny each request |
| 6 | **Virtual Memory** | Demand Paging (FIFO) | `HIT` vs `FAULT · PURE` (read of an absent page) / `FAULT · COW` (write to a shared page) / `FAULT · PROT` (page beyond `maxPage`) |
| 7 | **File System** | Contiguous · Linked · Indexed | Block placement, fragmentation, indirection |
| 8 | **Synchronization** | Critical Section · Peterson's · TSL · Semaphores | Entry/exit conditions, busy-waiting, blocking |
| 9 | **Lockdown** | Mutex · Binary Semaphore · Counting Semaphore | Ownership vs signalling, permits, queued waiters |

Each mode scales with **level** — difficulty genuinely increases (e.g. page-replacement and paging puzzles add more frames at higher levels), and the student chooses the algorithm before the round starts.

---

## How It Works

```
┌──────────┐  POST /api/session   ┌────────────┐
│  Browser │ ───────────────────► │   Server   │  generates puzzle
│ (app.js) │ ◄─────────────────── │ (server.js)│  holds answer key
└──────────┘   puzzle, NO answer  └────────────┘
     │
     │  student predicts
     ▼
┌──────────┐  POST /api/submit    ┌────────────┐
│  Browser │ ───────────────────► │   Server   │  runs the algorithm
│          │ ◄─────────────────── │            │  grades, scores, ranks
└──────────┘   score + expected   └────────────┘
```

**The answer is never sent to the client.** The server generates the puzzle, keeps the solution server-side, and only reveals it *after* grading — so students can't inspect the response payload to cheat.

Grading is server-authoritative for the same reason: tampering with client JS can't inflate a score.

---

## Scoring & Ranks

Every round is scored from **correctness, perfect-bonus, and speed**, with a penalty per wrong answer (formulas vary slightly by mode).

Leaderboard holds the **top 20**, sorted by score, then by lowest elapsed time — persisted to `scores.json`.

XP accumulates locally (`localStorage`) and unlocks ranks:

| XP | Rank |
|----|------|
| 0 | 🥚 Intern |
| 300 | 🐣 Jr. Scheduler |
| 800 | ⚙️ Sys Admin |
| 1,600 | 🔧 Kernel Hacker |
| 3,000 | 🏛️ OS Architect |
| 5,000 | ⚡ Silicon God |

---

## Project Structure

```
cpu-rush/
├── server.js            HTTP server: /api/session, /api/submit, /api/leaderboard
│                        + static file serving (path-traversal guarded)
├── public/
│   ├── index.html       All 7 game screens
│   ├── app.js           Game state, rendering, prediction flow
│   ├── algos.js         Pure algorithm implementations (the source of truth)
│   ├── audio.js         WebAudio SFX, XP/rank system, achievements
│   ├── style.css        UI theme
│   └── ...
├── scores.json          Leaderboard (runtime data, gitignored)
├── test.js              Unit tests (node --test)
└── verify.js            Static wiring checks + live API end-to-end test
```

`algos.js` is intentionally **pure and side-effect-free** — it's shared by the grader and the unit tests, so one implementation defines correctness for both.

---

## API

### `POST /api/session`

Create a round.

```json
{
  "player": { "name": "Aditi", "usn": "1DS23CS001" },
  "mode": "deadlock",
  "algorithm": "avoidance",
  "level": 1
}
```

**201** → puzzle payload (shape varies by mode — never contains the solution):

```jsonc
{
  "id": "…uuid…",
  "mode": "deadlock",
  "algorithm": "avoidance",
  "allocation": [[0,1,0], …],
  "max":        [[7,5,3], …],
  "available":  [3,3,2]
}
```

Payload keys per mode:

| mode | keys |
|------|------|
| `scheduler` | `processes` |
| `memory` | `refString`, `frames` |
| `disk` | `requests`, `head` |
| `alloc` | `holes`, `reqSizes` |
| `deadlock` | `allocation`, `max`, `available` |
| `vm` | `frames`, `maxPage`, `refs`, `access`, `shared` |
| `fs` | `diskSize`, `disk`, `files` |

### `POST /api/submit`

Grade the round.

```json
{ "sessionId": "…uuid…", "actions": [ … ], "elapsed": 42 }
```

**200** → `{ name, usn, score, correct, total, elapsed, algorithm, level, mode, expected… }`

`expected` is only present **here**, after grading.

### `GET /api/leaderboard`

**200** → top-20 array, sorted by `score` desc, then `elapsed` asc.

---

## Testing

```bash
# Unit tests — no server needed
npm test

# Static wiring + live API end-to-end — start the server first
npm start &
node verify.js
```

- **`test.js`** — unit tests via the built-in `node:test` runner (e.g. FCFS picks ready processes by arrival time and correctly waits on future arrivals).
- **`verify.js`** — asserts every mode's dropdown has a unique `name=`, each `start*` reads *its own* dropdown (no `FormData` collisions), the scheduler path still reads the form algorithm, then hits all 7 `/api/session` endpoints and checks their payload keys.

---

## Security Notes

- **Path traversal guarded** — static serving resolves and normalizes the request path, then requires it to start with the `public/` root.
- **Answer key stays server-side** — solutions are computed only at submit time.
- **No secrets in the repo** — `.gitignore` excludes `.env*`, `*.pem`, `*.key`, `credentials.json`, `node_modules/`, and the runtime `scores.json`.
- **Input clamped** — names/USNs truncated to 30 chars; numeric fields coerced before use.

---

## Syllabus Coverage

Aligned to a standard VTU-style **Operating Systems** course (BCD305) and *Operating System Concepts* (Silberschatz):

| Module | Topics | CPU Rush mode |
|--------|--------|---------------|
| Process Scheduling | FCFS, SJF, RR, Priority | CPU Scheduling |
| Memory Management | Paging, page replacement algorithms | Page Replacement, Memory Allocation |
| Deadlocks | Characterization, Banker's algorithm, avoidance | Deadlock Management |
| Virtual Memory | Demand paging, page faults, COW | Virtual Memory |
| File Systems | Allocation methods, fragmentation | File System |

---

## Teaching It Socratically

The game is built for a **predict → commit → reveal** loop:

1. **Ask** — show the state, withhold the outcome.
2. **Commit** — the student answers *before* seeing the result.
3. **Reveal** — the server returns the correct answer and the student reconciles the difference.

That gap between prediction and outcome is where the learning happens — it forces the student to hold a mental model of the algorithm rather than pattern-match a worked example.

---

## License

Private / unlicensed. All rights reserved by the author.