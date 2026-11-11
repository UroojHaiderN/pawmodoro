/* Pawmodoro: a cute pomodoro timer with a cat buddy. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const KEY = 'bunodoro:v1'; // kept from the first version so saved tasks carry over
  const LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
  const LOOKS = ['auto', 'strawberry', 'matcha', 'blueberry', 'lavender', 'peach', 'midnight', 'glass'];
  const OLD_LOOKS = { paper: 'strawberry', night: 'midnight' }; // names from earlier versions
  const LOOK_ICON = { auto: 'i-auto', midnight: 'i-moon', glass: 'i-glass' }; // the rest use the sun
  const LOOK_SAY = {
    auto: 'matching your system', strawberry: 'strawberry milk!', matcha: 'matcha latte time',
    blueberry: 'blueberry!', lavender: 'taro bubble tea', peach: 'just peachy', midnight: 'starry night', glass: 'ooh, glassy',
  };
  const STEP = { focus: { min: 1, max: 90, big: 5 }, short: { min: 1, max: 30, big: 1 }, long: { min: 5, max: 60, big: 5 }, every: { min: 2, max: 8, big: 1 } };
  const NUDGE_RANGE = { water: [30, 60], stretch: [45, 75] }; // minutes of timer time, picked at random each time
  const SNOOZE = 10 * 60000;
  const NUDGE = {
    water: {
      icon: 'i-water', pose: 'sip', title: 'Water time',
      subs: ['A few sips, then back to it', 'Refill that glass?', 'Your brain will thank you'],
      say: ['sip sip!', 'drink with me?', 'water break!'],
      done: ['refreshing!', 'good sip!', 'so hydrated!'],
      doneLabel: 'Done, I had some water',
      notify: 'Time for a few sips of water.',
    },
    stretch: {
      icon: 'i-stretch', pose: 'stretch', title: 'Stretch time',
      subs: ['Reach up high, roll your shoulders', 'Stand up and wiggle a bit', 'Relax your jaw and your hands'],
      say: ['streeetch!', 'reach up with me', 'wiggle break!'],
      done: ['ahh, better', 'so limber!', 'nice stretch!'],
      doneLabel: 'Done, I stretched',
      notify: 'Stand up and stretch for a minute.',
    },
  };
  const MSG = {
    task: ['yay, one down!', 'proud of you!', 'look at you go', 'tiny win, big deal', 'that’s the stuff!'],
    cat: ['purrfect!', 'meow! one down', 'pawsome work'],
    bunny: ['hop hop hooray!', 'hoppy for you!'],
    brk: ['break time! stretch a little', 'nice focus! rest now', 'sip some water?', 'you earned this'],
    back: ['ready to focus?', 'back to it, together', 'one more round?'],
    start: ['let’s focus!', 'you got this', 'reading time'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const uid = () => Math.random().toString(36).slice(2, 9);
  const pad = (n) => String(n).padStart(2, '0');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const freshToday = () => ({ date: todayKey(), count: 0, minutes: 0, water: 0, stretch: 0 });

  function defaults() {
    return {
      settings: { focus: 25, short: 5, long: 15, every: 4, auto: false, notify: false },
      tasks: [
        { id: uid(), text: 'Check me off for a little cheer', done: false },
        { id: uid(), text: 'Add one real thing to finish today', done: false },
        { id: uid(), text: 'Open pawmodoro', done: true },
      ],
      currentId: null, buddy: 'cat', look: 'auto', vol: 60, muted: false, mini: false, showDone: false,
      timer: { phase: 'focus', cycle: 0, total: 25 * 60000, remaining: 25 * 60000, running: false, endAt: 0, fresh: true },
      nudges: { water: 0, stretch: 0, waterDue: 0, stretchDue: 0 }, // timer time since the last nudge, and when the next is due (ms)
      today: freshToday(),
    };
  }
  function merge(base, d) {
    if (!d || typeof d !== 'object') return base;
    const out = { ...base, ...d };
    out.settings = { ...base.settings, ...(d.settings || {}) };
    out.timer = { ...base.timer, ...(d.timer || {}) };
    out.today = { ...base.today, ...(d.today || {}) };
    out.nudges = { ...base.nudges, ...(d.nudges || {}) };
    if (!Array.isArray(out.tasks)) out.tasks = base.tasks;
    if (OLD_LOOKS[out.look]) out.look = OLD_LOOKS[out.look];
    if (!LOOKS.includes(out.look)) out.look = 'auto';
    if (out.buddy !== 'cat' && out.buddy !== 'bunny') out.buddy = 'cat';
    return out;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return merge(defaults(), JSON.parse(raw)); } catch (e) {}
    return null;
  }
  let saveTimer;
  function saveNow() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }

  let S;
  const el = {};
  function rollToday() { if (S.today.date !== todayKey()) S.today = freshToday(); }

  /* ---------- Mac app bridge (only present inside the Pawmodoro Mac app) ---------- */
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pawmodoro;
  const inApp = !!bridge;
  function post(msg) { if (!bridge) return; try { bridge.postMessage(msg); } catch (e) {} }
  function sendLayout() {
    if (!inApp) return;
    // The window hugs the card, so the page must never scroll (focus changes while resizing can scroll it).
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const r = el.stage.getBoundingClientRect();
    post({ type: 'size', w: Math.ceil(r.width), h: Math.ceil(r.height) });
    const grab = S.mini ? '#mini-bun, #mini-time' : '.tape, .bunny-wrap, .time, .phase-row';
    const rects = [...document.querySelectorAll(grab)]
      .map((n) => n.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({ x: b.left, y: b.top, w: b.width, h: b.height }));
    post({ type: 'drag', rects });
    // In Glass, the Mac app paints real frosted glass behind the card, cut to the card's exact shape.
    const card = S.mini ? el.mini : el.card;
    const b = card.getBoundingClientRect(), cs = getComputedStyle(card);
    const corner = (v) => { const [h, w] = v.split(' ').map(parseFloat); return [h || 0, Number.isNaN(w) || w === undefined ? (h || 0) : w]; };
    post({
      type: 'glass', on: S.look === 'glass',
      rect: { x: b.left, y: b.top, w: b.width, h: b.height },
      radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(corner),
    });
  }

  /* ---------- sound ---------- */
  let ac = null;
  function audio() {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { ac = null; }
    return ac;
  }
  const level = () => (S.muted ? 0 : S.vol / 100);
  function tone(c, freq, at, dur, gain, toFreq) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, at);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + dur * 0.6);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(c.destination); o.start(at); o.stop(at + dur + 0.05);
  }
  function chime() {
    const v = level(); if (!v) return; const c = audio(); if (!c) return; const t = c.currentTime + 0.02;
    [[659.25, 0], [783.99, 0.2], [1046.5, 0.4]].forEach(([f, d]) => { tone(c, f, t + d, 1.6, 0.22 * v); tone(c, f * 2, t + d, 0.7, 0.04 * v); });
  }
  function pop() {
    const v = level(); if (!v) return; const c = audio(); if (!c) return; const t = c.currentTime + 0.01;
    tone(c, 620, t, 0.18, 0.2 * v, 1250); tone(c, 1320, t + 0.09, 0.22, 0.08 * v);
  }
  function nudgeSound(kind) {
    const v = level(); if (!v) return; const c = audio(); if (!c) return; const t = c.currentTime + 0.02;
    if (kind === 'water') { tone(c, 1180, t, 0.28, 0.16 * v, 560); tone(c, 1560, t + 0.2, 0.28, 0.12 * v, 720); }
    else { tone(c, 392, t, 0.4, 0.16 * v, 600); tone(c, 523.25, t + 0.22, 0.5, 0.14 * v, 880); }
  }

  /* ---------- desktop notifications ---------- */
  function notify(title, body) {
    if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (pipWin || (document.visibilityState === 'visible' && document.hasFocus())) return; // already on screen
    try {
      const n = new Notification(title, { body, icon: '../icons/icon-192.png', tag: 'pawmodoro', renotify: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {}
  }

  /* ---------- timer ---------- */
  const dur = (p) => S.settings[p] * 60000;
  const remaining = () => (S.timer.running ? Math.max(0, S.timer.endAt - Date.now()) : S.timer.remaining);
  function setPhase(p) { const t = S.timer; t.phase = p; t.total = t.remaining = dur(p); t.fresh = true; }

  function start() {
    const t = S.timer; if (t.running) return;
    audio();
    if (t.remaining <= 0) t.remaining = t.total;
    if (t.fresh) say(t.phase === 'focus' ? pick(MSG.start) : 'nap time', 1800);
    t.endAt = Date.now() + t.remaining; t.running = true; t.fresh = false;
    render(); save();
  }
  function pause() {
    const t = S.timer; if (!t.running) return;
    t.remaining = Math.max(0, t.endAt - Date.now()); t.running = false;
    render(); save();
  }
  const toggle = () => (S.timer.running ? pause() : start());
  function reset() {
    const t = S.timer; t.running = false; setPhase(t.phase);
    say('fresh start', 1600); render(); save();
  }
  function advance(completed) {
    const t = S.timer, was = t.phase;
    if (was === 'focus') {
      if (completed) { t.cycle += 1; bumpToday(Math.round(t.total / 60000)); }
      setPhase(completed && t.cycle >= S.settings.every ? 'long' : 'short');
    } else {
      if (was === 'long') t.cycle = 0;
      setPhase('focus');
    }
    t.running = false;
    if (completed && S.settings.auto) { t.endAt = Date.now() + t.remaining; t.running = true; t.fresh = false; }
  }
  function complete(quiet) {
    const was = S.timer.phase;
    advance(true);
    if (!quiet) {
      chime();
      notify(was === 'focus' ? 'Focus session done' : 'Break is over', was === 'focus' ? `Time for a ${LABEL[S.timer.phase].toLowerCase()}.` : 'Ready for another focus session?');
    }
    if (was === 'focus') cheer(S.timer.phase === 'long' ? `${S.settings.every} done! long break` : pick(MSG.brk), 3600);
    else say(pick(MSG.back), 3200);
    render(); save();
  }
  function skip() {
    advance(false);
    say(S.timer.phase === 'focus' ? 'back to focus' : 'skipped to a break', 1800);
    render(); save();
  }
  function bumpToday(min) { rollToday(); S.today.count += 1; S.today.minutes += min; }

  /* ---------- water + stretch nudges ---------- */
  let activeNudge = null;
  const randomDue = (kind) => { const [lo, hi] = NUDGE_RANGE[kind]; return Math.round((lo + Math.random() * (hi - lo)) * 60000); };
  function checkNudges() {
    if (activeNudge) return;
    for (const kind of ['water', 'stretch']) {
      if (!S.nudges[kind + 'Due']) S.nudges[kind + 'Due'] = randomDue(kind);
      if (S.nudges[kind] >= S.nudges[kind + 'Due']) { showNudge(kind); return; }
    }
  }
  function showNudge(kind) {
    const n = NUDGE[kind];
    activeNudge = kind;
    el.nudgeTitle.textContent = n.title;
    el.nudgeSub.textContent = pick(n.subs);
    el.nudgeUse.setAttribute('href', '#' + n.icon);
    setIcon(el.miniNudge, n.icon);
    el.nudgeDone.setAttribute('aria-label', n.doneLabel);
    el.miniNudge.setAttribute('aria-label', n.doneLabel);
    el.miniNudge.title = n.title;
    el.nudge.hidden = false; el.miniNudge.hidden = false;
    say(pick(n.say), 4000);
    nudgeSound(kind);
    notify(n.title, n.notify);
    updateBunny();
  }
  function hideNudge() { activeNudge = null; el.nudge.hidden = true; el.miniNudge.hidden = true; updateBunny(); }
  function resolveNudge(done) {
    const kind = activeNudge; if (!kind) return;
    hideNudge();
    if (done) {
      S.nudges[kind] = 0; S.nudges[kind + 'Due'] = randomDue(kind); rollToday(); S.today[kind] += 1;
      pop(); cheer(pick(NUDGE[kind].done), 2000);
    } else {
      S.nudges[kind] = Math.max(0, S.nudges[kind + 'Due'] - SNOOZE);
      say('ok, in 10 minutes', 1800);
    }
    // keep the other nudge at least 10 minutes away, so they never pile up
    const other = kind === 'water' ? 'stretch' : 'water';
    S.nudges[other] = Math.min(S.nudges[other], Math.max(0, S.nudges[other + 'Due'] - SNOOZE));
    render(); save();
  }

  /* ---------- buddy + speech bubble ---------- */
  let cheerUntil = 0, bubbleTimer;
  function bunnyState() {
    if (Date.now() < cheerUntil) return 'cheer';
    if (activeNudge) return NUDGE[activeNudge].pose;
    if (S.timer.phase !== 'focus') return 'break';
    return S.timer.running ? 'focus' : 'idle';
  }
  function updateBunny() {
    const s = bunnyState();
    if (el.bunny.dataset.state !== s) { el.bunny.dataset.state = s; el.miniBun.dataset.state = s; }
  }
  function say(text, ms = 2600) {
    el.bubble.textContent = text; el.bubble.classList.add('show');
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => el.bubble.classList.remove('show'), ms);
  }
  function cheer(text, ms = 2400) { cheerUntil = Date.now() + ms; say(text, ms); updateBunny(); }

  /* ---------- painting ---------- */
  function digits(target, str) {
    if (target.childElementCount !== str.length) {
      target.replaceChildren(...[...str].map((ch) => { const s = document.createElement('span'); if (ch === ':') s.className = 'colon'; return s; }));
    }
    [...str].forEach((ch, i) => { if (target.children[i].textContent !== ch) target.children[i].textContent = ch; });
  }
  let lastSec = -1;
  function paintTime(force) {
    const ms = remaining(), sec = Math.ceil(ms / 1000);
    if (sec !== lastSec || force) {
      lastSec = sec;
      const str = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
      digits(el.time, str); digits(el.miniTime, str);
      const label = `${Math.floor(sec / 60)} minutes ${sec % 60} seconds left`;
      el.time.setAttribute('aria-label', label); el.miniTime.setAttribute('aria-label', label);
      document.title = S.timer.running ? `${str} · ${LABEL[S.timer.phase]}` : 'Pawmodoro';
      if (pipWin) pipWin.document.title = document.title;
      post({ type: 'tick', text: str, running: S.timer.running });
    }
    const t = S.timer;
    if (t.phase === 'focus') {
      const d = el.dots.children[t.cycle];
      if (d) d.style.setProperty('--p', Math.min(1, Math.max(0, 1 - ms / t.total)).toFixed(3));
    }
  }
  function renderDots() {
    const n = S.settings.every, t = S.timer;
    if (el.dots.childElementCount !== n) {
      el.dots.replaceChildren(...Array.from({ length: n }, () => { const d = document.createElement('span'); d.className = 'dot'; return d; }));
    }
    const done = Math.min(t.cycle, n);
    [...el.dots.children].forEach((d, i) => d.style.setProperty('--p', i < done ? 1 : 0));
    el.dots.setAttribute('aria-label', `${done} of ${n} focus sessions done`);
  }
  function icon(id) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.append(u); return s;
  }
  function setIcon(btn, id) { btn.querySelector('use').setAttribute('href', '#' + id); }
  function taskItem(x) {
    const li = document.createElement('li');
    li.className = 'task' + (x.done ? ' is-done' : '') + (x.id === S.currentId ? ' current' : '');
    li.dataset.id = x.id;
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'check'; check.dataset.act = 'check';
    check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', String(x.done));
    check.setAttribute('aria-label', x.text); check.append(icon('i-check'));
    const text = document.createElement('button');
    text.type = 'button'; text.className = 't-text'; text.dataset.act = 'pick'; text.textContent = x.text;
    if (!x.done) text.title = 'Make this the current task';
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.dataset.act = 'del';
    del.setAttribute('aria-label', `Delete “${x.text}”`); del.append(icon('i-x'));
    li.append(check, text, del);
    return li;
  }
  function renderTasks() {
    const open = S.tasks.filter((x) => !x.done), done = S.tasks.filter((x) => x.done);
    if (!open.some((x) => x.id === S.currentId)) S.currentId = open[0] ? open[0].id : null;
    el.tasks.replaceChildren(...open.map(taskItem));
    el.doneList.replaceChildren(...done.map(taskItem));
    el.tasks.hidden = open.length === 0;
    el.empty.hidden = open.length > 0;
    el.doneRow.hidden = done.length === 0;
    el.doneCount.textContent = `${done.length} done`;
    el.doneToggle.setAttribute('aria-expanded', String(S.showDone));
    el.doneList.hidden = !S.showDone || done.length === 0;
  }
  function renderSettings() {
    ['focus', 'short', 'long'].forEach((k) => { el.out[k].textContent = S.settings[k]; });
    el.notify.checked = !!S.settings.notify && 'Notification' in window && Notification.permission === 'granted';
    el.seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === S.look)));
    el.buddySeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.buddy === S.buddy)));
  }
  function render() {
    const t = S.timer;
    document.documentElement.dataset.look = S.look;
    el.bunny.dataset.buddy = S.buddy; el.miniBun.dataset.buddy = S.buddy;
    el.tag.textContent = `a tiny focus timer with a ${S.buddy} buddy`;
    el.hintBuddy.textContent = `your ${S.buddy}`;
    setIcon(el.look, LOOK_ICON[S.look] || 'i-sun');
    el.look.setAttribute('aria-label', `Colors: ${S.look}. Switch colors`);
    if (el.themeMeta) el.themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue('--desk').trim() || '#FFF4F7';
    el.phase.textContent = LABEL[t.phase];
    el.card.dataset.running = String(t.running);
    const goText = t.running ? 'Pause' : t.fresh ? 'Start' : 'Resume';
    el.goLabel.textContent = goText;
    setIcon(el.go, t.running ? 'i-pause' : 'i-play');
    setIcon(el.miniGo, t.running ? 'i-pause' : 'i-play');
    el.miniGo.setAttribute('aria-label', goText);
    setIcon(el.mute, S.muted || S.vol === 0 ? 'i-muted' : 'i-speaker');
    el.mute.setAttribute('aria-label', S.muted ? 'Turn sound on' : 'Mute sounds');
    el.vol.value = S.muted ? 0 : S.vol;
    el.vol.style.setProperty('--fill', (S.muted ? 0 : S.vol) + '%');
    el.card.hidden = S.mini; el.mini.hidden = !S.mini;
    const floatIcon = pipWin ? 'i-dock' : 'i-float';
    const floatLabel = pipWin ? 'Put the timer back in the page' : 'Float on top of your screen';
    [el.floatBtn, el.miniFloat].forEach((b) => {
      b.hidden = !canFloat;
      setIcon(b, floatIcon); b.setAttribute('aria-label', floatLabel); b.title = pipWin ? 'Back to the page' : 'Float on top';
    });
    if (pipWin) {
      pipWin.document.documentElement.dataset.look = S.look;
      pipWin.document.body.classList.toggle('is-mini', S.mini);
    }
    rollToday();
    const d = S.today;
    el.today.textContent = `Today: ${plural(d.count, 'pomodoro', 'pomodoros')} · ${d.minutes} min focused · ${plural(d.water, 'water break', 'water breaks')} · ${plural(d.stretch, 'stretch', 'stretches')}`;
    renderDots(); renderSettings(); paintTime(true); updateBunny();
    if (inApp) requestAnimationFrame(sendLayout);
  }

  /* ---------- tasks ---------- */
  function toggleTask(id) {
    const x = S.tasks.find((t) => t.id === id); if (!x) return;
    const active = el.card.ownerDocument.activeElement;
    const hadFocus = active && active.closest && active.closest('.task');
    x.done = !x.done;
    const after = () => {
      renderTasks(); save();
      if (hadFocus) { const next = el.tasks.querySelector('.check') || el.addBtn; next.focus(); }
    };
    if (x.done) {
      pop(); cheer(pick(MSG.task.concat(MSG[S.buddy])), 2400);
      const li = el.tasks.querySelector(`[data-id="${id}"]`);
      if (li) {
        li.classList.add('is-done');
        li.querySelector('.check').setAttribute('aria-checked', 'true');
        setTimeout(() => li.classList.add('leaving'), 260);
        setTimeout(after, 600);
        return;
      }
    }
    after();
  }
  function openAdd() { el.addBtn.hidden = true; el.addInput.hidden = false; el.addInput.focus(); }
  function closeAdd() { el.addInput.value = ''; el.addInput.hidden = true; el.addBtn.hidden = false; }

  /* ---------- floating window (Document Picture-in-Picture, Chrome and Edge) ---------- */
  const canFloat = 'documentPictureInPicture' in window;
  let pipWin = null;
  const pipSize = () => (S.mini ? { width: 330, height: 110 } : { width: 360, height: 700 });
  function resizePip() {
    if (!pipWin) return;
    try { const s = pipSize(); pipWin.resizeTo(s.width, s.height); } catch (e) {}
  }
  async function toggleFloat() {
    if (pipWin) { pipWin.close(); return; }
    if (!canFloat) { say('floating needs Chrome or Edge on a computer', 3400); return; }
    let w;
    try { w = await window.documentPictureInPicture.requestWindow(pipSize()); }
    catch (e) {
      console.warn('Pawmodoro could not open the floating window:', e);
      say(window.top !== window ? 'open the web app to float me' : 'couldn’t float. try again?', 3400);
      return;
    }
    pipWin = w;
    const d = w.document;
    document.querySelectorAll('style').forEach((s) => d.head.append(s.cloneNode(true)));
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
      const n = d.createElement('link'); n.rel = 'stylesheet'; n.href = l.href; d.head.append(n);
    });
    d.title = document.title;
    d.body.classList.add('pip');
    const box = d.createElement('main'); box.className = 'stage';
    d.body.append(el.defs.cloneNode(true), box);
    box.append(el.card, el.mini);
    el.floatNote.hidden = false;
    d.addEventListener('keydown', onKey);
    w.addEventListener('pagehide', unfloat, { once: true });
    w.setInterval(tick, 250); // the floating window stays visible, so its timer is never throttled
    render();
  }
  function unfloat() {
    if (!pipWin) return;
    el.stage.insertBefore(el.card, el.floatNote);
    el.stage.insertBefore(el.mini, el.floatNote);
    el.floatNote.hidden = true;
    pipWin = null;
    render();
  }

  /* ---------- install as an app ---------- */
  // Macs get the real Mac app instead; other computers can install the web app from Chrome or Edge.
  const ua = navigator.userAgentData;
  const onMac = ua && ua.platform ? ua.platform === 'macOS'
    : /Mac/.test(navigator.platform || navigator.userAgent) && navigator.maxTouchPoints < 2; // iPads also say "Mac"
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (el.install) el.install.hidden = onMac; });
  window.addEventListener('appinstalled', () => { installEvt = null; if (el.install) { el.install.hidden = true; say('installed! find me in your apps', 3000); } });

  /* ---------- wiring ---------- */
  function onKey(e) {
    if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tg = e.target;
    if (tg && tg.closest && tg.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    e.preventDefault(); toggle();
  }
  function bind() {
    Object.assign(el, {
      stage: $('.stage'), defs: $('.defs'), floatNote: $('#floating-note'),
      card: $('#card'), mini: $('#mini'), bunny: $('#bunny'), miniBun: $('#mini-bun'), bubble: $('#bubble'),
      time: $('#time'), miniTime: $('#mini-time'), phase: $('#phase'), dots: $('#dots'),
      tasks: $('#tasks'), doneList: $('#done-list'), empty: $('#empty'), doneRow: $('#done-row'),
      doneToggle: $('#done-toggle'), doneCount: $('#done-count'),
      addForm: $('#add-form'), addBtn: $('#add-btn'), addInput: $('#add-input'),
      go: $('#go'), goLabel: $('#go-label'), miniGo: $('#mini-go'),
      mute: $('#mute'), vol: $('#vol'), look: $('#look'), notify: $('#notify'),
      seg: $('#seg'), buddySeg: $('#buddy-seg'),
      faceMain: $('#face-main'), faceSettings: $('#face-settings'), settingsBtn: $('#settings-btn'),
      today: $('#today'), tag: $('#tag'), hintBuddy: $('#hint-buddy'), install: $('#install'),
      nudge: $('#nudge'), nudgeUse: $('#nudge .nudge-ico use'), nudgeTitle: $('#nudge-title'), nudgeSub: $('#nudge-sub'),
      nudgeDone: $('#nudge-done'), nudgeLater: $('#nudge-later'), miniNudge: $('#mini-nudge'),
      floatBtn: $('#float-btn'), miniFloat: $('#mini-float'), miniBtn: $('#mini-btn'), miniExpand: $('#mini-expand'),
      out: { focus: $('#out-focus'), short: $('#out-short'), long: $('#out-long') },
      themeMeta: $('meta[name="theme-color"]'),
    });

    el.go.addEventListener('click', toggle);
    el.miniGo.addEventListener('click', toggle);
    $('#skip').addEventListener('click', skip);
    $('#reset').addEventListener('click', reset);

    el.card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('.task').dataset.id;
      if (b.dataset.act === 'check') toggleTask(id);
      else if (b.dataset.act === 'del') { S.tasks = S.tasks.filter((t) => t.id !== id); renderTasks(); save(); if (!el.addBtn.hidden) el.addBtn.focus(); }
      else if (b.dataset.act === 'pick') {
        const x = S.tasks.find((t) => t.id === id);
        if (x && !x.done) { S.currentId = id; renderTasks(); save(); say('on it!', 1400); }
      }
    });
    el.doneToggle.addEventListener('click', () => { S.showDone = !S.showDone; renderTasks(); save(); });
    $('#clear-done').addEventListener('click', () => { S.tasks = S.tasks.filter((t) => !t.done); S.showDone = false; renderTasks(); save(); el.addBtn.focus(); });

    el.addBtn.addEventListener('click', openAdd);
    el.addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.addInput.value.trim();
      if (!v) { closeAdd(); el.addBtn.focus(); return; }
      S.tasks.push({ id: uid(), text: v, done: false });
      el.addInput.value = ''; renderTasks(); save();
      el.tasks.scrollTop = el.tasks.scrollHeight;
    });
    el.addInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAdd(); el.addBtn.focus(); } });
    el.addInput.addEventListener('blur', () => { if (!el.addInput.value.trim()) closeAdd(); });

    el.nudgeDone.addEventListener('click', () => resolveNudge(true));
    el.miniNudge.addEventListener('click', () => resolveNudge(true));
    el.nudgeLater.addEventListener('click', () => resolveNudge(false));

    el.mute.addEventListener('click', () => {
      if (S.muted || S.vol === 0) { S.muted = false; if (S.vol === 0) S.vol = 50; audio(); render(); pop(); }
      else { S.muted = true; render(); }
      save();
    });
    el.vol.addEventListener('input', () => { S.vol = +el.vol.value; S.muted = false; el.vol.style.setProperty('--fill', S.vol + '%'); setIcon(el.mute, S.vol === 0 ? 'i-muted' : 'i-speaker'); save(); });
    el.vol.addEventListener('change', () => { audio(); pop(); });

    const setLook = (l) => { S.look = l; render(); save(); say(LOOK_SAY[l], 1600); };
    el.look.addEventListener('click', () => setLook(LOOKS[(LOOKS.indexOf(S.look) + 1) % LOOKS.length]));
    el.seg.addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (b) setLook(b.dataset.look); });
    el.buddySeg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buddy]'); if (!b) return;
      S.buddy = b.dataset.buddy; render(); save();
      cheer(S.buddy === 'cat' ? 'meow! hi there' : 'hop! hi there', 1800);
    });

    // Move focus along only for keyboard users (a mouse click has detail > 0), so no stray focus ring appears.
    el.miniBtn.addEventListener('click', (e) => { S.mini = true; render(); save(); resizePip(); if (!e.detail) el.miniExpand.focus(); });
    el.miniExpand.addEventListener('click', (e) => { S.mini = false; render(); save(); resizePip(); if (!e.detail) el.miniBtn.focus(); });
    el.floatBtn.addEventListener('click', toggleFloat);
    el.miniFloat.addEventListener('click', toggleFloat);
    $('#unfloat').addEventListener('click', () => { if (pipWin) pipWin.close(); });

    el.install.hidden = onMac || !installEvt;
    $('#mac-link').hidden = !onMac;
    el.install.addEventListener('click', async () => {
      if (!installEvt) return;
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) {}
      installEvt = null; el.install.hidden = true;
    });

    const showSettings = (on) => {
      el.faceMain.hidden = on; el.faceSettings.hidden = !on;
      el.settingsBtn.setAttribute('aria-pressed', String(on));
      (on ? el.faceSettings.querySelector('.stepper button') : el.settingsBtn).focus();
    };
    el.settingsBtn.addEventListener('click', () => showSettings(el.faceSettings.hidden));
    $('#settings-done').addEventListener('click', () => showSettings(false));
    el.faceSettings.addEventListener('click', (e) => {
      const b = e.target.closest('.stepper button'); if (!b) return;
      const key = b.closest('.stepper').dataset.key, dir = +b.dataset.d;
      const c = STEP[key];
      let v = S.settings[key];
      if (c.big > 1) v = dir > 0 ? (v < c.big ? v + 1 : v + c.big) : (v > c.big ? v - c.big : v - 1);
      else v += dir;
      S.settings[key] = Math.max(c.min, Math.min(c.max, v));
      const t = S.timer;
      if (key === t.phase && t.fresh && !t.running) setPhase(key);
      render(); save();
    });
    el.notify.addEventListener('change', async () => {
      if (!el.notify.checked) { S.settings.notify = false; save(); return; }
      if (!('Notification' in window)) { el.notify.checked = false; say('no notifications in this browser', 2600); return; }
      let p = Notification.permission;
      if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
      S.settings.notify = p === 'granted';
      el.notify.checked = S.settings.notify;
      say(S.settings.notify ? 'i’ll ping you!' : 'notifications are blocked here', 2600);
      save();
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pagehide', saveNow);

    if (inApp) {
      const hideBtn = $('#hide-btn');
      hideBtn.hidden = false;
      hideBtn.addEventListener('click', () => post({ type: 'hide' }));
      el.notify.closest('label').hidden = true; // the floating card is always on screen instead
      if ('ResizeObserver' in window) new ResizeObserver(() => sendLayout()).observe(el.stage);
      window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
      window.addEventListener('resize', () => requestAnimationFrame(sendLayout));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(sendLayout);
    }
  }

  let lastTick = Date.now();
  function tick() {
    const now = Date.now();
    const dt = Math.min(Math.max(0, now - lastTick), 60000);
    lastTick = now;
    if (S.timer.running) { S.nudges.water += dt; S.nudges.stretch += dt; }
    if (S.timer.running && now >= S.timer.endAt) complete(false);
    checkNudges();
    paintTime(false); updateBunny();
  }

  function boot(data) {
    S = (data && data.state) ? merge(defaults(), data.state) : (load() || defaults());
    if (!S.timer.total) S.timer.total = dur(S.timer.phase);
    S.settings.every = 4; S.settings.auto = false; // these no longer have settings, so keep the classic rhythm
    rollToday();
    bind();
    renderTasks();
    if (S.timer.running && Date.now() >= S.timer.endAt) complete(true);
    else render();
    const demo = new URLSearchParams(location.search).get('demo');
    if (demo && NUDGE[demo]) setTimeout(() => showNudge(demo), 900);
    else setTimeout(() => say(S.timer.running ? 'welcome back!' : S.buddy === 'cat' ? 'meow! pick a task, then press start' : 'hi! pick a task, then press start', 4200), 350);
    setInterval(tick, 250);
    setInterval(saveNow, 30000);
  }

  if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]') &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('../sw.js').catch(() => {}); });
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) { try { hot.snapshot(() => ({ state: S })); } catch (e) {} }
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
