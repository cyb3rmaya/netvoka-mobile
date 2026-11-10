'use strict';
const SB = 'https://khcgolyuraifoxmlwxbk.supabase.co';
const KEY = 'sb_publishable_RvhXljM1IeLu58iixdRuFw_C-F_hygs';
const DAY = 864e5;
const POS_KO = { noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사', pronoun: '대명사', preposition: '전치사', conjunction: '접속사', interjection: '감탄사', exclamation: '감탄사', determiner: '한정사', abbreviation: '약어', article: '관사', numeral: '수사', particle: '불변화사', phrase: '구', idiom: '관용구' };
const TAG_LABEL = { toeic: 'TOEIC', business: '비즈니스' };
const STARS = { 1: '★★★', 2: '★★', 3: '★' };

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota/private */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { } };
const posKo = p => POS_KO[(p || '').toLowerCase()] || p || '';
const nowIso = () => new Date().toISOString();

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------- state ---------- */
let session = lsGet('nv_session');           // {access, refresh, exp, uid, email}
let store = { words: {}, queue: {}, cursor: '1970-01-01T00:00:00Z', last: 0 };
let ui = { tab: 'review', q: '', f: 'all', open: {}, confirm: null, limit: 100, syncing: false, err: '' };
let rv = null;                               // review session {cards:[], i, shown}

function loadStore() { const s = session && lsGet('nv_data:' + session.uid); if (s) store = Object.assign({ words: {}, queue: {}, cursor: '1970-01-01T00:00:00Z', last: 0 }, s); else store = { words: {}, queue: {}, cursor: '1970-01-01T00:00:00Z', last: 0 }; }
function saveStore() { if (session) lsSet('nv_data:' + session.uid, store); }
function saveSession() { lsSet('nv_session', session); }

/* ---------- API ---------- */
const AUTH_ERR = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않아요.',
  email_not_confirmed: '이메일 인증이 아직 안 됐어요. 메일함의 인증 링크를 눌러 주세요.',
  user_already_exists: '이미 가입된 이메일이에요. 로그인해 주세요.',
  weak_password: '비밀번호가 너무 약해요. 6자 이상으로 해 주세요.',
  over_request_rate_limit: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  over_email_send_rate_limit: '메일 발송 한도를 넘었어요. 잠시 후 다시 시도해 주세요.',
  email_address_invalid: '이메일 주소 형식이 올바르지 않아요.',
  validation_failed: '입력값을 확인해 주세요.',
  signup_disabled: '지금은 가입할 수 없어요.'
};
function errMsg(status, body) {
  const code = body && (body.error_code || body.code);
  if (code && AUTH_ERR[code]) return AUTH_ERR[code];
  const m = ((body && (body.msg || body.message || body.error_description || body.error)) || '').toLowerCase();
  if (status === 429 || m.includes('rate limit')) return AUTH_ERR.over_request_rate_limit;
  if (m.includes('invalid login')) return AUTH_ERR.invalid_credentials;
  if (m.includes('not confirmed')) return AUTH_ERR.email_not_confirmed;
  if (m.includes('already')) return AUTH_ERR.user_already_exists;
  if (m.includes('password')) return AUTH_ERR.weak_password;
  if (status === 0) return '네트워크에 연결할 수 없어요.';
  return '오류가 발생했어요 (' + status + ')' + (m ? ': ' + (body.msg || body.message || body.error_description || body.error) : '');
}
async function raw(path, method, body, token, extra) {
  const h = Object.assign({ apikey: KEY, 'Accept-Profile': 'netvoka', 'Content-Profile': 'netvoka', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || KEY) }, extra || {});
  let r;
  try { r = await fetch(SB + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { return { ok: false, status: 0, body: null }; }
  let b = null; const t = await r.text(); if (t) { try { b = JSON.parse(t); } catch (e) { b = null; } }
  return { ok: r.ok, status: r.status, body: b };
}
function setSession(b) {
  session = { access: b.access_token, refresh: b.refresh_token, exp: Date.now() + (b.expires_in || 3600) * 1000, uid: b.user.id, email: b.user.email };
  saveSession();
}
let refreshing = null;
function refreshSession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!session) return false;
    const r = await raw('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: session.refresh });
    if (r.ok && r.body && r.body.access_token) { setSession(Object.assign({ user: r.body.user || { id: session.uid, email: session.email } }, r.body)); return true; }
    if (r.status === 400 || r.status === 401 || r.status === 403) { session = null; lsDel('nv_session'); render(); toast('세션이 만료됐어요. 다시 로그인해 주세요.'); }
    return false;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function authed(path, method, body, extra) {
  if (!session) return { ok: false, status: 401, body: null };
  if (session.exp - Date.now() < 60000) await refreshSession();
  if (!session) return { ok: false, status: 401, body: null };
  let r = await raw(path, method, body, session.access, extra);
  if (r.status === 401 && (await refreshSession()) && session) r = await raw(path, method, body, session.access, extra);
  return r;
}

/* ---------- sync ---------- */
const newer = (a, b) => Date.parse(a) > Date.parse(b);
async function pull() {
  if (!session) return true;
  let cur = new Date(Math.max(0, Date.parse(store.cursor) - 10 * 60000)).toISOString(); // overlap guards clock skew; merge is idempotent
  for (let guard = 0; guard < 200; guard++) {
    const r = await authed('/rest/v1/words?select=key,data,deleted,updated_at&updated_at=gt.' + encodeURIComponent(cur) + '&order=updated_at.asc&limit=1000', 'GET');
    if (!r.ok || !Array.isArray(r.body)) { ui.err = r.status === 0 ? '오프라인이에요' : '동기화 실패 (' + r.status + ')'; return false; }
    for (const row of r.body) {
      const q = store.queue[row.key];
      if (q && newer(q.updated_at, row.updated_at)) continue;
      if (q) delete store.queue[row.key];
      store.words[row.key] = { data: row.data || {}, deleted: !!row.deleted, updated_at: row.updated_at };
    }
    if (r.body.length) { cur = r.body[r.body.length - 1].updated_at; if (newer(cur, store.cursor)) store.cursor = cur; }
    if (r.body.length < 1000) break;
  }
  store.last = Date.now(); ui.err = ''; saveStore(); return true;
}
let flushing = false;
async function flush() {
  if (flushing || !session) return true;
  flushing = true;
  try {
    const rows = Object.entries(store.queue);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const body = chunk.map(([key, v]) => ({ key, data: v.deleted ? {} : v.data, deleted: !!v.deleted, updated_at: v.updated_at }));
      const r = await authed('/rest/v1/words?on_conflict=user_id,key', 'POST', body, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!r.ok) { ui.err = r.status === 0 ? '오프라인 — 나중에 자동 전송돼요' : '전송 실패 (' + r.status + ')'; return false; }
      for (const [key, v] of chunk) if (store.queue[key] && store.queue[key].updated_at === v.updated_at) delete store.queue[key];
      saveStore();
    }
    return true;
  } finally { flushing = false; }
}
async function sync(manual) {
  if (!session || ui.syncing) return;
  ui.syncing = true; paintSync();
  const f = await flush(); const p = await pull();
  ui.syncing = false;
  if (manual) toast(f && p ? '동기화 완료' : (ui.err || '동기화 실패'));
  if (!rv) render(); else paintSync();
}
function changeWord(key, data, deleted) {
  const row = { data: deleted ? {} : data, deleted: !!deleted, updated_at: nowIso() };
  store.words[key] = row; store.queue[key] = row; saveStore();
  flush().then(paintSync);
}

/* ---------- data helpers ---------- */
const liveWords = () => Object.entries(store.words).filter(([, v]) => !v.deleted && v.data && v.data.text).map(([key, v]) => ({ key, d: v.data }));
const dueOf = d => { const x = d.srs && d.srs.due; if (typeof x === 'number') return x; const t = Date.parse(x); return isNaN(t) ? 0 : t; };
const isDue = w => dueOf(w.d) <= Date.now();
const meaningsOf = d => d.meanings && d.meanings.length ? d.meanings : (d.defs || []).map(x => ({ pos: x.pos, ko: [], defs: [{ en: x.def, ex: '' }] }));
const koHtml = d => {
  const ms = meaningsOf(d).filter(m => m.ko && m.ko.length);
  return ms.length ? ms.map(m => `<div class="mk"><i>${esc(posKo(m.pos))}</i>${esc(m.ko.join(', '))}</div>`).join('') : (d.ko ? `<div class="mk">${esc(d.ko)}</div>` : '');
};
const defsOf = d => meaningsOf(d).flatMap(m => (m.defs || []).map(x => ({ pos: m.pos, en: x.en, ex: x.ex }))).filter(x => x.en);
const badge = d => d.tag && TAG_LABEL[d.tag] ? `<span class="badge ${esc(d.tag)}">${esc(TAG_LABEL[d.tag])}${STARS[d.rank] ? ' ' + STARS[d.rank] : ''}</span>` : '';
function hiSentence(s, word) {
  s = String(s || ''); const m = word ? s.match(new RegExp('(' + escRe(word) + '\\w*)', 'i')) : null;
  if (!m) return esc(s);
  return esc(s.slice(0, m.index)) + '<mark>' + esc(m[0]) + '</mark>' + esc(s.slice(m.index + m[0].length));
}
function speak(t) {
  try { const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
}
function say(d) { if (d.audio) { try { new Audio(d.audio).play().catch(() => speak(d.text)); return; } catch (e) { } } speak(d.text); }
function fmtTime(ms) {
  if (!ms) return '아직 없음';
  const d = new Date(ms), p = n => String(n).padStart(2, '0'), t = p(d.getHours()) + ':' + p(d.getMinutes());
  return d.toDateString() === new Date().toDateString() ? '오늘 ' + t : (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + t;
}

/* ---------- render ---------- */
function render() {
  const app = $('#app'); $('#btnLogout').hidden = !session;
  if (!session) return renderAuth(app);
  if (rv) return renderReview(app);
  renderHome(app);
}
let authMode = 'login', authMsg = null;
function renderAuth(app) {
  const su = authMode === 'signup';
  app.innerHTML = `<div class="card"><h2>${su ? '회원가입' : '로그인'}</h2>
  <form id="authForm" novalidate>
    <label for="em">이메일</label><input id="em" type="email" autocomplete="email" inputmode="email" autocapitalize="none" required>
    <label for="pw">비밀번호</label><input id="pw" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" required>
    <button class="btn" id="authGo" type="submit">${su ? '가입하기' : '로그인'}</button>
  </form>
  ${authMsg ? `<div class="msg ${authMsg.err ? 'err' : ''}">${esc(authMsg.text)}</div>` : ''}
  <button class="link" id="authSwitch" type="button">${su ? '이미 계정이 있어요 → 로그인' : '계정이 없어요 → 회원가입'}</button></div>
  <p class="ttl" style="text-align:center;margin-top:16px">크롬 확장에서 쓰는 계정과 같은 계정으로 로그인하면 단어가 동기화돼요.</p>`;
  $('#authSwitch').onclick = () => { authMode = su ? 'login' : 'signup'; authMsg = null; render(); };
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#em').value.trim(), password = $('#pw').value;
    if (!email || !password) { authMsg = { err: 1, text: '이메일과 비밀번호를 입력해 주세요.' }; return render(); }
    const btn = $('#authGo'); btn.disabled = true; btn.textContent = '잠시만요…';
    if (su) {
      const r = await raw('/auth/v1/signup', 'POST', { email, password });
      if (r.ok) {
        if (r.body && r.body.access_token) { setSession(r.body); return afterLogin(); }
        authMode = 'login'; authMsg = { text: '메일함에서 인증 링크를 눌러 주세요. 인증 후 이 화면에서 로그인하세요. (링크가 다른 사이트로 열릴 수 있는데 괜찮아요)' };
      } else authMsg = { err: 1, text: errMsg(r.status, r.body) };
    } else {
      const r = await raw('/auth/v1/token?grant_type=password', 'POST', { email, password });
      if (r.ok && r.body && r.body.access_token) return afterLogin(setSession(r.body));
      authMsg = { err: 1, text: errMsg(r.status, r.body) };
    }
    render();
  };
}
function afterLogin() { authMsg = null; loadStore(); render(); sync(); }

function renderHome(app) {
  const all = liveWords(), due = all.filter(isDue).length;
  app.innerHTML = `<div class="stats"><div class="card stat"><b>${all.length}</b><span>전체</span></div><div class="card stat due"><b>${due}</b><span>오늘 복습</span></div></div>
  <div class="sync"><span id="syncTxt"></span><button id="btnSync" type="button">새로고침</button></div>
  <div class="tabs"><button data-tab="review" class="${ui.tab === 'review' ? 'on' : ''}">복습</button><button data-tab="words" class="${ui.tab === 'words' ? 'on' : ''}">단어</button></div>
  <div id="pane"></div>`;
  paintSync();
  $('#btnSync').onclick = () => sync(true);
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(); });
  const pane = $('#pane');
  if (ui.tab === 'review') {
    pane.innerHTML = `<button class="btn start" id="startRv" ${due ? '' : 'disabled'}>복습 시작${due ? ' (' + due + ')' : ''}</button>
    ${due ? '' : `<div class="empty">${all.length ? '오늘 복습할 단어를 모두 끝냈어요 🎉' : '아직 단어가 없어요.<br>크롬 확장에서 단어를 저장하면 여기에 나타나요.'}</div>`}`;
    $('#startRv').onclick = startReview;
  } else renderWords(pane);
}
function paintSync() {
  const t = $('#syncTxt'); if (!t) return;
  const pend = Object.keys(store.queue).length;
  t.textContent = ui.syncing ? '동기화 중…' : '마지막 동기화 ' + fmtTime(store.last) + (pend ? ` · 대기 ${pend}` : '') + (ui.err ? ' · ' + ui.err : '');
}

/* ---------- words tab ---------- */
function renderWords(pane) {
  pane.innerHTML = `<input class="search" id="q" type="search" placeholder="단어·뜻 검색" value="${esc(ui.q)}">
  <div class="chips">${[['all', '전체'], ['toeic', '토익'], ['business', '비즈니스']].map(([k, l]) => `<button data-f="${k}" class="${ui.f === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="list"></div>`;
  $('#q').oninput = e => { ui.q = e.target.value; ui.limit = 100; paintList(); };
  pane.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { ui.f = b.dataset.f; ui.limit = 100; renderWords(pane); });
  $('#list').onclick = listClick;
  paintList();
}
function paintList() {
  const q = ui.q.trim().toLowerCase();
  let ws = liveWords();
  if (ui.f !== 'all') ws = ws.filter(w => w.d.tag === ui.f);
  if (q) ws = ws.filter(w => [w.d.text, w.d.ko, w.d.sentence, w.d.sentenceKo, w.d.title, ...meaningsOf(w.d).flatMap(m => m.ko || [])].join(' ').toLowerCase().includes(q));
  ws.sort((a, b) => (b.d.added || 0) - (a.d.added || 0));
  const shown = ws.slice(0, ui.limit);
  const el = $('#list'); if (!el) return;
  if (!shown.length) { el.innerHTML = '<div class="empty">단어가 없어요.</div>'; return; }
  el.innerHTML = shown.map(({ key, d }) => {
    const open = !!ui.open[key];
    const ko = (meaningsOf(d).flatMap(m => m.ko || [])[0]) || d.ko || '';
    let body = '';
    if (open) {
      const ex = defsOf(d).filter(x => x.ex).slice(0, 3);
      body = `<div class="body">${d.ipa ? `<div class="ipa">${esc(d.ipa)}</div>` : ''}${koHtml(d)}
      ${defsOf(d).slice(0, 2).map(x => `<div class="en">${esc(x.en)}</div>`).join('')}
      ${ex.map(x => `<div class="en">“${esc(x.ex)}”</div>`).join('')}
      ${d.sentence ? `<div class="sent">${hiSentence(d.sentence, d.text)}</div>` : ''}${d.sentenceKo ? `<div class="ko-s">${esc(d.sentenceKo)}</div>` : ''}
      ${d.title ? `<div class="ttl">${esc(d.title)}</div>` : ''}
      <div class="row"><button data-say="${esc(key)}" type="button">🔊 듣기</button>
      <button class="del ${ui.confirm === key ? 'sure' : ''}" data-del="${esc(key)}" type="button">${ui.confirm === key ? '정말 삭제' : '삭제'}</button>${ui.confirm === key ? `<button data-cancel="1" type="button">취소</button>` : ''}</div></div>`;
    }
    return `<div class="item"><button class="hd" data-tog="${esc(key)}" type="button" aria-expanded="${open}"><div><div class="t">${esc(d.text)}</div><div class="k">${esc(ko)}</div></div>${badge(d)}</button>${body}</div>`;
  }).join('') + (ws.length > shown.length ? `<button class="btn alt" data-more="1" type="button">더 보기 (${ws.length - shown.length})</button>` : '');
}
function listClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tog) { const k = t.dataset.tog; ui.open[k] = !ui.open[k]; ui.confirm = null; }
  else if (t.dataset.say) { const w = store.words[t.dataset.say]; if (w) say(w.data); return; }
  else if (t.dataset.del) {
    const k = t.dataset.del;
    if (ui.confirm !== k) ui.confirm = k;
    else { ui.confirm = null; delete ui.open[k]; changeWord(k, {}, true); toast('삭제했어요'); render(); return; }
  } else if (t.dataset.cancel) ui.confirm = null;
  else if (t.dataset.more) ui.limit += 100;
  paintList();
}

/* ---------- review ---------- */
function startReview() {
  const cards = liveWords().filter(isDue).sort((a, b) => dueOf(a.d) - dueOf(b.d)).map(w => w.key);
  if (!cards.length) return;
  rv = { cards, i: 0, shown: false, total: cards.length, done: 0 };
  render();
}
function renderReview(app) {
  const key = rv.cards[rv.i];
  if (key === undefined) {
    app.innerHTML = `<div class="done"><h2>복습 끝 🎉</h2><p class="ttl">${rv.done}번 채점했어요.</p><button class="btn" id="rvHome">홈으로</button></div>`;
    $('#rvHome').onclick = () => { rv = null; render(); sync(); }; return;
  }
  const w = store.words[key]; const d = w && w.data || {};
  const front = `<div class="wd">${esc(d.text)}<button class="say" id="rvSay" type="button" aria-label="발음 듣기">🔊</button></div>
    ${d.sentence ? `<div class="sent">${hiSentence(d.sentence, d.text)}</div>` : ''}${d.title ? `<div class="ttl">${esc(d.title)}</div>` : ''}`;
  const dfs = defsOf(d).slice(0, 2);
  const back = rv.shown ? `<hr style="border:0;border-top:1px solid var(--line);width:100%">
    <div>${badge(d)}</div>${d.ipa ? `<div class="ipa">${esc(d.ipa)}</div>` : ''}${koHtml(d)}
    ${dfs.map(x => `<div class="en">${esc(x.en)}</div>`).join('')}${d.sentenceKo ? `<div class="ko-s">${esc(d.sentenceKo)}</div>` : ''}` : '';
  const g = [[0, '다시'], [3, '어려움'], [4, '좋음'], [5, '쉬움']];
  app.innerHTML = `<div class="rv-top"><button id="rvExit" type="button">← 나가기</button><span>${Math.min(rv.done + 1, rv.total)} / ${rv.total}</span></div>
  <div class="bar"><i style="width:${Math.round(rv.done / rv.total * 100)}%"></i></div>
  <div class="card flash" id="flash">${front}${back}</div>
  ${rv.shown ? `<div class="grades">${g.map(([q, l]) => `<button class="g${q}" data-g="${q}" type="button">${l}<small>${preview(d.srs, q)}</small></button>`).join('')}</div>` : '<button class="btn" id="rvFlip" type="button">뜻 보기</button>'}`;
  $('#rvExit').onclick = () => { rv = null; render(); };
  $('#rvSay').onclick = e => { e.stopPropagation(); say(d); };
  const flip = () => { if (!rv.shown) { rv.shown = true; render(); } };
  if (!rv.shown) { $('#rvFlip').onclick = flip; $('#flash').onclick = flip; say(d); }
  else app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => gradeCard(key, +b.dataset.g));
}
function sm2(srs, q, now) {
  const s = Object.assign({ reps: 0, interval: 0, ease: 2.5 }, srs || {});
  if (q < 3) { s.reps = 0; s.interval = 0; s.due = now + 10 * 60000; }
  else {
    s.reps += 1;
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 6 : Math.round(s.interval * s.ease);
    s.ease = Math.max(1.3, s.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    s.due = now + s.interval * DAY;
  }
  return s;
}
function preview(srs, q) { const s = sm2(srs, q, 0); return q < 3 ? '10분' : s.interval + '일'; }
function gradeCard(key, q) {
  const w = store.words[key]; if (!w || !rv) return;
  const data = Object.assign({}, w.data); data.srs = sm2(w.data.srs, q, Date.now());
  changeWord(key, data, false);
  rv.done++; if (q < 3) rv.cards.push(key);
  rv.i++; rv.shown = false; render();
}

/* ---------- boot ---------- */
$('#btnLogout').onclick = async () => {
  if (Object.keys(store.queue).length) await flush();
  if (session) { raw('/auth/v1/logout', 'POST', undefined, session.access); lsDel('nv_data:' + session.uid); }
  session = null; lsDel('nv_session'); rv = null; store = { words: {}, queue: {}, cursor: '1970-01-01T00:00:00Z', last: 0 }; render();
};
window.addEventListener('online', () => sync());
window.addEventListener('focus', () => { if (session && !rv) sync(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session && !rv) sync(); });
if (session) loadStore();
render();
if (session) sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
