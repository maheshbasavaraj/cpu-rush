// ==================== AUDIO ENGINE (Web Audio API, zero files) ====================
const AudioFX = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('fxMuted') !== '1';

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0, slideTo = null) {
    if (!enabled) return;
    try {
      const c = ac();
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }

  return {
    click:   () => tone(600, 0.06, 'square', 0.08),
    select:  () => tone(500, 0.08, 'sine', 0.12),
    correct: () => { tone(523, 0.09, 'sine', 0.14); tone(659, 0.09, 'sine', 0.14, 0.07); tone(784, 0.12, 'sine', 0.14, 0.14); },
    wrong:   () => { tone(220, 0.18, 'sawtooth', 0.12, 0, 110); },
    deploy:  () => { tone(330, 0.1, 'triangle', 0.13, 0, 660); },
    combo:   (n) => { const base = 440 + Math.min(n, 8) * 55; tone(base, 0.08, 'sine', 0.12); tone(base * 1.25, 0.1, 'sine', 0.12, 0.06); },
    hit:     () => { tone(880, 0.07, 'sine', 0.12); tone(1175, 0.09, 'sine', 0.10, 0.05); },
    fault:   () => { tone(180, 0.22, 'sawtooth', 0.11, 0, 90); },
    win:     () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'sine', 0.14, i * 0.11)); },
    lose:    () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, i * 0.15)); },
    levelup: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'sine', 0.13, i * 0.08)); },
    toggle:  () => { enabled = !enabled; localStorage.setItem('fxMuted', enabled ? '0' : '1'); return enabled; },
    isOn:    () => enabled
  };
})();

// ==================== GAME JUICE ====================
function popup(text, kind = 'gain', anchorEl) {
  const el = document.createElement('div');
  el.className = `fx-pop ${kind}`;
  el.textContent = text;
  const host = anchorEl || document.querySelector('main');
  if (host && host !== document.body && getComputedStyle(host).position === 'static') host.style.position = 'relative';
  (host || document.body).appendChild(el);
  el.style.left = window.innerWidth / 2 + (Math.random() * 160 - 80) + 'px';
  el.style.top = window.innerHeight * 0.35 + (Math.random() * 60 - 30) + 'px';
  setTimeout(() => el.remove(), 1100);
}
function comboPopup(n, mult) { popup(`COMBO ×${n}  +${mult}`, 'combo'); }
function shake(intensity = 'soft') {
  document.body.classList.remove('shake-soft', 'shake-hard');
  void document.body.offsetWidth;
  document.body.classList.add(intensity === 'hard' ? 'shake-hard' : 'shake-soft');
}
function flash(kind) {
  let ov = document.querySelector('.fx-flash');
  if (!ov) { ov = document.createElement('div'); ov.className = 'fx-flash'; document.body.appendChild(ov); }
  ov.className = `fx-flash ${kind} on`;
  setTimeout(() => ov.classList.remove('on'), 260);
}
function confetti(count = 40) {
  const colors = ['#62f8ff', '#ff51b4', '#a8ff60', '#ffb800', '#7b7aff'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'fx-confetti';
    c.style.left = (40 + Math.random() * 20) + 'vw';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDelay = Math.random() * 0.3 + 's';
    c.style.animationDuration = (1.2 + Math.random() * 1.2) + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2800);
  }
}

// ==================== XP / RANK ====================
const RANKS = [
  { min: 0,    name: 'INTERN',        icon: '🥚' },
  { min: 300,  name: 'JR. SCHEDULER', icon: '🐣' },
  { min: 800,  name: 'SYS ADMIN',     icon: '⚙️' },
  { min: 1600, name: 'KERNEL HACKER', icon: '🔧' },
  { min: 3000, name: 'OS ARCHITECT',  icon: '🏛️' },
  { min: 5000, name: 'SILICON GOD',   icon: '⚡' }
];
function totalXP() { return parseInt(localStorage.getItem('xp') || '0', 10); }
function rankOf(xp) { let r = RANKS[0]; for (const rk of RANKS) if (xp >= rk.min) r = rk; return r; }
function addXP(n) {
  const before = rankOf(totalXP());
  const xp = totalXP() + n;
  localStorage.setItem('xp', String(xp));
  const after = rankOf(xp);
  if (after.name !== before.name) {
    setTimeout(() => {
      AudioFX.levelup();
      popup(`${after.icon} RANK UP → ${after.name}`, 'rankup');
      confetti(50);
    }, 600);
  }
}

// ==================== ACHIEVEMENTS ====================
const ACH = [
  { id: 'first_win',   name: 'First Boot',    desc: 'Complete your first mission',       icon: '🚀', test: s => s.completed >= 1 },
  { id: 'perfect',     name: 'Flawless',      desc: '100% correct in a mission',         icon: '💎', test: s => s.sawPerfect },
  { id: 'streak5',     name: 'On Fire',       desc: '5+ streak in one mission',          icon: '🔥', test: s => s.bestStreak >= 5 },
  { id: 'streak10',    name: 'Unstoppable',   desc: '10+ streak in one mission',         icon: '☄️', test: s => s.bestStreak >= 10 },
  { id: 'all_sched',   name: 'Shift Manager', desc: 'Win all 4 CPU scheduling algos',    icon: '📋', test: s => ['fcfs','sjf','rr','priority'].every(a => s.wins.includes('scheduler:'+a)) },
  { id: 'all_mem',     name: 'Memory Master', desc: 'Win all 4 page replacement algos',  icon: '🧠', test: s => ['fifo','lru','optimal','clock'].every(a => s.wins.includes('memory:'+a)) },
  { id: 'all_disk',    name: 'Disk Jockey',   desc: 'Win all 3 disk scheduling algos',   icon: '💽', test: s => ['fcfs','sstf','scan'].every(a => s.wins.includes('disk:'+a)) },
  { id: 'all_alloc',   name: 'Space Planner', desc: 'Win all 3 allocation strategies',   icon: '📦', test: s => ['first','best','worst'].every(a => s.wins.includes('alloc:'+a)) },
  { id: 'speed',       name: 'Overclocked',   desc: 'Finish mission under 20s',          icon: '⏱️', test: s => s.elapsed <= 20 },
  { id: 'no_hints',    name: 'Purist',        desc: 'Perfect run without hints',         icon: '🧘', test: s => s.sawPerfect && s.hintsUsed === 0 },
  { id: 'both_modes',  name: 'Full Stack OS', desc: 'Win a scheduler AND memory shift',  icon: '🏆', test: s => s.wins.some(w=>w.startsWith('scheduler:')) && s.wins.some(w=>w.startsWith('memory:')) },
  { id: 'explorer',    name: 'Explorer',      desc: 'Play all 4 game modes',             icon: '🗺️', test: s => ['scheduler','memory','disk','alloc'].every(m => s.wins.some(w=>w.startsWith(m+':'))) }
];

function recordMission({ mode, algo, perfect, bestStreak, elapsed, hintsUsed }) {
  const st = (()=>{ try { return JSON.parse(localStorage.getItem('ach')||'{}'); } catch { return {}; } })();
  st.wins = st.wins || [];
  st.completed = (st.completed||0) + 1;
  const key = mode+':'+algo;
  if (!st.wins.includes(key)) st.wins.push(key);

  const view = { completed: st.completed, wins: st.wins, bestStreak, elapsed, hintsUsed, sawPerfect: !!perfect };
  const fresh = [];
  for (const a of ACH) {
    if (!st.unlocked?.includes(a.id)) {
      try { if (a.test(view)) { (st.unlocked = st.unlocked||[]).push(a.id); fresh.push(a); } } catch(e){}
    }
  }
  localStorage.setItem('ach', JSON.stringify(st));
  fresh.forEach((a, i) => setTimeout(() => {
    AudioFX.levelup(); popup(`${a.icon} ${a.name}`, 'achv'); addXP(100);
  }, 900 + i * 1400));
  return fresh;
}

function checkAchievements(stats) {
  const st = (()=>{try{return JSON.parse(localStorage.getItem('ach')||'{}')}catch{return{}}})();
  st.unlocked = st.unlocked || [];
  const have = new Set(st.unlocked);
  const fresh = [];
  for (const ach of ACH) {
    if (!have.has(ach.id)) {
      try { if (ach.test(stats)) { st.unlocked.push(ach.id); fresh.push(ach); } } catch (e) {}
    }
  }
  st.completed = (st.completed || 0) + (stats.completedDelta || 0);
  localStorage.setItem('ach', JSON.stringify(st));
  fresh.forEach((ach, i) => setTimeout(() => { AudioFX.levelup(); popup(ach.icon+' '+ach.name, 'achv'); addXP(100); }, 900 + i * 1400));
  return fresh;
}
function unlockedSet() { const st = (()=>{try{return JSON.parse(localStorage.getItem('ach')||'{}')}catch{return{}}} )(); return new Set(st.unlocked||[]); }
