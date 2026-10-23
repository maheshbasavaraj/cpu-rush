const $ = s => document.querySelector(s);
let game, selected, interval;
let memGame, memState, memInterval;
let memPrediction = { hit: null, victim: null };
let hintsUsedThisRun = 0;
let currentPlayer = null; // persisted login — no re-typing name/USN

// hide every game section + result, show home
function goHome(){
  window.scrollTo(0,0);
  [typeof interval!=='undefined'&&interval, typeof memInterval!=='undefined'&&memInterval,
   typeof diskInterval!=='undefined'&&diskInterval, typeof allocInterval!=='undefined'&&allocInterval,
   typeof dlInterval!=='undefined'&&dlInterval, typeof vmInterval!=='undefined'&&vmInterval,
   typeof fsInterval!=='undefined'&&fsInterval, typeof syncInterval!=='undefined'&&syncInterval].forEach(t=>clearInterval(t));
  ['game','memory-game','disk-game','alloc-game','deadlock-game','vm-game','fs-game','sync-game','result'].forEach(id=>{const el=document.getElementById(id); if(el)el.hidden=true;});
  $('#welcome').hidden=false;
  // don't clear name/USN — player stays logged in; only mode resets to placeholder
  const ms=$('#mode-select'); if(ms)ms.value='';
  ['algo-select-container','memory-algo-container','disk-algo-container','alloc-algo-container','deadlock-algo-container','vm-algo-container','fs-algo-container','sync-algo-container'].forEach(id=>{const el=document.getElementById(id); if(el)el.hidden=true;});
  const d=$('#algo-desc'); if(d)d.textContent='Select a game mode to choose your algorithm.';
  refreshXpUI(); leaderboard(); syncLeaderboardVisibility();
}
function syncLeaderboardVisibility(){
  const lb=document.getElementById('leaderboard-panel');
  const welcome=$('#welcome');
  const homeVisible=!!welcome && !welcome.hidden;
  if(lb) lb.hidden=!homeVisible;
  const hb=$('#home-btn');
  if(hb){
    hb.classList.toggle('show',!homeVisible);
    hb.style.display=homeVisible?'none':'inline-flex';
  }
}

const state = { actions: [], score: 0, combo: 0, stability: 100, now: 0, started: 0, context: 0, expected: [], bestStreak: 0 };
const fmt = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(Math.floor(n % 60)).padStart(2, '0');
// Wipe the result line that sits under the hint button. Only used when a fresh
// run starts — during play that line stays up until the next action replaces it.
function clearFeedback(id){ const el=document.getElementById(id); if(el){ el.hidden=true; el.innerHTML=''; } }

const algoInfo = {
  fcfs: { name: 'First-Come-First-Served', short: 'FCFS', desc: 'Pick the process that arrived earliest.' },
  sjf: { name: 'Shortest Job First', short: 'SJF', desc: 'Pick the process with the shortest burst time.' },
  rr: { name: 'Round Robin (q=3)', short: 'RR', desc: 'Each process runs for 3 time units max, then back of queue.' },
  priority: { name: 'Priority Scheduling', short: 'PRI', desc: 'Pick the highest priority (lowest number).' }
};

const memAlgoInfo = {
  fifo: { name: 'FIFO (First-In-First-Out)', short: 'FIFO', desc: 'Evict the page that entered memory FIRST.' },
  lru: { name: 'LRU (Least Recently Used)', short: 'LRU', desc: 'Evict the page whose last USE is oldest.' },
  optimal: { name: "Optimal (Belady's)", short: 'OPT', desc: 'Evict the page used farthest in future (or never). Peek ahead!' },
  clock: { name: 'Clock (Second Chance)', short: 'CLK', desc: 'Hand sweeps frames; evict first with R=0. Hits set R=1.' }
};

// ==================== XP DISPLAY ====================
function refreshXpUI() {
  const xp = totalXP();
  const rank = rankOf(xp);
  const idx = RANKS.indexOf(rank);
  const next = RANKS[idx + 1];
  $('#xp-rank').textContent = `${rank.icon} ${rank.name}`;
  $('#xp-num').textContent = `${xp} XP`;
  const pct = next ? Math.min(100, Math.round(((xp - rank.min) / (next.min - rank.min)) * 100)) : 100;
  $('#xp-fill').style.width = pct + '%';
}

// ==================== CPU SCHEDULER MODE ====================
function expected() {
  if (game.algorithm === 'rr') {
    const sequence = expectedOrderRRLocal(game.processes, 3);
    const next = sequence[state.actions.length];
    return next ? game.processes.find(p => p.id === next.id) : undefined;
  }
  return game.processes.filter(p => !p.done && p.arrival <= state.now).sort((a,b) => {
    if (game.algorithm === 'sjf') return a.burst - b.burst || a.arrival - b.arrival || a.id.localeCompare(b.id);
    if (game.algorithm === 'priority') return a.priority - b.priority || a.arrival - b.arrival || a.id.localeCompare(b.id);
    return a.arrival - b.arrival || a.id.localeCompare(b.id);
  })[0];
}

function expectedOrderRRLocal(processes, quantum = 3) {
  const remaining = processes.map(p => ({...p, remaining:p.burst}));
  const queue = [], queued = new Set(), done = new Set(), order = [];
  let now = 0;
  while (done.size < processes.length) {
    remaining.forEach(p=>{if(p.arrival<=now&&!queued.has(p.id)&&!done.has(p.id)){queue.push(p);queued.add(p.id);}});
    if(!queue.length){now=Math.min(...remaining.filter(p=>!done.has(p.id)).map(p=>p.arrival));continue;}
    const p=queue.shift(), run=Math.min(quantum,p.remaining);
    order.push({id:p.id, burst:run}); p.remaining-=run; now+=run;
    remaining.forEach(q=>{if(q.arrival<=now&&!queued.has(q.id)&&!done.has(q.id)&&q!==p){queue.push(q);queued.add(q.id);}});
    if(p.remaining>0)queue.push(p);else done.add(p.id);
  }
  return order;
}

function ready() {
  return game.processes.filter(p => !p.done && p.arrival <= state.now);
}

function render(message) {
  const list = ready();
  // stable shuffle per mission so cards never sit in arrival order
  if(!window._cardOrder||window._cardOrderFor!==(game&&game.id)){
    window._cardOrderFor=game&&game.id;
    window._cardOrder=new Map([...list].sort(()=>Math.random()-0.5).map((p,i)=>[p.id,i]));
  }
  list.sort((a,b)=>(window._cardOrder.get(a.id)??0)-(window._cardOrder.get(b.id)??0));
  $('#cards').innerHTML = list.map((p, i) =>
    `<article class="card ${selected?.id===p.id?'selected':''}" draggable="true" data-id="${p.id}"><b>${p.id}</b><span>BURST ${p.burst}</span><span>ARRIVED ${p.arrival}</span>${game.algorithm==='priority'?`<span class="priority">PRI ${p.priority}</span>`:''}<span class="kbd-hints"><span class="kbd">${i+1}</span></span></article>`
  ).join('') || '<small>No process ready. CPU clock advances automatically.</small>';
  document.querySelectorAll('.card').forEach(c => {
    c.onclick=()=>{selected=game.processes.find(p=>p.id===c.dataset.id);AudioFX.select();render();};
    c.ondragstart=e=>e.dataTransfer.setData('text',c.dataset.id);
  });
  $('#clock').textContent='SYSTEM TIME '+state.now;
  $('#score').textContent=state.score;
  $('#combo').textContent='×'+(state.combo>=5?3:state.combo>=3?2:1);
  $('#stability').style.width=state.stability+'%';
  $('#stability-text').textContent=state.stability+'%';
  $('#context').textContent=state.context;
  $('#accuracy').textContent=state.actions.length ? Math.round(state.actions.filter((id,i)=>id===state.expected[i]).length/state.actions.length*100)+'%' : '—';
  if(message) $('#notice').innerHTML=message;
}

function deploy(id) {
  const p=game.processes.find(x=>x.id===id);
  if(!p || p.done || p.arrival>state.now) return;
  const candidate=expected();
  const right=candidate?.id===p.id;
  state.actions.push(p.id);
  state.expected.push(candidate?.id);

  const info = algoInfo[game.algorithm];
  if(right){
    state.combo++;
    state.bestStreak=Math.max(state.bestStreak,state.combo);
    const gain=Math.round(100*(state.combo>=5?1.5:state.combo>=3?1.25:1));
    state.score+=gain;
    AudioFX.correct();
    if(state.combo>=3){AudioFX.combo(state.combo);comboPopup(state.combo,gain);}
    else popup('+'+gain,'gain',$('#cpu'));
    flash('good');
    $('#notice').innerHTML=`✓ Correct <b>${info.short}</b> choice.`;
  }else{
    state.combo=0;
    state.score=Math.max(0,state.score-50);
    state.stability=Math.max(0,state.stability-15);
    AudioFX.wrong(); shake(state.stability<50?'hard':'soft'); flash('bad');
    popup('−50','loss',$('#cpu'));
    $('#notice').innerHTML=`⚠ Wrong! <b>${candidate? candidate.id+' was correct':'no process ready'}</b>. Stability −15%.`;
  }
  state.context += state.actions.length>1?1:0;
  const runFor = game.algorithm==='rr' ? Math.min(3, p.rrRemaining ?? p.burst) : p.burst;
  if(game.algorithm==='rr'){
    p.rrRemaining=(p.rrRemaining ?? p.burst)-runFor;
    p.done=p.rrRemaining<=0;
  }else p.done=true;
  state.now+=runFor;
  selected=null;
  $('#cpu').textContent=p.id+' RUNNING ⚡';
  $('#cpu').classList.add('active'); AudioFX.deploy();
  setTimeout(()=>{$('#cpu').textContent='IDLE ⚡';$('#cpu').classList.remove('active')},500);

  const tickClass=(game.algorithm==='rr'&&candidate?.preempted)?'tick preempted':'tick';
  $('#gantt').innerHTML+=`<span class="${tickClass}">${p.id} · ${runFor}</span>`;

  if(game.processes.every(x=>x.done)||state.stability===0) finish();
  else {
    while(!ready().length&&!game.processes.every(x=>x.done)) state.now=Math.min(...game.processes.filter(x=>!x.done).map(x=>x.arrival));
    render();
  }
}

async function start(player){
  hintsUsedThisRun=0;
  const { algorithm, mode='scheduler', ...playerInfo } = player;

  if(mode==='memory'){ startMemory(player); return; }
  if(mode==='disk'){ startDisk(player); return; }
  if(mode==='alloc'){ startAlloc(player); return; }
  if(mode==='deadlock'){ startDeadlock(player); return; }
  if(mode==='vm'){ startVM(player); return; }
  if(mode==='fs'){ startFS(player); return; }
  if(mode==='sync'){ startSync(player); return; }

  const res=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:playerInfo,algorithm,level:1})});
  game=await res.json();
  game.player=playerInfo;
  Object.assign(state,{actions:[],expected:[],score:0,combo:0,stability:100,now:0,context:0,bestStreak:0,started:Date.now()});

  const info=algoInfo[game.algorithm];
  $('#mission-label').textContent=`SHIFT ${game.level} · ${info.short}`;
  render(`<b>${info.short}</b>: ${info.desc}`);
  $('#welcome').hidden=true; syncLeaderboardVisibility();$('#game').hidden=false; syncLeaderboardVisibility();
  interval=setInterval(()=>$('#timer').textContent=fmt((Date.now()-state.started)/1000),1000);
}

async function finish(){
  clearInterval(interval);
  $('#game').hidden=true;
  const elapsed=Math.round((Date.now()-state.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:game.id,actions:state.actions,elapsed})});
  const r=await res.json();
  const info=algoInfo[game.algorithm];
  const perfect=r.correct===r.total;
  const acc=state.actions.length?Math.round(state.actions.filter((id,i)=>id===state.expected[i]).length/state.actions.length*100):0;

  // XP: 1 XP per point scored
  addXP(r.score);
  refreshXpUI();

  // achievements
  checkAchievements({ completedDelta:1, perfect, bestStreak:state.bestStreak, elapsed, hintsUsed:hintsUsedThisRun,
    modesWon:{ scheduler:true, memory:false }, algoWins:[game.algorithm] });

  if(perfect){AudioFX.win();confetti(60);}else if(r.correct>=r.total/2){AudioFX.win();}else{AudioFX.lose();shake('hard');}

  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ MISSION COMPLETE':r.correct>=r.total/2?'SHIFT SURVIVED':'SYSTEM CRASH'}</h2>
    <p><b>${info.short}</b> · ${r.correct}/${r.total} correct · accuracy ${acc}% · time ${fmt(elapsed)}</p>
    <div class="result-stats">
      <div class="rs"><b>+${r.score}</b><span>SCORE</span></div>
      <div class="rs"><b>×${state.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>${acc}%</b><span>ACCURACY</span></div>
      <div class="rs"><b>+${Math.max(0,r.score)}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}

// ==================== MEMORY MODE ====================
function renderMemory() {
  if (!memGame) return;
  const step = memState.currentStep;
  const refString = memGame.refString;
  const frames = memGame.frames;
  const expected = memState.expected;

  $('#ref-string').innerHTML = refString.map((page, idx) => {
    let cls = 'ref-item';
    if (idx === step) cls += ' current';
    else if (idx < step) cls += ' done';
    // no fault coloring — would leak the answer before prediction
    return `<div class="${cls}" data-idx="${idx}">${page}</div>`;
  }).join('');

  const stepData = expected.steps[step - 1]; // memory shown AFTER previous action
  const memory = stepData ? stepData.memory : [];
  $('#frames').innerHTML = Array.from({ length: frames }, (_, i) => {
    const page = memory[i];
    if (!page) return '<div class="frame empty"></div>';
    // no victim highlighting — only revealed after answer or hint
    const refBit = (expected.steps[step] && expected.steps[step].refBits) ? expected.steps[step].refBits[i] : 0;
    return `<div class="frame filled" data-page="${page}"><span class="page-num">${page}</span><span class="ref-bit">R=${refBit}</span></div>`;
  }).join('');

  $('#page-table').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const page = i + 1;
    const frameIdx = memory.indexOf(page);
    return `<div class="page-entry ${frameIdx !== -1 ? 'present' : ''}"><div class="page-id">${page}</div><div class="frame-id">${frameIdx !== -1 ? 'F'+frameIdx : '—'}</div></div>`;
  }).join('');

  $('#memory-pos').textContent = `STEP ${step + 1} / ${refString.length}`;
  $('#memory-frames').textContent = `${frames} FRAMES`;
  const lastFault = expected.steps[step - 1] ? expected.steps[step - 1].faultCount : 0;
  $('#memory-faults').textContent = lastFault;
  $('#memory-score').textContent = memState.score;
  $('#memory-streak').textContent = memState.streak;

  $('#memory-log').innerHTML = expected.steps.slice(0, step).map((s, idx) => {
    let actionText = s.hit ? 'HIT' : `MISS → evict ${s.victim}, load ${s.page}`;
    let cls = s.hit ? 'action' : 'fault';
    return `<div class="log-entry"><span class="step">#${idx+1}</span><span class="page">Ref:${s.page}</span><span class="${cls}">${actionText}</span></div>`;
  }).join('');
  const log=$('#memory-log'); log.scrollTop=log.scrollHeight;
}

function showStep1() {
  document.getElementById('predict-step1').hidden=false;
  document.getElementById('predict-step2').hidden=true;
  document.getElementById('predict-result').hidden=true;
  document.querySelectorAll('.pred-btn.large').forEach(b=>b.classList.remove('selected','correct','wrong'));
  document.getElementById('memory-controls').hidden=false;
  memPrediction={hit:null,victim:null};
  updateNotice();
}

function showStep2() {
  document.getElementById('predict-step1').hidden=true;
  document.getElementById('predict-step2').hidden=false;
  document.getElementById('predict-result').hidden=true;
  document.getElementById('memory-controls').hidden=false;

  const step = memState.currentStep;
  const stepData = memState.expected.steps[step];
  const memory = stepData.memory;

  // MISS with no victim = free frame available, auto-submit
  const needsVictim = !stepData.hit && stepData.victim !== null;

  if (!needsVictim) {
    memPrediction.victim = null;
    submitPrediction();
    return;
  }

  const victimGrid=document.getElementById('victim-grid');
  // Pre-load memory snapshot: victim must be chosen from frames BEFORE new page loads
  const memoryBefore = step > 0 ? memState.expected.steps[step - 1].memory : [];
  victimGrid.innerHTML=memoryBefore.map((page,i)=>`
    <div class="victim-card" data-page="${page}">
      <span class="victim-page">${page}</span>
      <span class="victim-label">frame ${i}</span>
    </div>`).join('');

  document.querySelectorAll('.victim-card').forEach(card=>{
    card.onclick=()=>{
      document.querySelectorAll('.victim-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected'); AudioFX.click();
      memPrediction.victim=parseInt(card.dataset.page);
      document.getElementById('submit-prediction').disabled=false;
    };
  });

  document.getElementById('submit-prediction').disabled=true;
  document.getElementById('submit-prediction').onclick=submitPrediction;
  updateNotice();
}

function showResult(correct,message){
  document.getElementById('predict-step1').hidden=true;
  document.getElementById('predict-step2').hidden=true;
  document.getElementById('memory-controls').hidden=false;
  const r=document.getElementById('predict-result');
  r.hidden=false;
  r.className='predict-result '+(correct?'correct':'wrong');
  r.innerHTML=message;
  const notice=document.getElementById('memory-notice');
  if(notice)notice.innerHTML=correct?'Prediction recorded ✓':'Prediction recorded — review the result above.';
}

function updateNotice(){
  if(!memState||!memState.expected||!memGame)return;
  const step=memState.currentStep;
  if(step>=memGame.refString.length)return;
  const currentRef=memGame.refString[step];
  const notice=document.getElementById('memory-notice');
  if(!notice)return;
  if(document.getElementById('predict-step2')&&!document.getElementById('predict-step2').hidden){
    notice.innerHTML=`Step ${step+1}: Page <strong>${currentRef}</strong> → MISS predicted. <span class="instruction">Pick victim to evict.</span>`;
  }else{
    notice.innerHTML=`Step ${step+1}: Page <strong id="current-ref">${currentRef}</strong> is ready. Use the controls below to make your prediction.`;
  }
}

function submitPrediction(){
  const step=memState.currentStep;
  const stepData=memState.expected.steps[step];
  const needsVictim=!stepData.hit&&stepData.victim!==null;

  const correctHit=stepData.hit===memPrediction.hit;
  const correctVictim=needsVictim?stepData.victim===memPrediction.victim:true;
  const correct=correctHit&&correctVictim;

  if(correct){
    memState.streak++;
    memState.bestStreak=Math.max(memState.bestStreak||0,memState.streak);
    const gain=50*(memState.streak>=5?2:memState.streak>=3?1.5:1)|0;
    memState.score+=gain;
    if(stepData.hit){AudioFX.hit();popup('HIT +'+gain,'gain',$('#frames'));}
    else{AudioFX.fault();popup('FAULT +'+gain,'gain',$('#frames'));flash('good');}
    if(memState.streak>=3){comboPopup(memState.streak,gain);}
  }else{
    memState.streak=0;
    memState.score=Math.max(0,memState.score-30);
    AudioFX.wrong();shake('hard');flash('bad');popup('−30','loss',$('#frames'));
  }

  memState.predictions.push({...memPrediction,hitCorrect:correctHit,victimCorrect:correctVictim});
  memState.currentStep++;

  let msg;
  if(stepData.hit){
    msg=correct?'✓ Correct — it was a HIT':'✗ It was a HIT (page in frames)';
  }else if(!needsVictim){
    msg=correct?'✓ MISS — free frame used, no eviction needed':'✗ It was a MISS (free frame available)';
  }else{
    const rightCard=stepData.victim===memPrediction.victim?'':'<br><small>Hint: '+memAlgoInfo[memGame.algorithm].short+' rule picks page '+stepData.victim+'</small>';
    msg=(correct?'✓ MISS — correct victim: ':'✗ MISS — wrong victim, was page ')+stepData.victim+rightCard;
  }

  showResult(correct,msg);

  setTimeout(()=>{
    renderMemory();
    if(memState.currentStep>=memState.expected.steps.length){finishMemory();}
    else{setTimeout(showStep1,700);}
  },correct?900:1600);
}

async function startMemory(player){
  hintsUsedThisRun=0;
  const {mode, ...playerInfo}=player;
  const algorithm=$('#memory-algo-select').value;
  const res=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})});
  memGame=await res.json();
  memGame.player=playerInfo;

  memState={currentStep:0,score:0,streak:0,bestStreak:0,predictions:[],expected:null,started:Date.now()};
  memState.expected=computeExpectedLocal(memGame.refString,memGame.frames,memGame.algorithm);

  const info=memAlgoInfo[memGame.algorithm];
  $('#memory-mission-label').textContent=`MEMORY SHIFT ${memGame.level} · ${info.short}`;
  renderMemory();
  $('#welcome').hidden=true; syncLeaderboardVisibility();
  $('#memory-game').hidden=false;
  memInterval=setInterval(()=>{$('#memory-timer').textContent=fmt((Date.now()-memState.started)/1000)},1000);
  showStep1();
}

function computeExpectedLocal(refString,frames,algorithm){
  switch(algorithm){
    case 'lru':return pageReplacementLRULocal(refString,frames);
    case 'optimal':return pageReplacementOptimalLocal(refString,frames);
    case 'clock':return pageReplacementClockLocal(refString,frames);
    default:return pageReplacementFIFOLocal(refString,frames);
  }
}
function pageReplacementFIFOLocal(refString,frames){
  const memory=[],order=[],steps=[];
  refString.forEach((page,idx)=>{
    const hit=memory.includes(page);let victim=null;
    if(!hit){
      if(memory.length<frames){memory.push(page);order.push(page);}
      else{victim=order.shift();memory[memory.indexOf(victim)]=page;order.push(page);}
    }
    steps.push({page,memory:[...memory],hit,victim,faultCount:steps.filter(s=>!s.hit).length+(hit?0:1)});
  });
  return{steps,totalFaults:steps.filter(s=>!s.hit).length,algorithm:'FIFO'};
}
function pageReplacementLRULocal(refString,frames){
  const memory=[],recentUse={},steps=[];
  refString.forEach((page,idx)=>{
    const hit=memory.includes(page);let victim=null;
    if(!hit){
      if(memory.length<frames){memory.push(page);}
      else{victim=memory.reduce((lru,p)=>recentUse[p]!==undefined&&recentUse[p]<recentUse[lru]?p:lru,memory[0]);
        memory[memory.indexOf(victim)]=page;}
    }
    recentUse[page]=idx;
    steps.push({page,memory:[...memory],hit,victim,faultCount:steps.filter(s=>!s.hit).length+(hit?0:1)});
  });
  return{steps,totalFaults:steps.filter(s=>!s.hit).length,algorithm:'LRU'};
}
function pageReplacementOptimalLocal(refString,frames){
  const memory=[],steps=[];
  refString.forEach((page,idx)=>{
    const hit=memory.includes(page);let victim=null;
    if(!hit){
      if(memory.length<frames){memory.push(page);}
      else{
        let farthest=-1;victim=memory[0];
        memory.forEach(p=>{
          const nextUse=refString.slice(idx+1).indexOf(p);
          if(nextUse===-1){victim=p;farthest=Infinity;}
          else if(nextUse>farthest){farthest=nextUse;victim=p;}
        });
        memory[memory.indexOf(victim)]=page;
      }
    }
    steps.push({page,memory:[...memory],hit,victim,faultCount:steps.filter(s=>!s.hit).length+(hit?0:1)});
  });
  return{steps,totalFaults:steps.filter(s=>!s.hit).length,algorithm:'OPTIMAL'};
}
function pageReplacementClockLocal(refString,frames){
  const memory=[],refBits=[],steps=[];let hand=0;
  refString.forEach((page,idx)=>{
    const hit=memory.includes(page);let victim=null;
    if(hit){refBits[memory.indexOf(page)]=1;}
    else if(memory.length<frames){memory.push(page);refBits.push(1);}
    else{
      while(true){
        if(refBits[hand]===0){victim=memory[hand];memory[hand]=page;refBits[hand]=1;hand=(hand+1)%frames;break;}
        refBits[hand]=0;hand=(hand+1)%frames;
      }
    }
    steps.push({page,memory:[...memory],refBits:[...refBits],clockHand:hand,hit,victim,faultCount:steps.filter(s=>!s.hit).length+(hit?0:1)});
  });
  return{steps,totalFaults:steps.filter(s=>!s.hit).length,algorithm:'CLOCK'};
}

async function finishMemory(){
  clearInterval(memInterval);
  $('#memory-game').hidden=true;
  const elapsed=Math.round((Date.now()-memState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:memGame.id,actions:memState.predictions,elapsed})});
  const r=await res.json();
  const info=memAlgoInfo[memGame.algorithm];
  const perfect=r.correct===r.total;
  const acc=Math.round(r.correct/r.total*100);

  addXP(r.score);
  refreshXpUI();
  checkAchievements({completedDelta:1,perfect,bestStreak:memState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun,
    modesWon:{scheduler:false,memory:true},algoWins:[memGame.algorithm]});

  if(perfect){AudioFX.win();confetti(60);}else if(acc>=60){AudioFX.win();}else{AudioFX.lose();shake('hard');}

  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ MEMORY MASTER':acc>=60?'SHIFT SURVIVED':'MEMORY OVERFLOW'}</h2>
    <p><b>${info.short}</b> · ${r.correct}/${r.total} correct predictions · accuracy ${acc}%</p>
    <div class="result-stats">
      <div class="rs"><b>${r.totalFaults}</b><span>PAGE FAULTS</span></div>
      <div class="rs"><b>×${memState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>${acc}%</b><span>ACCURACY</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}

async function leaderboard(){
  const rows=await(await fetch('/api/leaderboard')).json();
  $('#board').innerHTML=rows.length?rows.map((r,i)=>`<li><span>${i+1}. ${r.name} <small>${r.usn}</small> <small class="algo-tag">${(MODE_LABEL[r.mode]||'CPU:')}${(r.algorithm||'FCFS').toUpperCase()}</small></span><b>${r.score}</b></li>`).join(''):'<li><span>No completed missions yet.</span></li>';
}


// ==================== NEW MODE INFO MAPS ====================
const dlAlgoInfo = {
  avoidance: { name: "Banker's Algorithm (Deadlock Avoidance)", short: "BANKER'S",
    desc: 'Grant a request only if the resulting state is SAFE — some sequence can still finish every process.' }
};
const vmAlgoInfo = {
  fifo: { name: 'Demand Paging (FIFO)', short: 'DEMAND',
    desc: 'A read of an absent page is a PURE fault. A write to a SHARED page is a COW fault. A page beyond maxPage is a PROT fault.' }
};
const fsAlgoInfo = {
  contiguous: { name: 'Contiguous Allocation', short: 'CONTIGUOUS',
    desc: 'CONTIGUOUS: Select exactly the file’s number of adjacent free blocks in one unbroken run.' },
  linked: { name: 'Linked Allocation', short: 'LINKED',
    desc: 'LINKED: Select exactly the file’s number of free blocks. They can be separated; the links follow block-number order.' },
  indexed: { name: 'Indexed Allocation', short: 'INDEXED',
    desc: 'INDEXED: Select one index block plus one block per data block. The lowest-numbered selection is the index block.' }
};
const MODE_LABEL = { scheduler:'CPU:', memory:'MEM:', disk:'DISK:', alloc:'ALLOC:',
  deadlock:'DL:', vm:'VM:', fs:'FS:' };

// ==================== DISK SCHEDULING GAME ====================
let diskGame, diskState, diskInterval;

const diskAlgoInfo = {
  fcfs: { name: 'FCFS', short: 'FCFS', desc: 'Serve requests in the order they arrived (left to right as listed).' },
  sstf: { name: 'SSTF', short: 'SSTF', desc: 'Always serve the track CLOSEST to the current head position.' },
  scan: { name: 'SCAN', short: 'SCAN', desc: 'Elevator: head moves UP serving all, jumps to end, then sweeps DOWN.' }
};

function renderDisk() {
  const g = diskGame, s = diskState;
  $('#disk-track-strip').innerHTML = g.requests.map(t => {
    const served = s.order.includes(t);
    // served chips stay visible/clickable (re-click ignored) — never disabled
    return `<div class="track-chip ${served?'served':''}" data-track="${t}">${t}${t===g.head?'<small style="font-size:9px;color:var(--lime)">HEAD</small>':''}</div>`;
  }).join('');
  document.querySelectorAll('.track-chip').forEach(chip=>{
    chip.onclick=()=>{
      const t=parseInt(chip.dataset.track);
      if(s.order.includes(t))return; // already in order — ignore, but chip stays enabled
      s.order.push(t);AudioFX.click();
      const prev=s.order.length>1?s.order[s.order.length-2]:g.head;
      s.seek+=Math.abs(t-prev);
      $('#disk-seek-so-far').textContent=s.seek;
      renderDisk();
    };
  });
  $('#disk-my-order').innerHTML=s.order.map((t,i)=>`<span class="order-chip">${i+1}. ${t}</span>`).join('')||'<small>Click tracks to build your order…</small>';
  $('#disk-progress').textContent=`NEXT: ${s.order.length}/${g.requests.length}`;
  $('#disk-seek').textContent=s.seek;
}

function startDisk(player){
  hintsUsedThisRun=0;
  const {mode,...playerInfo}=player;
  const algorithm=$('#disk-algo-select').value;
  fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})})
    .then(r=>r.json())
    .then(g=>{
      diskGame=g;diskState={order:[],seek:0,started:Date.now(),score:0};
      const info=diskAlgoInfo[g.algorithm];
      $('#disk-mission-label').textContent=`DISK SHIFT ${g.level} · ${info.short}`;
      $('#disk-notice').innerHTML=`Head starts at <b>${g.head}</b>. ${info.desc}`;
      $('#welcome').hidden=true; syncLeaderboardVisibility();$('#disk-game').hidden=false;
      $('#disk-result').hidden=true;$('#disk-submit').disabled=false;
      $('#disk-head-pos').textContent=g.head;
      $('#disk-seek-so-far').textContent='0';
      $('#disk-path').textContent='';
      renderDisk();
      diskInterval=setInterval(()=>$('#disk-timer').textContent=fmt((Date.now()-diskState.started)/1000),1000);
    })
    .catch(e=>{$('#algo-desc').textContent='Failed to start: '+e.message;});
}

async function finishDisk(){
  clearInterval(diskInterval);
  const elapsed=Math.round((Date.now()-diskState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:diskGame.id,actions:diskState.order,elapsed})});
  const r=await res.json();
  const info=diskAlgoInfo[diskGame.algorithm];
  const perfect=r.correct===r.total;
  addXP(r.score);refreshXpUI();
  recordMission({mode:'disk',algo:diskGame.algorithm,perfect,bestStreak:r.correct,elapsed,hintsUsed:hintsUsedThisRun});
  renderAchShelf();
  if(perfect){AudioFX.win();confetti(60);}else if(r.correct>=r.total/2){AudioFX.win();}else{AudioFX.lose();shake('hard');}

  // draw optimal path
  $('#disk-path').innerHTML = 'HEAD '+(diskGame.head)+' → '+r.expectedOrder.join(' → ');
  // mark chips
  document.querySelectorAll('.track-chip').forEach(chip=>{
    chip.classList.remove('correct','wrong');
    if(r.expectedOrder.includes(parseInt(chip.dataset.track)))chip.classList.add('correct');
  });
  $('#disk-result').hidden=false;
  $('#disk-result').className='predict-result '+(perfect?'correct':'wrong');
  $('#disk-result').innerHTML=`${perfect?'✓ PERFECT ROUTE!':`${r.correct}/${r.total} in right position`} · Optimal seek: <b>${r.seekTotal}</b> · Score: <b>+${r.score}</b><br><small>Optimal order: ${r.expectedOrder.join(', ')}</small>`;
}

// ==================== MEMORY ALLOCATION GAME ====================
let allocGame, allocState, allocInterval;

const allocAlgoInfo = {
  first: { name: 'First Fit', short: 'FIRST', desc: 'Scan holes left→right; place request in FIRST hole big enough.' },
  best:  { name: 'Best Fit', short: 'BEST', desc: 'Place in the SMALLEST hole that still fits (tightest fit).' },
  worst: { name: 'Worst Fit', short: 'WORST', desc: 'Place in the LARGEST hole available.' }
};

function startAlloc(player){
  hintsUsedThisRun=0;
  const {mode,...playerInfo}=player;
  const algorithm=$('#alloc-algo-select').value;
  fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})})
    .then(r=>r.json())
    .then(g=>{
      allocGame=g;
      allocState={idx:0,score:0,streak:0,bestStreak:0,selectedIdx:null,answers:[],placed:[],started:Date.now(),
        working:g.holes.map(h=>({id:h.id,size:h.size}))};
      const info=allocAlgoInfo[g.algorithm];
      $('#alloc-mission-label').textContent=`ALLOC SHIFT ${g.level} · ${info.short}`;
      $('#welcome').hidden=true; syncLeaderboardVisibility();$('#alloc-game').hidden=false;
      $('#alloc-feedback').hidden=true;
      renderAlloc();updateAllocNotice();
      allocInterval=setInterval(()=>$('#alloc-timer').textContent=fmt((Date.now()-allocState.started)/1000),1000);
    })
    .catch(e=>{$('#algo-desc').textContent='Failed to start: '+e.message;});
}

function allocHoleState(){ return allocGame.holes.map(h=>({...h})); }

function renderAlloc(){
  const g=allocGame,s=allocState;
  const holes=s.working;
  $('#alloc-holes').innerHTML=holes.map((h,i)=>{
    const usedPct=Math.min(100,(h.size/(h.orig||h.size))*100);
    const curReq=g.reqSizes[s.idx];
    const fits=h.size>=curReq;
    return `<div class="hole-row">
      <div class="hole-label">Hole ${h.id}</div>
      <div class="hole-bar ${fits&&!s.locked?'pickable':''}" data-hole="${i}" style="width:${Math.max(120,h.size*1.6)}px">
        <div class="hole-fill" style="width:${usedPct}%"></div>
        <span class="hole-size">${h.size} KB free</span>
      </div></div>`;
  }).join('');
  document.querySelectorAll('.hole-bar.pickable').forEach(bar=>{
    bar.onclick=()=>{
      document.querySelectorAll('.hole-bar').forEach(b=>b.classList.remove('selected'));
      bar.classList.add('selected');AudioFX.click();
      s.selectedIdx=parseInt(bar.dataset.hole);
      updateAllocNotice('Hole '+s.working[s.selectedIdx].id+' selected — now press CONFIRM.');
    };
  });
  $('#alloc-reqs').innerHTML=g.reqSizes.map((r,i)=>`<span class="req-chip ${i<s.idx?'done':i===s.idx?'current':''}">${r}K</span>`).join('');
  $('#alloc-cur').textContent=s.idx<g.reqSizes.length?g.reqSizes[s.idx]:'done';
  $('#alloc-score').textContent=s.score;
  $('#alloc-streak').textContent=s.streak;
  // allocation map
  $('#alloc-map').innerHTML=holes.map(h=>`<span class="order-chip">H${h.id}: ${h.size}K free</span>`).join(' ')+' <span style="color:#8ca2bf">| placed: '+s.placed.length+'</span>';
}

function updateAllocNotice(msg){
  const cur=allocGame.reqSizes[allocState.idx];
  const info=allocAlgoInfo[allocGame.algorithm];
  $('#alloc-notice').innerHTML=(msg?msg+' · ':'')+`Request <b>${cur}KB</b>: ${info.desc}`;
}

function allocConfirm(skip=false){
  const s=allocState,g=allocGame;
  if(s.idx>=g.reqSizes.length)return;
  const req=g.reqSizes[s.idx];
  let chosen=null;
  if(!skip){
    if(s.selectedIdx==null){updateAllocNotice('⚠ Pick a hole first!');AudioFX.wrong();return;}
    chosen=s.working[s.selectedIdx];
  }
  // compute correct answer
  const strat=allocGame.algorithm;
  let expect=null;
  if(strat==='first')expect=s.working.find(h=>h.size>=req)||null;
  else if(strat==='best')expect=[...s.working].filter(h=>h.size>=req).sort((a,b)=>a.size-b.size||a.id-b.id)[0]||null;
  else expect=[...s.working].filter(h=>h.size>=req).sort((a,b)=>b.size-a.size||a.id-b.id)[0]||null;

  const correct=skip?(expect==null):(expect&&chosen&&chosen.id===expect.id);
  s.answers.push(skip?null:(chosen?chosen.id:null));

  const fb=$('#alloc-feedback');fb.hidden=false;
  if(correct){
    s.streak++;s.bestStreak=Math.max(s.bestStreak,s.streak);
    const gain=Math.round(70*(s.streak>=3?1.5:1));
    s.score+=gain;
    AudioFX.correct();popup('+'+gain,'gain',$('#alloc-holes'));flash('good');
    fb.className='predict-result correct';
    fb.textContent=skip?'✓ Correct — it cannot fit anywhere':'✓ Correct hole!';
  }else{
    s.streak=0;s.score=Math.max(0,s.score-30);
    AudioFX.wrong();shake('hard');flash('bad');
    fb.className='predict-result wrong';
      fb.textContent=skip?(expect?'✗ It FITS in hole '+expect.id:'✗ Correct — nothing fits'):(expect?'✗ Wrong. '+allocAlgoInfo[strat].short+' picks Hole '+expect.id:'✗ Wrong — no hole fits');
  }

  // apply placement
  if(expect){
    const target=s.working.find(h=>h.id===expect.id);
    target.orig=target.orig||target.size;
    target.size-=req;
    s.placed.push({holeId:target.id,req});
  }
  s.selectedIdx=null;s.idx++;
  setTimeout(()=>{
    fb.hidden=true;
    if(s.idx>=g.reqSizes.length){finishAlloc();}
    else{renderAlloc();updateAllocNotice();}
  },1100);
}

async function finishAlloc(){
  clearInterval(allocInterval);
  const elapsed=Math.round((Date.now()-allocState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:allocGame.id,actions:allocState.answers,elapsed})});
  const r=await res.json();
  const perfect=r.correct===r.total;
  addXP(r.score);refreshXpUI();
  recordMission({mode:'alloc',algo:allocGame.algorithm,perfect,bestStreak:allocState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun});
  renderAchShelf();
  if(perfect){AudioFX.win();confetti(60);}else{AudioFX.win();}
  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ SPACE PLANNER':'SHIFT SURVIVED'}</h2>
    <p><b>${allocAlgoInfo[allocGame.algorithm].name}</b> · ${r.correct}/${r.total} placements correct</p>
    <div class="result-stats">
      <div class="rs"><b>${r.correct}/${r.total}</b><span>CORRECT</span></div>
      <div class="rs"><b>×${allocState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}



// ==================== DEADLOCK AVOIDANCE (BANKER'S) GAME ====================
let dlGame, dlState, dlInterval;

function startDeadlock(player){
  hintsUsedThisRun=0;
  const {mode,...playerInfo}=player;
  const algorithm=$('#deadlock-algo-select').value;
  fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})})
    .then(r=>r.json())
    .then(g=>{
      dlGame=g;
      dlState={ idx:0, score:0, streak:0, bestStreak:0, answers:[],
                alloc:g.allocation.map(r=>[...r]), avail:[...g.available],
                started:Date.now(), locked:false };
      dlState.requests = generateDlRequests(g);
      const info=dlAlgoInfo[g.algorithm]||dlAlgoInfo.avoidance;
      $('#dl-mission-label').textContent=`DEADLOCK SHIFT ${g.level} · ${info.short}`;
      $('#welcome').hidden=true; syncLeaderboardVisibility();
      $('#deadlock-game').hidden=false;
      clearFeedback('dl-feedback');
      renderDeadlock();
      clearInterval(dlInterval);
      dlInterval=setInterval(()=>$('#dl-timer').textContent=fmt((Date.now()-dlState.started)/1000),1000);
    })
    .catch(e=>{ console.error(e); alert('Could not start deadlock mission.'); });
}

// Build a list of requests: a mix the player must grant or deny.
function generateDlRequests(g){
  const reqs=[]; const m=g.available.length;
  const work={ allocation:g.allocation.map(r=>[...r]), available:[...g.available] };
  const needOf=()=>work.allocation.map((row,i)=>row.map((a,j)=>g.max[i][j]-a));
  for(let k=0;k<6;k++){
    const nd=needOf();
    // Only ask a process that still needs something, so no request is all-zero.
    const cands=nd.map((row,i)=>row.some(v=>v>0)?i:-1).filter(i=>i>=0);
    if(!cands.length) break;
    const pid=cands[Math.floor(Math.random()*cands.length)];
    // Ask for part of what it still needs (never more than Need)…
    let req=nd[pid].map(v=> v<=0 ? 0 : 1+Math.floor(Math.random()*v));
    // …but ~35% of the time push it past what is currently free, forcing a DENY.
    if(Math.random()<0.35) req=req.map(v=> v>0 ? v+1+Math.floor(Math.random()*2) : v);
    reqs.push({ pid, req });
    // Advance along the CORRECT path, so later requests are computed against the
    // state the player actually reaches rather than the initial state every time.
    const chk=bankersRequestLocal(work.allocation,g.max,work.available,pid,req);
    if(chk.grant){ for(let j=0;j<m;j++){ work.allocation[pid][j]+=req[j]; work.available[j]-=req[j]; } }
  }
  return reqs;
}

// Local Banker's check (mirrors algos.js bankersRequest)
function bankersSafeLocal(allocation,max,available){
  const n=allocation.length,m=available.length;
  const need=allocation.map((row,i)=>row.map((a,j)=>max[i][j]-a));
  const work=[...available]; const finish=new Array(n).fill(false); const seq=[];
  let progress=true;
  while(progress){
    progress=false;
    for(let i=0;i<n;i++){
      if(finish[i])continue;
      if(need[i].every((v,j)=>v<=work[j])){
        for(let j=0;j<m;j++)work[j]+=allocation[i][j];
        finish[i]=true; seq.push(i); progress=true;
      }
    }
  }
  return { safe:finish.every(Boolean), seq };
}
function bankersRequestLocal(allocation,max,available,pid,req){
  const need=allocation.map((row,i)=>row.map((a,j)=>max[i][j]-a));
  if(req.some((v,j)=>v>need[pid][j])) return {grant:false,reason:'exceeds-need',seq:[]};
  if(req.some((v,j)=>v>available[j])) return {grant:false,reason:'not-available',seq:[]};
  const a2=allocation.map(r=>[...r]);
  for(let j=0;j<available.length;j++)a2[pid][j]+=req[j];
  const av2=available.map((v,j)=>v-req[j]);
  const chk=bankersSafeLocal(a2,max,av2);
  return { grant:chk.safe, reason:chk.safe?'safe':'unsafe', seq:chk.seq };
}

function renderDeadlock(){
  const g=dlGame, st=dlState;
  if(!g||!st)return;

  // resource state table
  const m=g.available.length;
  let html='<div class="dl-table-wrap"><table class="dl-table"><thead><tr><th scope="col">Process</th>';
  for(let j=0;j<m;j++)html+=`<th scope="col">R${j}<small>Alloc</small></th>`;
  for(let j=0;j<m;j++)html+=`<th scope="col">R${j}<small>Max</small></th>`;
  for(let j=0;j<m;j++)html+=`<th scope="col">R${j}<small>Need</small></th>`;
  html+='</tr></thead><tbody>';
  st.alloc.forEach((row,i)=>{
    html+=`<tr><th scope="row">P${i}</th>`;
    row.forEach(v=>{ html+=`<td class="alloc">${v}</td>`; });
    g.max[i].forEach(v=>{ html+=`<td class="maxc">${v}</td>`; });
    row.forEach((v,j)=>{ html+=`<td class="need">${g.max[i][j]-v}</td>`; });
    html+='</tr>';
  });
  html+='<tr class="available-row"><th scope="row">Available</th>';
  for(let j=0;j<m;j++)html+=`<td class="avail">${st.avail[j]}</td>`;
  for(let j=0;j<m*2;j++)html+='<td class="maxc">—</td>';
  html+='</tr></tbody></table></div>';
  $('#dl-state').innerHTML=html;

  // current request
  const cur=st.requests[st.idx];
  if(!cur){ finishDeadlock(); return; }
  $('#dl-request').innerHTML=`<div class="big-req"><b>P${cur.pid}</b> requests</div>
    <div class="dl-req-resources">${cur.req.map((v,j)=>`<span>R${j}<b>${v}</b></span>`).join('')}</div>
    <div class="req-progress">REQUEST ${st.idx+1} / ${st.requests.length}</div>`;

  $('#dl-score').textContent=st.score;
  $('#dl-streak').textContent=st.streak;
}

function answerDeadlock(grant){
  if(!dlState||dlState.locked)return;
  dlState.locked=true;
  const cur=dlState.requests[dlState.idx];
  const chk=bankersRequestLocal(dlState.alloc,dlGame.max,dlState.avail,cur.pid,cur.req);
  const correct = !!chk.grant===!!grant;

  dlState.answers.push({ pid:cur.pid, req:cur.req, grant });
  if(correct){ dlState.score+=90; dlState.streak++; dlState.bestStreak=Math.max(dlState.bestStreak,dlState.streak); AudioFX.win(); }
  else { dlState.streak=0; AudioFX.lose(); shake('soft'); }

  // apply if actually granted
  if(chk.grant && grant){
    for(let j=0;j<dlState.avail.length;j++){
      dlState.alloc[cur.pid][j]+=cur.req[j];
      dlState.avail[j]-=cur.req[j];
    }
  }

  const fb=$('#dl-feedback');
  fb.hidden=false;
  fb.className='predict-result '+(correct?'good':'bad');
  const reasonTxt = chk.reason==='exceeds-need' ? `DENY: the request is above P${cur.pid}'s remaining Need. A process cannot receive more than its declared maximum.`
    : chk.reason==='not-available' ? 'DENY: the system does not currently have enough Available resources.'
    : chk.reason==='safe' ? `GRANT: the simulated state is SAFE. Safe completion order: ${chk.seq.map(pid=>`P${pid}`).join(' → ')}.`
    : `DENY: after this simulated grant, no safe order lets every process finish. The state would be unsafe.`;
  fb.innerHTML=`<strong>${correct?'✓ Correct':'✗ Not quite'} · ${chk.grant?'GRANT':'DENY'}</strong><span>${reasonTxt}</span>`;

  logDl(cur, chk, correct);

  setTimeout(()=>{
    dlState.locked=false;
    dlState.idx++;
    if(dlState.idx>=dlState.requests.length){ finishDeadlock(); return; }
    renderDeadlock();
  }, 1100);
}

function logDl(cur,check,correct){
  const log=$('#dl-log');
  if(!log)return;
  const el=document.createElement('div');
  el.className='log-entry '+(correct?'good':'bad');
  const outcome=check.grant ? `SAFE · order ${check.seq.map(pid=>`P${pid}`).join(' → ')}` : `DENY · ${check.reason==='exceeds-need'?'above Need':check.reason==='not-available'?'not Available':'unsafe state'}`;
  el.innerHTML=`<span class="step">P${cur.pid}</span>
    <span class="page">Request ${cur.req.map((v,j)=>`R${j}:${v}`).join(' · ')}</span>
    <span class="${check.grant?'good':'bad'}">${outcome}</span>`;
  log.appendChild(el);
  log.scrollTop=log.scrollHeight;
}

async function finishDeadlock(){
  clearInterval(dlInterval);
  if(!dlGame||!dlState)return;
  $('#deadlock-game').hidden=true;
  const elapsed=Math.round((Date.now()-dlState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionId:dlGame.id,actions:dlState.answers,elapsed})});
  const r=await res.json();
  const perfect=r.correct===r.total;
  addXP(r.score); refreshXpUI();
  if(typeof recordMission==='function') recordMission({mode:'deadlock',algo:dlGame.algorithm,perfect,bestStreak:dlState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun});
  if(typeof checkAchievements==='function') checkAchievements({completedDelta:1,perfect,bestStreak:dlState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun,modesWon:{scheduler:false,memory:false},algoWins:[dlGame.algorithm]});
  if(perfect){AudioFX.win();confetti(60);}else{AudioFX.win();}
  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ DEADLOCK BREAKER':r.correct>=r.total/2?'SHIFT SURVIVED':'SYSTEM DEADLOCKED'}</h2>
    <p><b>${(dlAlgoInfo[dlGame.algorithm]||dlAlgoInfo.avoidance).short}</b> · ${r.correct}/${r.total} correct calls</p>
    <div class="result-stats">
      <div class="rs"><b>${r.correct}/${r.total}</b><span>CORRECT</span></div>
      <div class="rs"><b>×${dlState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}

// ==================== VIRTUAL MEMORY / DEMAND PAGING GAME ====================
let vmGame, vmState, vmInterval;
const VM_CHOICES = [
  { key:'hit',  label:'HIT',  desc:'Page is loaded and access is allowed.', cls:'hit' },
  { key:'pure', label:'PURE FAULT', desc:'Page is not loaded; bring it into memory.', cls:'miss' },
  { key:'cow',  label:'COW FAULT',  desc:'Write to a shared page; copy it first.', cls:'miss' },
  { key:'prot', label:'PROTECTION FAULT', desc:'Page is outside this process’s allowed range.', cls:'miss' }
];

function startVM(player){
  hintsUsedThisRun=0;
  const {mode,...playerInfo}=player;
  const algorithm=$('#vm-algo-select').value;
  fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})})
    .then(r=>r.json())
    .then(g=>{
      vmGame=g;
      vmState={ idx:0, score:0, faults:0, streak:0, bestStreak:0, answers:[],
                started:Date.now(), locked:false };
      const info=vmAlgoInfo[g.algorithm]||vmAlgoInfo.fifo;
      $('#vm-mission-label').textContent=`VM SHIFT ${g.level} · ${info.short}`;
      $('#welcome').hidden=true; syncLeaderboardVisibility();
      $('#vm-game').hidden=false;
      clearFeedback('vm-feedback');
      renderVM();
      clearInterval(vmInterval);
      vmInterval=setInterval(()=>$('#vm-timer').textContent=fmt((Date.now()-vmState.started)/1000),1000);
    })
    .catch(e=>{ console.error(e); alert('Could not start virtual memory mission.'); });
}

// Local demand paging (mirrors algos.js demandPagingSim)
function demandPagingLocal(g){
  const pages=16, frames=g.frames, refs=g.refs, access=g.access, shared=[...(g.shared||[])];
  const valid=new Array(pages).fill(false);
  const resident=[]; const fifo=[]; const steps=[];
  refs.forEach((p,idx)=>{
    const isWrite=access[idx]==='W';
    const legal=p>=0 && p<g.maxPage;
    let hit=null,fault=null;
    if(!legal){ hit=false; fault='PROT'; }
    else if(valid[p]){
      if(isWrite && shared.includes(p)){ hit=false; fault='COW'; shared.splice(shared.indexOf(p),1); }
      else { hit=true; fault=null; }
    } else {
      hit=false; fault='PURE';
      if(resident.length<frames){ resident.push(p); fifo.push(p); valid[p]=true; }
      else { const v=fifo.shift(); valid[v]=false; resident[resident.indexOf(v)]=p; fifo.push(p); valid[p]=true; }
    }
    steps.push({ page:p, access:access[idx], hit, fault, frames:[...resident] });
  });
  return steps;
}

function renderVM(){
  const g=vmGame, st=vmState;
  if(!g||!st)return;
  if(!st.steps) st.steps=demandPagingLocal(g);
  const steps=st.steps;

  // frames
  const curFrames = st.idx>0 ? steps[st.idx-1].frames : [];
  $('#vm-frames').innerHTML=Array.from({length:g.frames},(_,i)=>{
    const p=curFrames[i];
    return p===undefined
      ? `<div class="frame empty"><span class="frame-name">FRAME ${i+1}</span><span class="page-num">—</span></div>`
      : `<div class="frame filled"><span class="frame-name">FRAME ${i+1}</span><span class="page-num">${p}</span></div>`;
  }).join('');

  // reference stream
  $('#vm-refs').innerHTML=g.refs.map((p,i)=>{
    let cls='ref-item';
    if(i===st.idx)cls+=' current';
    else if(i<st.idx)cls+=' done';
    return `<div class="${cls}" data-i="${i}">${p}<small>${g.access[i]}</small></div>`;
  }).join('');

  if(st.idx>=steps.length){ finishVM(); return; }
  const step=steps[st.idx];
  $('#vm-current').innerHTML=`<div class="vm-current-page">Page ${step.page}</div>
     <span class="vm-access">${step.access==='W'?'WRITE':'READ'}</span>
     <div class="req-progress">REFERENCE ${st.idx+1} OF ${steps.length}</div>`;

  $('#vm-choices').innerHTML=VM_CHOICES.map(c=>
    `<button class="pred-btn ${c.cls}" data-vm="${c.key}">
       <span class="btn-label">${c.label}</span><span class="btn-desc">${c.desc}</span></button>`).join('');

  $('#vm-score').textContent=st.score;
  $('#vm-faults').textContent=steps.slice(0,st.idx).filter(x=>!x.hit).length;
}

function answerVM(key){
  if(!vmState||vmState.locked)return;
  vmState.locked=true;
  const step=vmState.steps[vmState.idx];
  const predHit = key==='hit';
  const predFault = key==='hit' ? null : key.toUpperCase();
  const correct = predHit===step.hit && (predFault||null)===(step.fault||null);

  vmState.answers.push({ hit:predHit, fault:predFault });
  if(correct){ vmState.score+=55; vmState.streak++; vmState.bestStreak=Math.max(vmState.bestStreak,vmState.streak); AudioFX.win(); }
  else { vmState.streak=0; AudioFX.lose(); shake('soft'); }
  if(!step.hit) vmState.faults++;

  const fb=$('#vm-feedback');
  fb.hidden=false;
  fb.className='predict-result '+(correct?'good':'bad');
  const actual = step.hit ? 'HIT — this page is already loaded and the access is allowed.'
    : step.fault==='PURE' ? 'PURE fault — this page was not in memory, so it must be loaded.'
    : step.fault==='COW' ? 'COW (copy-on-write) fault — this shared page was written, so the OS must make a private copy first.'
    : 'PROTECTION fault — this page is outside the process’s allowed range.';
  fb.innerHTML=`<strong>${correct?'✓ Correct':'✗ Not quite'}</strong><span>${actual}</span>`;

  logVM(step,correct);

  setTimeout(()=>{
    vmState.locked=false;
    vmState.idx++;
    if(vmState.idx>=vmState.steps.length){ finishVM(); return; }
    renderVM();
  },1000);
}

function logVM(step,correct){
  const log=$('#vm-log');
  if(!log)return;
  const el=document.createElement('div');
  el.className='log-entry '+(correct?'good':'bad');
  const result=step.hit?'HIT':step.fault==='COW'?'COW · copy shared page':step.fault==='PROT'?'PROTECTION · illegal page':'PURE · load page';
  el.innerHTML=`<span class="step">Page ${step.page}</span>
    <span class="page">${step.access==='W'?'WRITE':'READ'}</span>
    <span class="${step.hit?'good':'bad'}">${result}</span>`;
  log.appendChild(el); log.scrollTop=log.scrollHeight;
}

async function finishVM(){
  clearInterval(vmInterval);
  if(!vmGame||!vmState)return;
  $('#vm-game').hidden=true;
  const elapsed=Math.round((Date.now()-vmState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionId:vmGame.id,actions:vmState.answers,elapsed})});
  const r=await res.json();
  const perfect=r.correct===r.total;
  addXP(r.score); refreshXpUI();
  if(typeof recordMission==='function') recordMission({mode:'vm',algo:vmGame.algorithm,perfect,bestStreak:vmState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun});
  if(typeof checkAchievements==='function') checkAchievements({completedDelta:1,perfect,bestStreak:vmState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun,modesWon:{scheduler:false,memory:false},algoWins:[vmGame.algorithm]});
  if(perfect){AudioFX.win();confetti(60);}else{AudioFX.win();}
  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ VM VIRTUOSO':r.correct>=r.total/2?'SHIFT SURVIVED':'THRASHING'}</h2>
    <p><b>${(vmAlgoInfo[vmGame.algorithm]||vmAlgoInfo.fifo).short}</b> · ${r.correct}/${r.total} correct reads</p>
    <div class="result-stats">
      <div class="rs"><b>${r.faults}</b><span>PAGE FAULTS</span></div>
      <div class="rs"><b>×${vmState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}

// ==================== FILE SYSTEM ALLOCATION GAME ====================
let fsGame, fsState, fsInterval;

function startFS(player){
  hintsUsedThisRun=0;
  const {mode,...playerInfo}=player;
  const algorithm=$('#fs-algo-select').value;
  fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})})
    .then(r=>r.json())
    .then(g=>{
      fsGame=g;
      fsState={ idx:0, score:0, streak:0, bestStreak:0, answers:[],
                selected:[], disk:[...g.disk], started:Date.now(), locked:false };
      const info=fsAlgoInfo[g.algorithm]||fsAlgoInfo.contiguous;
      $('#fs-mission-label').textContent=`FILE SHIFT ${g.level} · ${info.short}`;
      $('#fs-notice').textContent=info.desc;
      $('#welcome').hidden=true; syncLeaderboardVisibility();
      $('#fs-game').hidden=false;
      clearFeedback('fs-feedback');
      renderFS();
      clearInterval(fsInterval);
      fsInterval=setInterval(()=>$('#fs-timer').textContent=fmt((Date.now()-fsState.started)/1000),1000);
    })
    .catch(e=>{ console.error(e); alert('Could not start file system mission.'); });
}

function renderFS(){
  const g=fsGame, st=fsState;
  if(!g||!st)return;

  $('#fs-disk').innerHTML=st.disk.map((free,i)=>{
    const sel=st.selected.includes(i);
    const isIndex=sel&&g.algorithm==='indexed'&&i===st.selected[0];
    const cls = !free ? 'used' : sel ? `sel${isIndex?' index-block':''}` : 'free';
    const label=!free?'in use':isIndex?'selected as index block':sel?'selected':'free';
    return `<div class="fs-block ${cls}" data-b="${i}" aria-label="Block ${i+1}, ${label}">${i+1}${isIndex?'<small>INDEX</small>':''}</div>`;
  }).join('');

  $('#fs-files').innerHTML=g.files.map((f,i)=>{
    const done=i<st.idx, cur=i===st.idx;
    const cls=done?'done':cur?'cur':'';
    const sizeInfo=g.algorithm==='indexed'
      ? `${f.size} data + 1 index = ${f.size+1} total blocks`
      : `${f.size} blocks total`;
    return `<div class="fs-file ${cls}"><strong>${done?'✓ ':''}File ${f.id}${cur?' · CURRENT':''}</strong><span>${sizeInfo}</span></div>`;
  }).join('');

  const selected=st.selected.map(b=>b+1);
  const selectedLabel=$('#fs-selected-label');
  if(g.algorithm==='indexed'){
    selectedLabel.textContent='Index block · data blocks';
    $('#fs-selected').textContent=selected.length?`Index: ${selected[0]} · Data: ${selected.slice(1).join(', ')||'—'}`:'None';
  } else {
    selectedLabel.textContent=g.algorithm==='linked'?'Chain in block order':'Selected run (must be adjacent)';
    $('#fs-selected').textContent=selected.length?`${selected.length} block${selected.length===1?'':'s'}: ${selected.join(', ')}`:'None';
  }
  $('#fs-free-count').textContent=`${st.disk.filter(Boolean).length} of ${g.diskSize} blocks free`;
  $('#fs-score').textContent=st.score;
  $('#fs-progress').textContent=`${st.idx+1}/${g.files.length}`;
  // An earlier choice can fragment the disk until the current file has nowhere
  // legal to go. Offer a skip so the run can always finish instead of dead-ending.
  const room=fsHasPlacement();
  const skipBtn=$('#fs-skip'); if(skipBtn) skipBtn.hidden=room;
  if(st.idx>=g.files.length){ finishFS(); return; }
}

// Is there at least one legal placement for the current file on the live disk?
function fsHasPlacement(){
  const g=fsGame, st=fsState;
  if(!g||!st) return true;
  const file=g.files[st.idx]; if(!file) return true;
  const need=g.algorithm==='indexed'?file.size+1:file.size;
  if(g.algorithm==='contiguous'){
    let run=0;
    for(let i=0;i<st.disk.length;i++){ run = st.disk[i] ? run+1 : 0; if(run>=need) return true; }
    return false;
  }
  return st.disk.filter(Boolean).length>=need;
}

function pickFsBlock(i){
  const st=fsState; if(!st||st.locked)return;
  if(!st.disk[i]){
    // Block already allocated — say so rather than silently swallowing the click.
    const fb=$('#fs-feedback');
    if(fb){ fb.hidden=false; fb.className='predict-result bad'; fb.innerHTML=`Block ${i+1} is already in use — pick a free block.`; }
    AudioFX.lose(); shake('soft');
    return;
  }
  const pos=st.selected.indexOf(i);
  if(pos>=0) st.selected.splice(pos,1);
  else st.selected.push(i);
  st.selected.sort((a,b)=>a-b);
  AudioFX.select();
  renderFS();
}

function confirmFs(){
  const g=fsGame, st=fsState;
  if(!g||!st||st.locked)return;
  const file=g.files[st.idx];
  if(!file)return;

  // Grading rule: ANY placement that obeys the strategy's stated rule counts as
  // correct — contiguous = one unbroken run of `size` free blocks, linked =
  // `size` free blocks anywhere, indexed = 1 index + `size` data blocks. Checked
  // against the disk as it stands BEFORE this selection consumes its blocks.
  if(!st.selected.length){
    AudioFX.lose(); const fb=$('#fs-feedback');
    fb.hidden=false; fb.className='predict-result bad';
    fb.innerHTML='✗ Select some free blocks first.'; return;
  }
  const correct = fsPlacementOk(st.disk, st.selected, file, g.algorithm);
  if(!correct){
    const need=g.algorithm==='indexed'?file.size+1:file.size;
    let why;
    if(st.selected.length!==need) why=`File ${file.id} needs exactly ${need} block${need===1?'':'s'} — you picked ${st.selected.length}.`;
    else if(g.algorithm==='contiguous') why='Contiguous allocation needs one unbroken run of adjacent free blocks.';
    else why='Those blocks are not all free.';
    AudioFX.lose(); const fb=$('#fs-feedback');
    fb.hidden=false; fb.className='predict-result bad'; fb.innerHTML='✗ '+why;
    return;
  }

  st.locked=true;
  st.answers.push([...st.selected]);
  st.selected.forEach(b=>{ st.disk[b]=false; });
  st.score+=80; st.streak++; st.bestStreak=Math.max(st.bestStreak,st.streak); AudioFX.win();

  const fb=$('#fs-feedback');
  fb.hidden=false; fb.className='predict-result good';
  fb.innerHTML=`✓ Correct — ${g.algorithm==='indexed'?`index block ${st.answers[st.idx][0]+1}, data blocks ${st.answers[st.idx].slice(1).map(b=>b+1).join(', ')}`:`blocks ${st.answers[st.idx].map(b=>b+1).join(', ')}`}.`;

  logFS(file, st.answers[st.idx], correct);

  setTimeout(()=>{
    st.locked=false; st.selected=[]; st.idx++;
    if(st.idx>=g.files.length){ finishFS(); return; }
    renderFS();
  },1000);
}

function fileAllocLocal(disk, files, strategy){
  const free=disk.map((f,i)=>({i,f})).filter(o=>o.f).map(o=>o.i);
  const freeSet=new Set(free); const steps=[];
  for(const file of files){
    let chosen=null;
    if(strategy==='contiguous'){
      let runStart=-1;
      for(let st2=0; st2+file.size<=disk.length; st2++){
        let ok=true;
        for(let k=0;k<file.size;k++) if(!freeSet.has(st2+k)){ok=false;break;}
        if(ok){runStart=st2;break;}
      }
      chosen = runStart>=0 ? Array.from({length:file.size},(_,k)=>runStart+k) : null;
    } else if(strategy==='linked'){
      chosen = free.length>=file.size ? free.slice(0,file.size) : null;
    } else {
      chosen = free.length>=file.size+1 ? free.slice(0,file.size+1) : null;
    }
    if(chosen) chosen.forEach(b=>{ freeSet.delete(b); free.splice(free.indexOf(b),1); });
    steps.push({ fileId:file.id, size:file.size, blocks:chosen });
  }
  return steps;
}

function logFS(file, blocks, correct){
  const log=$('#fs-log'); if(!log)return;
  const el=document.createElement('div');
  el.className='log-entry '+(correct?'good':'bad');
  const placement=!blocks||!blocks.length
    ? 'no placement — skipped'
    : fsGame.algorithm==='indexed'
      ? `Index ${blocks[0]+1} · Data ${blocks.slice(1).map(b=>b+1).join(', ')}`
      : `Disk blocks ${blocks.map(b=>b+1).join(', ')}`;
  el.innerHTML=`<span class="step">File ${file.id}</span>
    <span class="page">${file.size} data block${file.size===1?'':'s'}</span>
    <span class="${correct?'good':'bad'}">${placement}</span>`;
  log.appendChild(el); log.scrollTop=log.scrollHeight;
}

async function finishFS(){
  clearInterval(fsInterval);
  if(!fsGame||!fsState)return;
  $('#fs-game').hidden=true;
  const elapsed=Math.round((Date.now()-fsState.started)/1000);
  const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionId:fsGame.id,actions:fsState.answers,elapsed})});
  const r=await res.json();
  const perfect=r.correct===r.total;
  addXP(r.score); refreshXpUI();
  if(typeof recordMission==='function') recordMission({mode:'fs',algo:fsGame.algorithm,perfect,bestStreak:fsState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun});
  if(typeof checkAchievements==='function') checkAchievements({completedDelta:1,perfect,bestStreak:fsState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun,modesWon:{scheduler:false,memory:false},algoWins:[fsGame.algorithm]});
  if(perfect){AudioFX.win();confetti(60);}else{AudioFX.win();}
  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ DISK ARCHITECT':r.correct>=r.total/2?'SHIFT SURVIVED':'FRAGMENTED'}</h2>
    <p><b>${(fsAlgoInfo[fsGame.algorithm]||fsAlgoInfo.contiguous).short}</b> · ${r.correct}/${r.total} files placed optimally</p>
    <div class="result-stats">
      <div class="rs"><b>${r.correct}/${r.total}</b><span>OPTIMAL</span></div>
      <div class="rs"><b>×${fsState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <strong>${r.score}</strong>
    <p>FINAL PERFORMANCE SCORE</p>
`;
}

// ==================== ACHIEVEMENT SHELF RENDER ====================

function renderAchShelf(){
  const unlocked=unlockedSet();
  const grid=$('#ach-grid');
  if(!grid)return;
  grid.innerHTML=ACH.map(a=>`
    <div class="ach-card ${unlocked.has(a.id)?'unlocked':''}" title="${a.desc}">
      <div class="ico">${a.icon}</div>
      <div class="nm">${a.name}</div>
      <div class="ds">${a.desc}</div>
    </div>`).join('');
}

// ==================== WIRING ====================
// Restore saved player — no repeated login
try{
  const saved=JSON.parse(localStorage.getItem('player')||'null');
  if(saved&&saved.name){
    currentPlayer=saved;
    $('input[name="name"]').value=saved.name;
    $('input[name="usn"]').value=saved.usn;
  }
}catch(e){}

$('#player-form').onsubmit=e=>{
  e.preventDefault();AudioFX.click();
  const data=Object.fromEntries(new FormData(e.target));
  currentPlayer={name:data.name,usn:data.usn};
  localStorage.setItem('player',JSON.stringify(currentPlayer));
  start(data);
};

// ==================== SYNCHRONIZATION LAB ====================
let syncGame, syncState, syncInterval;
const syncAlgoInfo = {
  critical:  { name:'The Critical-Section Problem', short:'CRITICAL SECTION', desc:'Call whether each event in an interleaving keeps mutual exclusion.' },
  peterson:  { name:"Peterson's Solution", short:"PETERSON'S SOLUTION", desc:'Predict whether a process gets past its while-loop into the critical section.' },
  hardware:  { name:'Hardware Support for Synchronization (TSL / Swap)', short:'HARDWARE TSL', desc:'Predict what the atomic test-and-set does to the lock.' },
  mutex:     { name:'Mutex Locks', short:'MUTEX LOCKS', desc:'Acquire and release a mutex, and spot the illegal calls.' },
  semaphore: { name:'Semaphores', short:'SEMAPHORES', desc:'Track the semaphore value across P and V operations.' }
};

// The questions come from algos.js (loaded before this file), so the browser and
// the server always agree on what the right answer is.
function syncSteps(){
  if(!syncGame) return [];
  return syncSim(syncGame.algorithm, syncGame.puzzle).steps;
}

async function startSync(player){
  const {mode,...playerInfo}=player;
  const algorithm=$('#sync-algo-select').value;
  try{
    const res=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({player:playerInfo,algorithm,level:1,mode})});
    const g=await res.json();
    syncGame=g;
    syncState={ idx:0, score:0, streak:0, bestStreak:0, answers:[], started:Date.now(), locked:false };
    const info=syncAlgoInfo[g.algorithm]||syncAlgoInfo.critical;
    $('#sync-mission-label').textContent=`SYNC LAB · ${info.short}`;
    $('#sync-notice').textContent=info.desc;
    $('#welcome').hidden=true; syncLeaderboardVisibility();
    $('#sync-game').hidden=false;
    clearFeedback('sync-feedback');
    renderSync();
    clearInterval(syncInterval);
    syncInterval=setInterval(()=>$('#sync-timer').textContent=fmt((Date.now()-syncState.started)/1000),1000);
  }catch(e){ console.error(e); alert('Could not start the synchronization mission.'); }
}

// A small picture of the machine for each topic. The point of this mode is
// understanding, so every question shows the state visually as well as in words.
function syncViz(step, algorithm){
  const st=step.state||[];
  const get=k=>{const f=st.find(s=>s.k===k); return f?String(f.v):'';};
  if(algorithm==='critical'){
    const inside=get('Critical section');
    const who=inside==='empty'?[]:inside.replace(/\s*inside$/,'').split(',').map(s=>s.trim()).filter(Boolean);
    const outside=['P0','P1'].filter(p=>who.indexOf(p)<0);
    const chip=(p,inCS)=>`<span class="proc${inCS?' in':''}${p==='P1'?' alt':''}">${p}</span>`;
    return `<div class="viz">
      <div class="viz-row"><span class="viz-lbl">OUTSIDE</span><div class="viz-slots">${outside.map(p=>chip(p,false)).join('')||'<span class="viz-none">—</span>'}</div></div>
      <div class="viz-box"><span class="viz-lbl">CRITICAL SECTION</span><div class="viz-slots">${who.map(p=>chip(p,true)).join('')||'<span class="viz-none">empty</span>'}</div></div>
    </div>`;
  }
  if(algorithm==='peterson'){
    const f=[get('flag[0]')==='true', get('flag[1]')==='true'];
    const turn=get('turn');
    const card=p=>{
      const other=1-p;
      const spin=f[other]&&turn===String(other);
      return `<div class="viz-card${spin?' blocked':''}">
        <b>P${p}</b>
        <span>flag[${p}] = <em>${f[p]}</em></span>
        <span>turn = <em>${turn}</em></span>
        <span class="tag">${spin?'SPINNING':(f[p]?'READY TO CHECK':'NOT TRYING YET')}</span>
      </div>`;
    };
    return `<div class="viz viz-cards">${card(0)}${card(1)}</div>`;
  }
  if(algorithm==='hardware'||algorithm==='mutex'){
    const free=algorithm==='hardware' ? get('Held by')==='nobody' : get('Mutex')==='free';
    const holder=algorithm==='hardware' ? get('Held by') : get('Mutex').replace('held by ','');
    return `<div class="viz viz-lock">
      <div class="lock-badge${free?'':' shut'}"><b>${free?'FREE':'LOCKED'}</b><span>${free?'nobody holds it':'held by '+holder}</span></div>
      <div class="viz-note">${algorithm==='hardware'?'one atomic lock word in memory':'mutex object'}</div>
    </div>`;
  }
  if(algorithm==='semaphore'){
    const s=Number(get('Semaphore S'))||0, blocked=Number(get('Blocked'))||0;
    return `<div class="viz viz-sem">
      <div class="sem-count"><b>${s}</b><span>units in S</span></div>
      <div class="sem-queue"><span class="viz-lbl">BLOCKED QUEUE</span><div class="viz-slots">${Array.from({length:blocked},()=>'<span class="proc alt">waiting</span>').join('')||'<span class="viz-none">empty</span>'}</div></div>
    </div>`;
  }
  return '';
}

function renderSync(){
  const g=syncGame, st=syncState;
  if(!g||!st)return;
  const steps=syncSteps(); const step=steps[st.idx];
  if(!step){ finishSync(); return; }

  $('#sync-state').innerHTML=(step.state||[]).map(s=>
    `<div class="st"><span>${s.k}</span><b>${s.v}</b></div>`).join('');
  $('#sync-viz').innerHTML=syncViz(step, g.algorithm);
  const tr=step.trace||[];
  $('#sync-trace').innerHTML=tr.length
    ? tr.map((t,i)=>`<span class="${i===tr.length-1?'now':''}">${t}</span>`).join('')
    : '<span>Nothing has run yet — this is the very first event.</span>';
  $('#sync-question').innerHTML=step.prompt;
  $('#sync-choices').innerHTML=step.options.map(o=>
    `<button class="pred-btn" data-sync="${o.key}"><span class="btn-label">${o.label}</span>${o.desc?`<span class="btn-desc">${o.desc}</span>`:''}</button>`).join('');
  $('#sync-score').textContent=st.score;
  $('#sync-progress').textContent=`${st.idx+1}/${steps.length}`;
}

function answerSync(key){
  const g=syncGame, st=syncState;
  if(!g||!st||st.locked)return;
  const steps=syncSteps(); const step=steps[st.idx];
  if(!step)return;
  const correct=key===step.answerKey;
  const chosen=((step.options.find(o=>o.key===key)||{}).label)||key;
  st.locked=true;
  st.answers.push(key);
  if(correct){ st.score+=70; st.streak++; st.bestStreak=Math.max(st.bestStreak,st.streak); AudioFX.win(); }
  else { st.streak=0; AudioFX.lose(); shake('soft'); }

  const fb=$('#sync-feedback');
  fb.hidden=false; fb.className='predict-result '+(correct?'good':'bad');
  fb.innerHTML=correct
    ? `<strong>✓ Correct</strong><span>${step.explain}</span>`
    : `<strong>✗ Not quite — you called ${chosen}.</strong><span>${step.explain}</span>`;

  logSync(st.idx, chosen, correct, step);
  setTimeout(()=>{
    st.locked=false; st.idx++;
    if(st.idx>=steps.length){ finishSync(); return; }
    renderSync();
  },1100);
}

function logSync(index, chosen, correct, step){
  const log=$('#sync-log'); if(!log)return;
  const el=document.createElement('div');
  el.className='log-entry '+(correct?'good':'bad');
  el.innerHTML=`<span class="step">STEP ${index+1}</span>
    <span class="${correct?'good':'bad'}">${correct?'✓':'✗'} ${chosen} — ${step.explain}</span>`;
  log.appendChild(el); log.scrollTop=log.scrollHeight;
}

async function finishSync(){
  clearInterval(syncInterval);
  if(!syncGame||!syncState)return;
  $('#sync-game').hidden=true;
  const elapsed=Math.round((Date.now()-syncState.started)/1000);
  let r;
  try{
    const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sessionId:syncGame.id,actions:syncState.answers,elapsed})});
    r=await res.json();
  }catch(e){ console.error(e); alert('Could not submit the synchronization run.'); return; }
  const perfect=r.correct===r.total;
  addXP(r.score); refreshXpUI();
  if(typeof recordMission==='function') recordMission({mode:'sync',algo:syncGame.algorithm,perfect,bestStreak:syncState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun});
  if(typeof checkAchievements==='function') checkAchievements({completedDelta:1,perfect,bestStreak:syncState.bestStreak,elapsed,hintsUsed:hintsUsedThisRun,modesWon:{scheduler:false,memory:false},algoWins:[syncGame.algorithm]});
  if(perfect){AudioFX.win();confetti(60);}else{AudioFX.win();}
  $('#result').hidden=false; syncLeaderboardVisibility();
  $('#result').innerHTML=`
    <h2>${perfect?'⭐ CONCURRENCY MASTER':r.correct>=r.total/2?'SYNCHRONIZED':'RACE CONDITION'}</h2>
    <p><b>${(syncAlgoInfo[syncGame.algorithm]||syncAlgoInfo.critical).short}</b> · ${r.correct}/${r.total} calls right</p>
    <div class="result-stats">
      <div class="rs"><b>${r.correct}/${r.total}</b><span>CORRECT</span></div>
      <div class="rs"><b>×${syncState.bestStreak}</b><span>BEST STREAK</span></div>
      <div class="rs"><b>+${r.score}</b><span>XP EARNED</span></div>
    </div>
    <button id="sync-again">BACK TO MISSIONS</button>`;
  const again=$('#sync-again');
  if(again) again.onclick=()=>{ AudioFX.click(); goHome(); };
}

// ==================== HELP PAGE ====================
function buildHelpToc(){
  const toc=$('#help-toc'); if(!toc||toc.dataset.built)return;
  const secs=[...document.querySelectorAll('#help-overlay .help-sec')];
  toc.innerHTML=secs.map((s,i)=>{
    s.id='help-sec-'+i;
    const title=(s.querySelector('summary').textContent||'').trim().replace(/^\d+\s*·\s*/,'');
    return `<a href="#help-sec-${i}">${title}</a>`;
  }).join('');
  toc.dataset.built='1';
  toc.onclick=e=>{
    const a=e.target.closest('a'); if(!a)return;
    e.preventDefault();
    const sec=document.getElementById(a.getAttribute('href').slice(1));
    if(sec){ sec.open=true; sec.scrollIntoView({block:'start',behavior:'smooth'}); }
  };
}
function showHelp(){
  buildHelpToc();
  const ov=$('#help-overlay'); if(!ov)return;
  ov.hidden=false; ov.scrollTop=0;
  AudioFX.click();
}
function closeHelp(){
  const ov=$('#help-overlay'); if(!ov)return;
  ov.hidden=true; AudioFX.click();
}

// ==================== NEW MODE WIRING ====================
$('#dl-grant').onclick=()=>answerDeadlock(true);
$('#dl-deny').onclick=()=>answerDeadlock(false);
$('#dl-hint').onclick=()=>{
  if(!dlState)return;
  hintsUsedThisRun++; AudioFX.select();
  const cur=dlState.requests[dlState.idx];
  if(!cur)return;
  const chk=bankersRequestLocal(dlState.alloc,dlGame.max,dlState.avail,cur.pid,cur.req);
  const fb=$('#dl-feedback'); fb.hidden=false; fb.className='predict-result';
  const why=chk.reason==='exceeds-need' ? `P${cur.pid} asks for more than its remaining Need.`
    : chk.reason==='not-available' ? 'The requested amount is not all Available right now.'
    : chk.reason==='safe' ? `The simulated state is safe; possible finish order: ${chk.seq.map(pid=>`P${pid}`).join(' → ')}.`
    : 'Granting this would leave at least one process unable to finish (unsafe state).';
  fb.innerHTML=`<strong>Hint: ${chk.grant?'GRANT':'DENY'} · −40 pts</strong><span>${why}</span>`;
};

$('#vm-choices').onclick=e=>{
  const b=e.target.closest('[data-vm]'); if(!b)return;
  answerVM(b.dataset.vm);
};
$('#vm-hint').onclick=()=>{
  if(!vmState||!vmState.steps)return;
  hintsUsedThisRun++; AudioFX.select();
  const step=vmState.steps[vmState.idx];
  if(!step)return;
  const fb=$('#vm-feedback'); fb.hidden=false; fb.className='predict-result';
  const why=step.hit?'The page is already in a frame and this access is allowed.'
    :step.fault==='PURE'?'The page is not in memory yet, so it must be loaded.'
    :step.fault==='COW'?'This is a write to a shared page; the OS must copy it before writing.'
    :'This page is outside the process’s allowed range.';
  fb.innerHTML=`<strong>Hint: ${step.hit?'HIT':`${step.fault} FAULT`} · −40 pts</strong><span>${why}</span>`;
};

$('#fs-disk').onclick=e=>{
  const b=e.target.closest('[data-b]'); if(!b)return;
  pickFsBlock(Number(b.dataset.b));
};
$('#fs-confirm').onclick=()=>confirmFs();
$('#fs-clear').onclick=()=>{ if(!fsState)return; fsState.selected=[]; AudioFX.select(); renderFS(); };
$('#fs-skip').onclick=()=>{
  if(!fsGame||!fsState||fsState.locked)return;
  const file=fsGame.files[fsState.idx]; if(!file)return;
  AudioFX.lose(); shake('soft');
  fsState.locked=true;
  fsState.answers.push(null);          // skipped → graded as an incorrect placement
  logFS(file, [], false);
  const fb=$('#fs-feedback'); fb.hidden=false; fb.className='predict-result bad';
  fb.innerHTML=`✗ No legal placement left for File ${file.id} — skipped.`;
  setTimeout(()=>{
    fsState.locked=false; fsState.selected=[]; fsState.idx++;
    if(fsState.idx>=fsGame.files.length){ finishFS(); return; }
    renderFS();
  },1000);
};
$('#fs-hint').onclick=()=>{
  if(!fsGame||!fsState)return;
  hintsUsedThisRun++; AudioFX.select();
  const file=fsGame.files[fsState.idx];
  if(!file)return;
  // First-fit over the LIVE disk, for this file alone, is always a legal
  // placement — so the hint can never point at an already-used block.
  const suggestion=fileAllocLocal([...fsState.disk],[file],fsGame.algorithm)[0];
  const blocks=suggestion && suggestion.blocks ? suggestion.blocks : null;
  const fb=$('#fs-feedback'); fb.hidden=false; fb.className='predict-result';
  fb.innerHTML=blocks&&blocks.length
    ? `💡 Hint: ${fsGame.algorithm==='indexed'?`index block ${blocks[0]+1}, data blocks ${blocks.slice(1).map(b=>b+1).join(', ')}`:`try disk blocks ${blocks.map(b=>b+1).join(', ')}`}. (-40 pts)`
    : '💡 Hint: no legal placement left for this file. (-40 pts)';
};

// ---- Sync lab + help wiring ----
$('#sync-choices').onclick=e=>{
  const b=e.target.closest('[data-sync]'); if(!b)return;
  answerSync(b.dataset.sync);
};
$('#sync-hint').onclick=()=>{
  if(!syncGame||!syncState)return;
  const steps=syncSteps(); const step=steps[syncState.idx]; if(!step)return;
  hintsUsedThisRun++; AudioFX.select();
  syncState.score=Math.max(0,syncState.score-40);
  $('#sync-score').textContent=syncState.score;
  const right=((step.options.find(o=>o.key===step.answerKey)||{}).label)||step.answerKey;
  const fb=$('#sync-feedback'); fb.hidden=false; fb.className='predict-result';
  fb.innerHTML=`💡 Hint: ${right}. (-40 pts)`;
};
$('#help-btn').onclick=showHelp;
$('#help-fab').onclick=showHelp;
$('#help-close').onclick=closeHelp;
$('#help-overlay').onclick=e=>{ if(e.target.id==='help-overlay') closeHelp(); };

$('#home-btn').onclick=e=>{e.preventDefault();AudioFX.click();goHome();};
$('#mode-select').onchange=e=>{
  const v=e.target.value;
  // No mode selected yet → hide all algo dropdowns
  if(!v){
    ['algo-select-container','memory-algo-container','disk-algo-container','alloc-algo-container','deadlock-algo-container','vm-algo-container','fs-algo-container','sync-algo-container'].forEach(id=>$('#'+id).hidden=true);
    $('#algo-desc').textContent='Select a game mode to choose your algorithm.';
    return;
  }
  $('#algo-select-container').hidden = v!=='scheduler';
  $('#memory-algo-container').hidden = v!=='memory';
  $('#disk-algo-container').hidden = v!=='disk';
  $('#alloc-algo-container').hidden = v!=='alloc';
  $('#deadlock-algo-container').hidden = v!=='deadlock';
  $('#vm-algo-container').hidden = v!=='vm';
  $('#fs-algo-container').hidden = v!=='fs';
  $('#sync-algo-container').hidden = v!=='sync';
  const map={scheduler:()=>algoInfo[$('#algo-select').value],memory:()=>memAlgoInfo[$('#memory-algo-select').value],disk:()=>diskAlgoInfo[$('#disk-algo-select').value],alloc:()=>allocAlgoInfo[$('#alloc-algo-select').value],
  deadlock:()=>dlAlgoInfo[$('#deadlock-algo-select').value]||dlAlgoInfo.avoidance,
  vm:()=>vmAlgoInfo[$('#vm-algo-select').value]||vmAlgoInfo.fifo,
  fs:()=>fsAlgoInfo[$('#fs-algo-select').value]||fsAlgoInfo.contiguous,
  sync:()=>syncAlgoInfo[$('#sync-algo-select').value]||syncAlgoInfo.critical};
  const info=map[v]();
  $('#algo-desc').textContent=`${info.name}: ${info.desc}`;
};
$('#algo-select').onchange=e=>{const i=algoInfo[e.target.value];$('#algo-desc').textContent=`${i.name}: ${i.desc}`;};
$('#memory-algo-select').onchange=e=>{const i=memAlgoInfo[e.target.value];$('#algo-desc').textContent=`${i.name}: ${i.desc}`;};
$('#disk-algo-select').onchange=e=>{const i=diskAlgoInfo[e.target.value];$('#algo-desc').textContent=`${i.name}: ${i.desc}`;};
$('#alloc-algo-select').onchange=e=>{const i=allocAlgoInfo[e.target.value];$('#algo-desc').textContent=`${i.name}: ${i.desc}`;};
$('#sync-algo-select').onchange=e=>{const i=syncAlgoInfo[e.target.value]||syncAlgoInfo.critical;$('#algo-desc').textContent=`${i.name}: ${i.desc}`;};
$('#cpu').ondragover=e=>e.preventDefault();
$('#cpu').ondrop=e=>deploy(e.dataTransfer.getData('text'));
$('#cpu').onclick=()=>{if(selected){deploy(selected.id);}};

$('#hint').onclick=()=>{
  const p=expected();
  if(p){
    hintsUsedThisRun++;AudioFX.select();
    state.score=Math.max(0,state.score-75);
    selected=p;
    const info=algoInfo[game.algorithm];
    let hintMsg='';
    if(game.algorithm==='fcfs')hintMsg=`${p.id} arrived first.`;
    else if(game.algorithm==='sjf')hintMsg=`${p.id} has shortest burst (${p.burst}).`;
    else if(game.algorithm==='priority')hintMsg=`${p.id} has highest priority (${p.priority}).`;
    else hintMsg=`${p.id} is next in queue.`;
    render(`💡 Hint: ${hintMsg} <small>(−75)</small>`);
  }
};

document.querySelectorAll('.pred-btn.large').forEach(btn=>{
  btn.onclick=()=>{
    AudioFX.click();
    document.querySelectorAll('.pred-btn.large').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    if(btn.dataset.pred==='hit'){
      memPrediction={hit:true,victim:null};
      submitPrediction();
    }else{
      memPrediction={hit:false,victim:null};
      showStep2();
    }
  };
});

$('#memory-hint').onclick=()=>{
  if(!memState||!memState.expected)return;
  const stepData=memState.expected.steps[memState.currentStep];
  if(!stepData)return;
  hintsUsedThisRun++;AudioFX.select();
  memState.score=Math.max(0,memState.score-50);
  let hintMsg=stepData.hit?'It will be a HIT.':(stepData.memory.length<memGame.frames?'MISS — but a frame is FREE, no eviction.':`MISS — victim will be page ${stepData.victim}.`);
  if(memGame.algorithm==='clock'&&!stepData.hit&&stepData.memory.length>=memGame.frames)hintMsg+=` Clock hand at frame ${stepData.clockHand}.`;
  renderMemory();
  // hint highlights the victim frame — only after hint pressed
  if(!stepData.hit&&stepData.victim!=null){
    const vf=document.querySelector('.frame.filled[data-page="'+stepData.victim+'"]');
    if(vf)vf.classList.add('victim');
  }
  $('#memory-notice').innerHTML=`💡 Hint: ${hintMsg} <small>(−50 pts)</small>`;
};

const tutorialClose=document.getElementById('tutorial-close');
if(tutorialClose)tutorialClose.onclick=function(){
  const banner=this.closest('.tutorial-banner');
  if(banner)banner.hidden=true;
  localStorage.setItem('memTutorialSeen','true');
};

// Mute buttons
function wireMute(btnId){
  const b=$(btnId);
  if(!b)return;
  b.textContent=AudioFX.isOn()?'🔊':'🔇';
  b.onclick=()=>{const on=AudioFX.toggle();document.querySelectorAll('.mute-btn').forEach(x=>x.textContent=on?'🔊':'🔇');};
}
wireMute('#mute-toggle');wireMute('#mute-toggle-mem');
// disk/alloc use shared data-mute buttons
document.querySelectorAll('[data-mute]').forEach(b=>{
  b.textContent=AudioFX.isOn()?'🔊':'🔇';
  b.onclick=()=>{const on=AudioFX.toggle();document.querySelectorAll('.mute-btn').forEach(x=>x.textContent=on?'🔊':'🔇');};
});

// Disk game buttons
$('#disk-submit').onclick=()=>{
  if(!diskState||diskState.order.length!==diskGame.requests.length){
    $('#disk-notice').innerHTML=`⚠ Order ALL ${diskGame.requests.length} tracks before submitting (${diskState.order.length} done).`;
    AudioFX.wrong();return;
  }
  finishDisk();
};
$('#disk-reset').onclick=()=>{diskState.order=[];diskState.seek=0;$('#disk-seek-so-far').textContent='0';renderDisk();AudioFX.click();};
$('#disk-hint').onclick=()=>{
  if(!diskGame||!diskState)return;
  hintsUsedThisRun++;
  diskState.score=Math.max(0,(diskState.score||0)-60);
  const {order}=DiskAlgos.diskSchedule(diskGame.requests,diskGame.head,diskGame.algorithm);
  const nextTrack=order[diskState.order.length];
  $('#disk-notice').innerHTML=`💡 Hint: next track is <b>${nextTrack}</b> <small>(−60 pts)</small>`;
  AudioFX.select();
};

// Alloc game controls
$('#alloc-hint').onclick=()=>{
  if(!allocGame||!allocState)return;
  const req=allocGame.reqSizes[allocState.idx];
  const holes=allocState.working.filter(h=>h.size>=req);
  const strategy=allocGame.algorithm;
  let chosen=null;
  if(strategy==='first')chosen=holes[0];
  else if(strategy==='best')chosen=[...holes].sort((a,b)=>a.size-b.size||a.id-b.id)[0];
  else chosen=[...holes].sort((a,b)=>b.size-a.size||a.id-b.id)[0];
  hintsUsedThisRun++;
  allocState.score=Math.max(0,allocState.score-40);
  updateAllocNotice(chosen?`💡 Hint: ${allocAlgoInfo[strategy].short} chooses Hole ${chosen.id} (−40 pts).`:'💡 Hint: no hole can fit this request (−40 pts).');
  AudioFX.select();
};
$('#alloc-confirm').onclick=()=>allocConfirm(false);
$('#alloc-skip').onclick=()=>allocConfirm(true);
document.addEventListener('click',e=>{
  // double-click a hole = pick+confirm in one go
  const bar=e.target.closest('.hole-bar.pickable');
  if(bar&&bar.dataset.dbl==='1'){allocConfirm(false);}
});


// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  // e.target can be the document itself (e.g. a synthetic event), which has no
  // .matches — guard it, and handle Escape before the per-mode early returns.
  if(e.target&&e.target.matches&&e.target.matches('input,select,textarea'))return;
  if(e.key==='Escape'){ closeHelp(); return; }
  const k=e.key.toLowerCase();

  // Scheduler mode active
  if(!$('#game').hidden){
    const cards=[...document.querySelectorAll('.card')];
    if(/^[1-9]$/.test(k)){
      const idx=parseInt(k)-1;
      if(cards[idx]){cards[idx].click();}
    }else if(k==='d'&&selected){deploy(selected.id);}
    else if(k==='h'){$('#hint').click();}
    return;
  }
  // Memory mode active
  if(!$('#memory-game').hidden){
    if(k==='h'){const hitBtn=document.querySelector('[data-pred="hit"]');if(hitBtn&&!document.getElementById('predict-step1').hidden)hitBtn.click();}
    else if(k==='m'){const missBtn=document.querySelector('[data-pred="miss"]');if(missBtn&&!document.getElementById('predict-step1').hidden)missBtn.click();}
    else if(/^[1-9]$/.test(k)&&!document.getElementById('predict-step2').hidden){
      const vcards=[...document.querySelectorAll('.victim-card')];
      const v=vcards[parseInt(k)-1];if(v)v.click();
    }else if(e.key==='Enter'&&!document.getElementById('submit-prediction').hidden&&!document.getElementById('submit-prediction').disabled){
      submitPrediction();
    }else if(k==='u'){$('#memory-hint').click();}
  }
  // Disk mode: ←/→ move selection, Enter picks
  if(typeof diskGame!=='undefined'&&diskGame&&!$('#disk-game').hidden&&$('#disk-result').hidden){
    const chips=[...document.querySelectorAll('.track-chip')];
    if(chips.length){
      if(!('diskArrowIdx' in window))window.diskArrowIdx=-1;
      if(e.key==='ArrowRight'){window.diskArrowIdx=(window.diskArrowIdx+1)%chips.length;chips.forEach(c=>c.classList.remove('arrow-sel'));chips[window.diskArrowIdx].classList.add('arrow-sel');AudioFX.click();e.preventDefault();}
      else if(e.key==='ArrowLeft'){window.diskArrowIdx=(window.diskArrowIdx-1+chips.length)%chips.length;chips.forEach(c=>c.classList.remove('arrow-sel'));chips[window.diskArrowIdx].classList.add('arrow-sel');AudioFX.click();e.preventDefault();}
      else if(e.key==='Enter'&&window.diskArrowIdx>=0){chips[window.diskArrowIdx].click();e.preventDefault();}
    }
  }
  // Alloc mode: ←/→ move hole selection, Enter confirms; 1-5 direct pick
  if(typeof allocGame!=='undefined'&&allocGame&&!$('#alloc-game').hidden){
    const bars=[...document.querySelectorAll('.hole-bar.pickable')];
    if(/^[1-5]$/.test(k)){
      const b=bars[parseInt(k)-1];if(b)b.click();
    }else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
      if(!('allocArrowIdx' in window))window.allocArrowIdx=-1;
      const dir=e.key==='ArrowRight'?1:-1;
      window.allocArrowIdx=(window.allocArrowIdx+dir+bars.length)%bars.length;
      bars.forEach(b=>b.classList.remove('arrow-sel'));
      if(bars[window.allocArrowIdx]){bars[window.allocArrowIdx].click();bars[window.allocArrowIdx].classList.add('arrow-sel');}
      e.preventDefault();
    }else if(e.key==='Enter'){allocConfirm(false);}
  }
  // Memory victim step: ←/→ + Enter
  if(!$('#memory-game').hidden&&document.getElementById('predict-step2').hidden===false){
    const vcards=[...document.querySelectorAll('.victim-card')];
    if(vcards.length&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){
      if(!('memArrowIdx' in window))window.memArrowIdx=-1;
      const dir=e.key==='ArrowRight'?1:-1;
      window.memArrowIdx=(window.memArrowIdx+dir+vcards.length)%vcards.length;
      vcards.forEach(c=>c.classList.remove('selected'));
      vcards[window.memArrowIdx].click();
      e.preventDefault();
    }
  }
  // Sync lab: 1-9 pick a call, H for a hint
  if(typeof syncGame!=='undefined'&&syncGame&&!$('#sync-game').hidden){
    const btns=[...document.querySelectorAll('#sync-choices .pred-btn')];
    if(/^[1-9]$/.test(k)){ const b=btns[parseInt(k)-1]; if(b)b.click(); }
    else if(k==='h'){ $('#sync-hint').click(); }
  }
  // Help overlay closes with Escape (handled at the top of this listener)
});

// Welcome keyboard strip
(function(){
  const wk=$('#welcome-kbd');
  if(wk)wk.innerHTML=`In-game: <span class="kbd">1</span>-<span class="kbd">9</span> select · <span class="kbd">D</span> deploy · <span class="kbd">H</span>/<span class="kbd">M</span> predict · <span class="kbd">Enter</span> submit · <span class="kbd">U</span> hint`;
})();

refreshXpUI();
renderAchShelf();
syncLeaderboardVisibility();
leaderboard();
