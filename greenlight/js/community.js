/* GREENLIGHT community: player reviews, comments, helpful votes, reports, points,
   badges, leaderboard and moderation on Supabase. Degrades to "Coming soon" when
   js/config.js has no Supabase URL/key. */
(() => {
'use strict';
const CFG = window.GREENLIGHT_CONFIG || {};
const ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const SB_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => GL.esc(s);
const ROUTES = new Set(['community', 'u', 'account', 'admin', 'guidelines', 'privacy']);
const PLATFORMS = { 'series-x': 'Xbox Series X', 'series-s': 'Xbox Series S', 'xbox-one': 'Xbox One', pc: 'PC', cloud: 'Cloud', handheld: 'Handheld PC' };
const PROS = ['Great story', 'Stunning visuals', 'Smooth performance', 'Fun co-op', 'Satisfying combat', 'Great soundtrack', 'Lots to do', 'Great value on Game Pass', 'Accessible', 'Replayable'];
const CONS = ['Performance issues', 'Buggy', 'Grindy', 'Too short', 'Repetitive', 'Weak story', 'Steep learning curve', 'Monetization', 'Needs more content', 'Online issues'];
const BODY_MIN = 60, BODY_MAX = 1500, CMT_MAX = 800, MIN_SHOW = 3;
const BADGES = [
  ['first-review', 'First Review', 'Post your first player review'],
  ['five-reviews', '5 Reviews', 'Post five player reviews'],
  ['helpful-10', 'Helpful ×10', 'Get ten helpful votes on your reviews'],
  ['specialist', 'Genre Specialist', 'Review three games in one genre'],
  ['talker', 'Conversation Starter', 'Post ten comments or replies'],
];

let sb = null, sbLoading = null, me = null, games = {}, stats = {}, statsAt = 0, statsLoading = null;
const cmState = { sort: 'helpful', editing: false };

/* ---------- helpers ---------- */
const initial = n => ((String(n || '?').match(/[A-Za-z0-9]/) || ['?'])[0]).toUpperCase();
const hue = n => { let h = 0; for (const c of String(n || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (n, cls = '') => `<span class="av ${cls}" style="--h:${hue(n)}" aria-hidden="true">${esc(initial(n))}</span>`;
const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`; return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const when = iso => `<time datetime="${esc(iso)}" title="${esc(new Date(iso).toLocaleString('en-US'))}">${esc(ago(iso))}</time>`;
const starsRO = (v, cls = '') => `<span class="rstars ${cls}" style="--v:${Number(v) || 0}" role="img" aria-label="${esc(v)} out of 5 stars"></span>`;
const fmtRating = v => Number(v).toFixed(1).replace(/\.0$/, '.0');
const errMsg = e => { const m = (e && (e.message || e.error_description || e.msg)) || 'Something went wrong. Please try again.';
  if (/duplicate key.*reviews_game_slug_user_id/i.test(m)) return 'You’ve already reviewed this game. Edit your review instead.';
  if (/duplicate key.*profiles_display_name/i.test(m)) return 'That display name is taken. Try another.';
  if (/duplicate key.*reports/i.test(m)) return 'You’ve already reported this.';
  if (/duplicate key.*helpful_votes/i.test(m)) return 'You already marked this helpful.';
  if (/violates check constraint "profiles_display_name_check"/i.test(m)) return 'Display names are 2–24 letters, numbers, spaces, dots, dashes or underscores.';
  if (/check constraint/i.test(m)) return 'Please check the form and try again.';
  if (/JWT|not authenticated|permission denied/i.test(m)) return 'Please sign in again.';
  return m; };
const soon = (what = 'Player reviews, comments and leaderboards') => `<div class="panel soon-panel"><span class="tagbadge soon">Coming soon</span><h3>${esc(what)} are on the way</h3><p class="muted">Soon you’ll be able to sign in with an email link, rate games out of five, vote reviews helpful and climb the monthly Top Reviewers board. Player reviews will always be clearly labelled as written by real players, separate from GREENLIGHT’s AI-assisted editorial reviews.</p><p class="muted" style="margin:0"><a href="#/guidelines">Community guidelines</a> · <a href="#/privacy">Privacy</a></p></div>`;
const page = (kicker, title, intro, body) => `<div class="page"><div class="wrap narrow"><header class="page-head"><span class="kicker">${esc(kicker)}</span><h1>${esc(title)}</h1>${intro ? `<p>${intro}</p>` : ''}</header>${body}</div></div>${GL.footer()}`;
const toast = (msg, bad = false) => { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 3200); };
const goSignIn = () => { sessionStorage.setItem('gl-return', location.hash || '#/'); location.hash = '#/account'; };
const rerender = () => { const a = $('#app'); if (a) a.dataset.route = ''; GL.route(); };

/* ---------- Supabase ---------- */
function rest(path) {
  return fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, { headers: { apikey: CFG.supabaseAnonKey } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
}
function restRpc(fn, args) {
  return fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
}
function client() {
  if (sb) return Promise.resolve(sb);
  if (sbLoading) return sbLoading;
  sbLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = SB_SRC; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => rej(new Error('Could not load the sign-in library.')); document.head.append(s);
  }).then(async () => {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'gl-auth' } });
    const { data } = await sb.auth.getSession();
    await setMe(data.session);
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') {
        const before = me && me.id; setMe(session).then(() => { if ((me && me.id) !== before) rerender(); });
      }
    });
    return sb;
  });
  return sbLoading;
}
async function setMe(session) {
  if (!session) { me = null; header(); return; }
  const { data } = await sb.from('profiles').select('id,display_name,is_admin').eq('id', session.user.id).maybeSingle();
  me = data ? { ...data, email: session.user.email } : { id: session.user.id, display_name: 'Player', is_admin: false, email: session.user.email };
  header();
}
function loadStats(force = false, ttl = 60000) {
  if (!ON) return Promise.resolve();
  if (!force && Date.now() - statsAt < ttl) return Promise.resolve();
  if (statsLoading && !force) return statsLoading;
  statsLoading = Promise.all([rest('game_stats?select=*'), Object.keys(games).length ? null : rest('games?select=slug,title,genres,reviewable,opens_on')])
    .then(([s, g]) => { stats = {}; s.forEach(x => stats[x.game_slug] = x); if (g) g.forEach(x => games[x.slug] = x); statsAt = Date.now(); })
    .catch(e => console.warn('community stats', e.message)).finally(() => statsLoading = null);
  return statsLoading;
}

/* ---------- header / nav ---------- */
function header() {
  const a = $('#acct'); if (!a) return;
  if (!ON) { a.hidden = true; return; }
  a.hidden = false;
  if (me) { a.innerHTML = avatar(me.display_name, 'sm'); a.setAttribute('aria-label', `Your account: ${me.display_name}`); a.classList.add('in'); }
  else { a.innerHTML = '<span>Sign in</span>'; a.setAttribute('aria-label', 'Sign in'); a.classList.remove('in'); }
}
function navInit() {
  if (!ON) return;
  document.body.classList.add('cm-on');
  const t = $('.tabbar a[data-nav="sources"]');
  if (t) { t.href = '#/community'; t.dataset.nav = 'community'; t.querySelector('span').textContent = 'Players';
    t.querySelector('svg').innerHTML = '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6"/>'; }
  const src = $('.topnav a[data-nav="sources"]');
  if (src && !$('.topnav a[data-nav="community"]')) { const c = document.createElement('a'); c.href = '#/community'; c.dataset.nav = 'community'; c.textContent = 'Community'; src.before(c); }
  header();
}

/* ---------- player score badges ---------- */
function pbadgeHtml(slug) {
  if (!ON) return `<div class="pscore soon"><span class="pnum" aria-hidden="true">★</span><span class="plab"><b>Player score</b>Coming soon</span></div>`;
  const s = stats[slug]; if (!s) return `<div class="pscore pending skel" aria-hidden="true"><span class="pnum">…</span><span class="plab"><b>Player score</b>Loading…</span></div>`;
  const n = s.review_count;
  if (s.show_score) return `<a class="pscore" href="#community" data-scroll="community"><span class="pnum">${fmtRating(s.avg_rating)}<small>/5</small></span><span class="plab"><b>Player score</b>${starsRO(s.avg_rating, 'xs')}${n} player review${n === 1 ? '' : 's'}</span></a>`;
  return `<a class="pscore pending" href="#community" data-scroll="community"><span class="pnum" aria-hidden="true">${n}<small>/${MIN_SHOW}</small></span><span class="plab"><b>Player score</b>${n === 0 ? 'Be the first to review' : `Need ${MIN_SHOW} reviews · ${n} so far`}</span></a>`;
}
function pminiHtml(slug) {
  const s = stats[slug]; if (!s) return '';
  if (s.show_score) return `<span class="pmini" title="Player score from ${s.review_count} reviews"><span class="sr-only">Player score </span><i aria-hidden="true">★</i>${fmtRating(s.avg_rating)}<span class="sr-only"> out of 5 from</span><small>${s.review_count}</small><span class="sr-only"> player reviews</span></span>`;
  return `<span class="pmini pending"><span class="sr-only">Player score: </span>${s.review_count === 0 ? 'Be first' : `${s.review_count}/${MIN_SHOW} players`}<span class="sr-only">${s.review_count === 0 ? ' to review' : ` needed for a score`}</span></span>`;
}
function fillBadges(root) {
  $$('[data-pbadge]', root).forEach(el => el.innerHTML = pbadgeHtml(el.dataset.pbadge));
  $$('[data-pmini]', root).forEach(el => { const h = ON ? pminiHtml(el.dataset.pmini) : ''; el.innerHTML = h; el.hidden = !h; });
}

/* ---------- game page community section ---------- */
async function renderCommunity(sec) {
  const slug = sec.dataset.game, body = $('.cm-body', sec);
  if (!ON) { body.innerHTML = soon(); return; }
  body.innerHTML = '<p class="muted cm-loading">Loading player reviews…</p>';
  try { await Promise.all([client(), loadStats(true)]); fillBadges(document); } catch (e) { body.innerHTML = `<div class="panel"><p>${esc(errMsg(e))}</p></div>`; return; }
  const [rv, cm, votes, reps] = await Promise.all([
    sb.from('review_feed').select('*').eq('game_slug', slug),
    sb.from('comment_feed').select('*').eq('game_slug', slug).order('created_at', { ascending: true }),
    me ? sb.from('helpful_votes').select('review_id').eq('user_id', me.id) : { data: [] },
    me ? sb.from('reports').select('target_type,target_id').eq('user_id', me.id) : { data: [] },
  ]);
  if (rv.error || cm.error) { body.innerHTML = `<div class="panel"><p>${esc(errMsg(rv.error || cm.error))}</p></div>`; return; }
  const voted = new Set((votes.data || []).map(v => v.review_id));
  const reported = new Set((reps.data || []).map(r => `${r.target_type}:${r.target_id}`));
  const reviews = rv.data, mine = me && reviews.find(r => r.user_id === me.id);
  const visible = reviews.filter(r => r.status === 'visible');
  const s = stats[slug] || { review_count: visible.length, avg_rating: null, show_score: false };
  const dist = [5, 4, 3, 2, 1].map(k => ({ k, n: visible.filter(r => Math.ceil(r.rating) === k).length }));
  const g = games[slug] || {}; const today = new Date().toISOString().slice(0, 10);
  const closed = g.opens_on && g.opens_on > today;
  const sorted = [...reviews].sort(cmState.sort === 'newest' ? (a, b) => b.created_at.localeCompare(a.created_at) : (a, b) => b.helpful_count - a.helpful_count || b.created_at.localeCompare(a.created_at));
  body.innerHTML = `
    <p class="cm-label"><span class="ai-dot human" aria-hidden="true"></span><span><strong>Written by real players.</strong> Player reviews come from signed-in GREENLIGHT readers, not our editorial team or AI. <a href="#/guidelines">Guidelines</a></span></p>
    <div class="cm-top">
      <div class="panel cm-summary">${s.show_score
        ? `<div class="cm-big"><span class="pnum">${fmtRating(s.avg_rating)}<small>/5</small></span><div>${starsRO(s.avg_rating)}<p class="muted">${s.review_count} player reviews</p></div></div>`
        : `<div class="cm-big"><span class="pnum dim">–</span><div><p><strong>${s.review_count === 0 ? 'Be the first to review' : `Need ${MIN_SHOW} reviews to show a player score`}</strong></p><p class="muted">${s.review_count} of ${MIN_SHOW} so far</p></div></div>`}
        <ul class="dist" aria-label="Rating distribution">${dist.map(d => `<li><span>${d.k}★</span><span class="bar"><i style="width:${visible.length ? Math.round(d.n / visible.length * 100) : 0}%"></i></span><span>${d.n}</span></li>`).join('')}</ul>
      </div>
      <div class="cm-formwrap" id="cmForm">${formArea(slug, mine, closed, g)}</div>
    </div>
    <div class="cm-bar"><h3 class="cm-h">${reviews.length ? `${visible.length} review${visible.length === 1 ? '' : 's'}` : 'No player reviews yet'}</h3>
      ${reviews.length > 1 ? `<div class="seg" role="group" aria-label="Sort reviews"><button type="button" data-sort="helpful" aria-pressed="${cmState.sort === 'helpful'}">Most helpful</button><button type="button" data-sort="newest" aria-pressed="${cmState.sort === 'newest'}">Newest</button></div>` : ''}</div>
    <ul class="rlist">${sorted.map(r => reviewItem(r, voted, reported)).join('')}</ul>
    <section class="comments" aria-labelledby="cm-ch"><h3 class="cm-h" id="cm-ch">Comments <span class="muted">${cm.data.filter(c => c.status === 'visible').length}</span></h3>
      ${me ? commentForm(null) : `<div class="panel signin-cta"><p>Sign in to join the conversation.</p><button type="button" class="btn btn-ghost" data-act="signin">Sign in</button></div>`}
      <ol class="clist">${threads(cm.data).map(c => commentItem(c, reported)).join('') || '<li class="muted empty">No comments yet. Start the conversation.</li>'}</ol>
    </section>`;
  bindCommunity(sec, slug, reviews, mine);
}
function formArea(slug, mine, closed, g) {
  if (!me) return `<div class="panel signin-cta"><h3>Played it?</h3><p>Sign in with a one-time email link to rate ${esc(g.title || 'this game')}, add your hours and platform, and share a short review.</p><button type="button" class="btn btn-primary" data-act="signin">Sign in to review</button></div>`;
  if (closed) return `<div class="panel signin-cta"><h3>Reviews open on release day</h3><p>Player reviews for ${esc(g.title)} open on ${esc(GL.fmtDateLong(g.opens_on))}.</p></div>`;
  if (mine && !cmState.editing) return `<div class="panel mine"><h3>Your review</h3><p class="muted">You rated it ${starsRO(mine.rating, 'xs')} <strong>${fmtRating(mine.rating)}/5</strong> after ${mine.hours}h on ${esc(PLATFORMS[mine.platform])}.${mine.status !== 'visible' ? ' <span class="hidden-note">Hidden pending moderation</span>' : ''}</p>
    <div class="btnrow"><button type="button" class="btn btn-ghost" data-act="edit">Edit review</button><button type="button" class="btn btn-danger" data-act="delete-review" data-id="${mine.id}">Delete</button></div></div>`;
  return reviewForm(mine);
}
function reviewForm(r) {
  const v = r ? Number(r.rating) : 0;
  return `<form class="panel rform" id="rform" novalidate aria-labelledby="rform-h">
    <h3 id="rform-h">${r ? 'Edit your review' : 'Write a player review'}</h3>
    <fieldset class="stars-in"><legend>Your rating <span class="req">(required)</span></legend>
      <div class="stars" style="--v:${v}"><div class="stars-hit">${[...Array(10)].map((_, i) => { const x = (i + 1) / 2; return `<input type="radio" name="rating" id="rt${i}" value="${x}" ${x === v ? 'checked' : ''}><label for="rt${i}" data-v="${x}"><span class="sr-only">${x} star${x === 1 ? '' : 's'}</span></label>`; }).join('')}</div></div>
      <output class="stars-val" id="starsVal">${v ? `${fmtRating(v)} / 5` : 'Tap a star (half stars OK)'}</output></fieldset>
    <div class="fg2">
      <label class="field"><span>Hours played</span><input type="number" name="hours" inputmode="numeric" min="0" max="5000" step="1" required value="${r ? r.hours : ''}" placeholder="e.g. 12"></label>
      <label class="field"><span>Played on</span><div class="selectwrap"><select name="platform" required><option value="">Choose…</option>${Object.entries(PLATFORMS).map(([k, n]) => `<option value="${k}" ${r && r.platform === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div></label>
    </div>
    <label class="field"><span>Your review <span class="muted" id="bodyCount">0 / ${BODY_MAX}</span></span><textarea name="body" rows="5" minlength="${BODY_MIN}" maxlength="${BODY_MAX}" required placeholder="What worked, what didn’t, and who should play it? (${BODY_MIN}–${BODY_MAX} characters)">${esc(r ? r.body : '')}</textarea></label>
    <fieldset class="tags"><legend>Pros <span class="muted">(up to 4)</span></legend><div class="tchips">${PROS.map(t => `<label class="tchip pro"><input type="checkbox" name="pros" value="${esc(t)}" ${r && r.pros.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></fieldset>
    <fieldset class="tags"><legend>Cons <span class="muted">(up to 4)</span></legend><div class="tchips">${CONS.map(t => `<label class="tchip con"><input type="checkbox" name="cons" value="${esc(t)}" ${r && r.cons.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></fieldset>
    <p class="ferr" id="rformErr" role="alert"></p>
    <div class="btnrow"><button class="btn btn-primary" type="submit">${r ? 'Save changes' : 'Post review'}</button>${r ? '<button type="button" class="btn btn-ghost" data-act="cancel-edit">Cancel</button>' : ''}</div>
    <p class="muted small">Posting as <strong>${esc(me.display_name)}</strong> · one review per game · you can edit or delete it any time. <a href="#/guidelines">Guidelines</a></p>
  </form>`;
}
function reviewItem(r, voted, reported) {
  const own = me && r.user_id === me.id, rep = reported.has(`review:${r.id}`);
  const edited = new Date(r.updated_at) - new Date(r.created_at) > 60000;
  return `<li class="rv panel ${r.status !== 'visible' ? 'is-hidden' : ''}" id="rv-${r.id}">
    <header class="rv-h">${avatar(r.display_name)}<div><a class="who" href="#/u/${r.user_id}">${esc(r.display_name)}</a>${own ? ' <span class="you">You</span>' : ''}
      <div class="rv-meta">${starsRO(r.rating, 'xs')}<b>${fmtRating(r.rating)}</b><span>${esc(PLATFORMS[r.platform])}</span><span>${r.hours}h played</span><span>${when(r.created_at)}${edited ? ' · edited' : ''}</span></div></div></header>
    ${r.status !== 'visible' ? '<p class="hidden-note">Hidden pending moderation. Only you can see this.</p>' : ''}
    <p class="rv-body">${esc(r.body)}</p>
    ${r.pros.length || r.cons.length ? `<div class="rv-tags">${r.pros.map(t => `<span class="tg pro">+ ${esc(t)}</span>`).join('')}${r.cons.map(t => `<span class="tg con">− ${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="rv-act">
      <button type="button" class="hbtn" data-act="helpful" data-id="${r.id}" aria-pressed="${voted.has(r.id)}" ${own || r.status !== 'visible' ? 'disabled' : ''} aria-label="Mark helpful (${r.helpful_count})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg>Helpful<span class="n">${r.helpful_count}</span></button>
      ${own ? `<button type="button" class="linkbtn" data-act="edit">Edit</button><button type="button" class="linkbtn danger" data-act="delete-review" data-id="${r.id}">Delete</button>`
        : `<button type="button" class="linkbtn subtle" data-act="report" data-type="review" data-id="${r.id}" ${rep ? 'disabled' : ''}>${rep ? 'Reported' : 'Report'}</button>`}
    </div></li>`;
}
function threads(list) {
  const top = list.filter(c => !c.parent_id), kids = {};
  list.filter(c => c.parent_id).forEach(c => (kids[c.parent_id] = kids[c.parent_id] || []).push(c));
  return top.map(c => ({ ...c, replies: kids[c.id] || [] })).filter(c => c.status !== 'deleted' || c.replies.length).reverse();
}
function commentItem(c, reported, isReply = false) {
  const own = me && c.user_id === me.id, dead = c.status === 'deleted', rep = reported.has(`comment:${c.id}`);
  const inner = dead ? `<p class="muted c-dead">Comment deleted</p>` : `<header class="c-h">${avatar(c.display_name, 'sm')}<a class="who" href="#/u/${c.user_id}">${esc(c.display_name)}</a>${own ? '<span class="you">You</span>' : ''}<span class="muted">${when(c.created_at)}</span></header>
    ${c.status === 'hidden' || c.status === 'removed' ? '<p class="hidden-note">Hidden pending moderation. Only you can see this.</p>' : ''}
    <p class="c-body">${esc(c.body)}</p>
    <div class="c-act">${!isReply && me && c.status === 'visible' ? `<button type="button" class="linkbtn" data-act="reply" data-id="${c.id}" aria-expanded="false">Reply</button>` : ''}
      ${own ? `<button type="button" class="linkbtn danger" data-act="delete-comment" data-id="${c.id}">Delete</button>` : (me ? `<button type="button" class="linkbtn subtle" data-act="report" data-type="comment" data-id="${c.id}" ${rep ? 'disabled' : ''}>${rep ? 'Reported' : 'Report'}</button>` : '')}</div>`;
  return `<li class="c" id="c-${c.id}">${inner}${!isReply ? `<div class="reply-slot"></div>${c.replies.length ? `<ol class="replies">${c.replies.map(x => commentItem(x, reported, true)).join('')}</ol>` : ''}` : ''}</li>`;
}
const commentForm = parent => `<form class="cform" data-parent="${parent || ''}" novalidate><label class="sr-only" for="cf-${parent || 'top'}">${parent ? 'Your reply' : 'Add a comment'}</label>
  <textarea id="cf-${parent || 'top'}" name="body" rows="${parent ? 2 : 3}" maxlength="${CMT_MAX}" placeholder="${parent ? 'Write a reply…' : 'Add a comment…'}" required></textarea>
  <div class="cform-row"><p class="ferr" role="alert"></p><button class="btn btn-primary sm" type="submit">${parent ? 'Reply' : 'Post comment'}</button></div></form>`;

function bindCommunity(sec, slug, reviews, mine) {
  const refresh = async () => { await loadStats(true); fillBadges(document); await renderCommunity(sec); };
  const form = $('#rform', sec);
  if (form) bindReviewForm(form, slug, mine, async () => { cmState.editing = false; await refresh(); toast(mine ? 'Review updated' : 'Review posted. +10 points'); $('#cmForm', sec)?.scrollIntoView({ block: 'nearest' }); });
  sec.onclick = async e => {
    const b = e.target.closest('[data-act],[data-sort]'); if (!b || b.disabled) return;
    if (b.dataset.sort) { cmState.sort = b.dataset.sort; return renderCommunity(sec); }
    const act = b.dataset.act, id = Number(b.dataset.id);
    if (act === 'signin') return goSignIn();
    if (!me) return goSignIn();
    try {
      if (act === 'edit') { cmState.editing = true; $('#cmForm', sec).innerHTML = reviewForm(mine); bindReviewForm($('#rform', sec), slug, mine, async () => { cmState.editing = false; await refresh(); toast('Review updated'); }); $('#rform', sec).scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#rform input[name="rating"]:checked, #rform input[name="rating"]', sec).focus({ preventScroll: true }); }
      else if (act === 'cancel-edit') { cmState.editing = false; await renderCommunity(sec); }
      else if (act === 'delete-review') { if (!confirm('Delete your review? This also removes its points and helpful votes.')) return; const { error } = await sb.from('reviews').delete().eq('id', id); if (error) throw error; cmState.editing = false; await refresh(); toast('Review deleted'); }
      else if (act === 'helpful') { const on = b.getAttribute('aria-pressed') === 'true';
        const { error } = on ? await sb.from('helpful_votes').delete().eq('review_id', id).eq('user_id', me.id) : await sb.from('helpful_votes').insert({ review_id: id });
        if (error) throw error; const n = $('.n', b); n.textContent = Number(n.textContent) + (on ? -1 : 1); b.setAttribute('aria-pressed', String(!on)); b.setAttribute('aria-label', `Mark helpful (${n.textContent})`); }
      else if (act === 'report') { const ok = await reportDialog(b.dataset.type, id); if (ok) { b.textContent = 'Reported'; b.disabled = true; toast('Thanks. A moderator will take a look.'); } }
      else if (act === 'reply') { const li = b.closest('.c'), slot = $('.reply-slot', li); const open = b.getAttribute('aria-expanded') === 'true';
        slot.innerHTML = open ? '' : commentForm(id); b.setAttribute('aria-expanded', String(!open)); if (!open) { bindCommentForm($('form', slot), slug, refresh); $('textarea', slot).focus(); } }
      else if (act === 'delete-comment') { if (!confirm('Delete this comment?')) return; const { error } = await sb.from('comments').delete().eq('id', id); if (error) throw error; await refresh(); toast('Comment deleted'); }
    } catch (err) { toast(errMsg(err), true); }
  };
  const top = $('.comments > .cform', sec); if (top) bindCommentForm(top, slug, refresh);
}
function bindCommentForm(f, slug, done) {
  f.addEventListener('submit', async e => {
    e.preventDefault(); const t = f.body.value.trim(), err = $('.ferr', f), btn = $('button[type=submit]', f);
    if (t.length < 2) { err.textContent = 'Write at least 2 characters.'; return; }
    btn.disabled = true; err.textContent = '';
    const row = { game_slug: slug, body: t }; if (f.dataset.parent) row.parent_id = Number(f.dataset.parent);
    const { error } = await sb.from('comments').insert(row);
    btn.disabled = false;
    if (error) { err.textContent = errMsg(error); return; }
    await done(); toast(f.dataset.parent ? 'Reply posted' : 'Comment posted');
  });
}
function bindReviewForm(form, slug, mine, done) {
  const stars = $('.stars', form), out = $('#starsVal', form), ta = form.body, cnt = $('#bodyCount', form), err = $('#rformErr', form);
  const cur = () => Number(($('input[name=rating]:checked', form) || {}).value || 0);
  const show = v => { stars.style.setProperty('--v', v); };
  $$('label[data-v]', stars).forEach(l => { l.addEventListener('pointerenter', () => show(l.dataset.v)); l.addEventListener('pointerleave', () => show(cur())); });
  const limit = k => { const n = $$(`input[name=${k}]:checked`, form).length;
    $$(`input[name=${k}]`, form).forEach(i => { i.disabled = !i.checked && n >= 4; i.closest('.tchip').classList.toggle('off', i.disabled); }); };
  form.addEventListener('change', e => {
    if (e.target.name === 'rating') { show(cur()); out.textContent = `${fmtRating(cur())} / 5`; }
    if (e.target.name === 'pros' || e.target.name === 'cons') limit(e.target.name);
  });
  limit('pros'); limit('cons');
  const count = () => { const n = ta.value.trim().length; cnt.textContent = `${n} / ${BODY_MAX}`; cnt.classList.toggle('bad', n > 0 && n < BODY_MIN); };
  ta.addEventListener('input', count); count();
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const rating = cur(), hours = form.hours.value === '' ? NaN : Number(form.hours.value), platform = form.platform.value, body = ta.value.trim();
    const problems = [];
    if (!rating) problems.push('pick a star rating');
    if (!Number.isInteger(hours) || hours < 0 || hours > 5000) problems.push('enter hours played (0–5000)');
    if (!platform) problems.push('choose a platform');
    if (body.length < BODY_MIN) problems.push(`write at least ${BODY_MIN} characters (${body.length} so far)`);
    if (problems.length) { err.textContent = 'Please ' + problems.join(', ') + '.'; return; }
    const row = { rating, hours, platform, body, pros: $$('input[name=pros]:checked', form).map(i => i.value), cons: $$('input[name=cons]:checked', form).map(i => i.value) };
    const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = mine ? 'Saving…' : 'Posting…';
    const { error } = mine ? await sb.from('reviews').update(row).eq('id', mine.id) : await sb.from('reviews').insert({ ...row, game_slug: slug });
    btn.disabled = false; btn.textContent = mine ? 'Save changes' : 'Post review';
    if (error) { err.textContent = errMsg(error); return; }
    await done();
  });
}

/* ---------- report dialog ---------- */
function reportDialog(type, id) {
  let d = $('#reportDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'reportDlg'; d.className = 'rdlg'; d.setAttribute('aria-labelledby', 'rdlg-h');
    d.innerHTML = `<form method="dialog" class="panel"><h2 id="rdlg-h">Report this post</h2><p class="muted small">Posts hide automatically after several reports while a moderator reviews them.</p>
      <fieldset><legend class="sr-only">Reason</legend>${[['spam', 'Spam or advertising'], ['abuse', 'Abusive, hateful or harassing'], ['spoilers', 'Unmarked spoilers'], ['off-topic', 'Off-topic'], ['other', 'Something else']].map(([v, l], i) => `<label class="radio"><input type="radio" name="reason" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
      <label class="field"><span>Note for moderators <span class="muted">(optional)</span></span><input name="note" maxlength="300"></label>
      <p class="ferr" role="alert"></p><div class="btnrow"><button class="btn btn-primary" value="send">Send report</button><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button></div></form>`;
    document.body.append(d); }
  const f = $('form', d); f.reset(); $('.ferr', d).textContent = '';
  return new Promise(res => {
    const onSubmit = async e => {
      e.preventDefault(); const btn = e.submitter;
      if (!btn || btn.value !== 'send') { cleanup(); d.close(); return res(false); }
      const { error } = await sb.from('reports').insert({ target_type: type, target_id: id, reason: f.reason.value, note: f.note.value.trim() || null });
      if (error) { $('.ferr', d).textContent = errMsg(error); return; }
      cleanup(); d.close(); res(true);
    };
    const onClose = () => { cleanup(); res(false); };
    const cleanup = () => { f.removeEventListener('submit', onSubmit); d.removeEventListener('close', onClose); };
    f.addEventListener('submit', onSubmit); d.addEventListener('close', onClose, { once: true });
    d.showModal();
  });
}

/* ---------- pages ---------- */
function viewAccount() {
  const html = page('Community', 'Your account', '', '<div id="acctBody"><p class="muted">Loading…</p></div>');
  return { html, title: 'Account · GREENLIGHT', nav: 'community', bind: () => { if (!ON) { $('#acctBody').innerHTML = soon('Player accounts'); return; } client().then(renderAccount).catch(e => $('#acctBody').innerHTML = `<p>${esc(errMsg(e))}</p>`); } };
}
async function renderAccount() {
  const box = $('#acctBody'); if (!box) return;
  if (!me) {
    const ret = sessionStorage.getItem('gl-return');
    box.innerHTML = `<div class="panel auth">
      <h2>Sign in or create an account</h2><p class="muted">We’ll email you a one-time sign-in link. No password needed. New here? The same link creates your account.</p>
      <form id="magic" novalidate><label class="field"><span>Email address</span><input type="email" name="email" autocomplete="email" inputmode="email" required placeholder="you@example.com"></label>
        <p class="ferr" role="alert"></p><button class="btn btn-primary wide" type="submit">Email me a sign-in link</button></form>
      ${CFG.oauth && (CFG.oauth.github || CFG.oauth.google) ? `<div class="or"><span>or</span></div><div class="oauth">${CFG.oauth.github ? '<button type="button" class="btn btn-ghost wide" data-oauth="github">Continue with GitHub</button>' : ''}${CFG.oauth.google ? '<button type="button" class="btn btn-ghost wide" data-oauth="google">Continue with Google</button>' : ''}</div>` : ''}
      <p class="muted small">By signing in you agree to the <a href="#/guidelines">community guidelines</a>. Your email is never shown publicly. <a href="#/privacy">Privacy</a></p>
      ${ret ? `<p class="small"><a href="${esc(ret)}">← Back to where you were</a></p>` : ''}</div>`;
    const f = $('#magic');
    f.addEventListener('submit', async e => { e.preventDefault(); const email = f.email.value.trim(), er = $('.ferr', f);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { er.textContent = 'Enter a valid email address.'; return; }
      const b = $('button', f); b.disabled = true; b.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      b.disabled = false; b.textContent = 'Email me a sign-in link';
      if (error) { er.textContent = errMsg(error); return; }
      box.innerHTML = `<div class="panel auth sent"><h2>Check your inbox</h2><p>We sent a sign-in link to <strong>${esc(email)}</strong>. Open it on this device to finish signing in. It expires in an hour.</p><p class="muted small">Nothing arrived? Check spam, or <button type="button" class="linkbtn" id="again">try again</button>.</p></div>`;
      $('#again').onclick = renderAccount; });
    $$('[data-oauth]', box).forEach(b => b.onclick = () => sb.auth.signInWithOAuth({ provider: b.dataset.oauth, options: { redirectTo: location.origin + location.pathname } }));
    return;
  }
  const { data: st } = await sb.from('user_stats').select('*').eq('user_id', me.id).maybeSingle();
  box.innerHTML = `<div class="panel acct-card"><div class="acct-id">${avatar(me.display_name, 'lg')}<div><h2>${esc(me.display_name)}</h2><p class="muted small">Signed in as ${esc(me.email || '')} (private)</p></div></div>
      <div class="stat-row"><div><b>${st ? st.points : 0}</b><span>Points</span></div><div><b>${st ? st.reviews : 0}</b><span>Reviews</span></div><div><b>${st ? st.helpful_received : 0}</b><span>Helpful votes</span></div></div>
      <form id="nameForm" novalidate><label class="field"><span>Display name <span class="muted">(public, 2–24 characters)</span></span><input name="name" maxlength="24" value="${esc(me.display_name)}" autocomplete="nickname"></label><p class="ferr" role="alert"></p><button class="btn btn-primary" type="submit">Save name</button></form>
      <div class="btnrow"><a class="btn btn-ghost" href="#/u/${me.id}">View my profile</a>${me.is_admin ? '<a class="btn btn-ghost" href="#/admin">Moderation queue</a>' : ''}<button type="button" class="btn btn-ghost" id="signout">Sign out</button></div>
      <details class="danger-zone"><summary>Delete my community posts</summary><p class="muted small">Removes all your reviews, comments and helpful votes. To delete the account itself, see <a href="#/privacy">Privacy</a>.</p><button type="button" class="btn btn-danger" id="wipe">Delete all my posts</button></details></div>`;
  const nf = $('#nameForm');
  nf.addEventListener('submit', async e => { e.preventDefault(); const v = nf.name.value.trim(), er = $('.ferr', nf);
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,22}[A-Za-z0-9]$/.test(v)) { er.textContent = 'Use 2–24 letters, numbers, spaces, dots, dashes or underscores (start and end with a letter or number).'; return; }
    const { error } = await sb.from('profiles').update({ display_name: v }).eq('id', me.id);
    if (error) { er.textContent = errMsg(error); return; }
    me.display_name = v; header(); toast('Display name saved'); renderAccount(); });
  $('#signout').onclick = async () => { await sb.auth.signOut(); toast('Signed out'); };
  $('#wipe').onclick = async () => { if (!confirm('Delete all your reviews, comments and votes? This can’t be undone.')) return;
    const r = await Promise.all([sb.from('reviews').delete().eq('user_id', me.id), sb.from('helpful_votes').delete().eq('user_id', me.id)]);
    const c = await sb.from('comments').delete().eq('user_id', me.id);
    const e = r.concat([c]).find(x => x.error); if (e) toast(errMsg(e.error), true); else { toast('Your posts were deleted'); loadStats(true); renderAccount(); } };
  const ret = sessionStorage.getItem('gl-return');
  if (ret && ret !== '#/account') { sessionStorage.removeItem('gl-return'); location.hash = ret; }
}

function viewProfile(id) {
  const html = page('Player profile', 'Profile', '', '<div id="profBody"><p class="muted">Loading…</p></div>');
  return { html, title: 'Player profile · GREENLIGHT', nav: 'community', bind: () => { if (!ON) { $('#profBody').innerHTML = soon('Player profiles'); return; } client().then(() => renderProfile(id)); } };
}
async function renderProfile(id) {
  const box = $('#profBody'); if (!box) return;
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) { box.innerHTML = '<p>Player not found.</p>'; return; }
  const [st, bd, rv] = await Promise.all([sb.from('user_stats').select('*').eq('user_id', id).maybeSingle(), sb.from('user_badges').select('*').eq('user_id', id),
    sb.from('review_feed').select('*').eq('user_id', id).eq('status', 'visible').order('created_at', { ascending: false })]);
  if (!st.data) { box.innerHTML = '<p>Player not found.</p>'; return; }
  const u = st.data, earned = new Map((bd.data || []).map(b => [b.code, b]));
  const h1 = $('.page-head h1'); if (h1) h1.textContent = u.display_name; document.title = `${u.display_name} · GREENLIGHT`;
  box.innerHTML = `<div class="panel acct-card"><div class="acct-id">${avatar(u.display_name, 'lg')}<div><h2>${esc(u.display_name)}${me && me.id === id ? ' <span class="you">You</span>' : ''}</h2><p class="muted small">Member since ${esc(new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</p></div></div>
    <div class="stat-row"><div><b>${u.points}</b><span>Points</span></div><div><b>${u.reviews}</b><span>Reviews</span></div><div><b>${u.helpful_received}</b><span>Helpful votes</span></div><div><b>${u.comments}</b><span>Comments</span></div></div></div>
    <section class="section"><h2 class="sec-h">Badges</h2><ul class="badges">${BADGES.map(([c, n, how]) => { const b = earned.get(c); return `<li class="bdg ${b ? 'got' : ''}"><span class="bdg-i" aria-hidden="true">${b ? '★' : '☆'}</span><div><b>${esc(n)}</b><span>${esc(b ? (c === 'specialist' ? b.description.replace(/: (.*)$/, (m, gs) => ': ' + gs.split(', ').map(GL.genreName).join(', ')) : b.description) : how)}</span></div><span class="sr-only">${b ? 'Earned' : 'Not earned yet'}</span></li>`; }).join('')}</ul></section>
    <section class="section"><h2 class="sec-h">Reviews</h2>${rv.data.length ? `<ul class="rlist">${rv.data.map(r => `<li class="rv panel"><header class="rv-h"><div><a class="who" href="#/review/${esc(r.game_slug)}">${esc(r.game_title)}</a><div class="rv-meta">${starsRO(r.rating, 'xs')}<b>${fmtRating(r.rating)}</b><span>${esc(PLATFORMS[r.platform])}</span><span>${r.hours}h</span><span>${when(r.created_at)}</span><span>${r.helpful_count} helpful</span></div></div></header><p class="rv-body">${esc(r.body)}</p></li>`).join('')}</ul>` : '<p class="muted">No reviews yet.</p>'}</section>`;
}

const monthLabel = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function viewCommunity(q) {
  const now = new Date(), cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let m = cur; if (/^\d{4}-\d{2}$/.test(q.m || '')) { const [y, mm] = q.m.split('-').map(Number); const t = new Date(Date.UTC(y, mm - 1, 1)); if (t <= cur) m = t; }
  const key = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)), next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  const html = page('Community', 'Top reviewers', 'The most helpful GREENLIGHT players this month. Points come from player reviews and the helpful votes they earn, never from editorial content.', `
    ${ON ? `<nav class="month" aria-label="Leaderboard month"><a class="btn btn-ghost sm" href="#/community?m=${key(prev)}" aria-label="Previous month">‹</a><h2>${esc(monthLabel(m))}</h2>${next <= cur ? `<a class="btn btn-ghost sm" href="#/community?m=${key(next)}" aria-label="Next month">›</a>` : '<span class="btn btn-ghost sm" aria-hidden="true" style="visibility:hidden">›</span>'}</nav>
    <div class="cgrid"><div id="lbBody" class="panel"><p class="muted">Loading…</p></div>
    <aside><div class="panel"><h2 class="sec-h">How points work</h2><ul class="pts"><li><b>+10</b> Post a player review</li><li><b>+2</b> Each helpful vote your review gets</li><li><b>+1</b> Each comment or reply</li></ul><p class="muted small">Hidden or removed posts earn nothing. Monthly totals reset on the 1st (UTC).</p></div>
      <div class="panel" style="margin-top:14px"><h2 class="sec-h">Badges</h2><ul class="badges compact">${BADGES.map(([c, n, how]) => `<li class="bdg"><span class="bdg-i" aria-hidden="true">★</span><div><b>${esc(n)}</b><span>${esc(how)}</span></div></li>`).join('')}</ul></div>
      <p class="small" style="margin-top:14px"><a href="#/account">Your account</a> · <a href="#/guidelines">Guidelines</a> · <a href="#/privacy">Privacy</a></p></aside></div>
    <section class="section"><h2 class="sec-h">Latest player reviews</h2><ul class="rlist" id="latest"></ul></section>` : soon()}`);
  return { html, title: 'Top reviewers · GREENLIGHT', nav: 'community', bind: ON ? () => renderBoard(key(m)) : null };
}
async function renderBoard(mkey) {
  const wrap = pr => pr.then(data => ({ data }), error => ({ error, data: [] }));
  const [lb, lt] = await Promise.all([wrap(restRpc('leaderboard', { month: `${mkey}-01`, lim: 25 })), wrap(rest('review_feed?select=*&status=eq.visible&order=created_at.desc&limit=6'))]);
  const box = $('#lbBody'); if (!box) return;
  if (lb.error) { box.innerHTML = `<p>${esc(errMsg(lb.error))}</p>`; return; }
  box.innerHTML = lb.data.length ? `<ol class="board">${lb.data.map(r => `<li class="${me && me.id === r.user_id ? 'me' : ''}"><span class="rk rk${r.rank}">${r.rank}</span>${avatar(r.display_name)}<a class="who" href="#/u/${r.user_id}">${esc(r.display_name)}</a><span class="bstat"><b>${r.points}</b> pts<small>${r.reviews} review${r.reviews === 1 ? '' : 's'} · ${r.helpful} helpful</small></span></li>`).join('')}</ol>`
    : '<p class="muted">No points earned this month yet. Post a player review to get on the board.</p>';
  const L = $('#latest'); if (L) L.innerHTML = lt.data.map(r => `<li class="rv panel"><header class="rv-h">${avatar(r.display_name)}<div><a class="who" href="#/u/${r.user_id}">${esc(r.display_name)}</a> on <a href="#/review/${esc(r.game_slug)}">${esc(r.game_title)}</a><div class="rv-meta">${starsRO(r.rating, 'xs')}<b>${fmtRating(r.rating)}</b><span>${esc(PLATFORMS[r.platform])}</span><span>${when(r.created_at)}</span></div></div></header><p class="rv-body clamp">${esc(r.body)}</p></li>`).join('') || '<li class="muted">No player reviews yet.</li>';
}

function viewAdmin() {
  const html = page('Moderation', 'Flag queue', 'Reported posts, most urgent first. Items hide automatically once they reach the report threshold; restore or remove them here.', '<div id="admBody"><p class="muted">Loading…</p></div>');
  return { html, title: 'Moderation · GREENLIGHT', nav: 'community', bind: () => { if (!ON) { $('#admBody').innerHTML = soon('Moderation tools'); return; } client().then(renderAdmin); } };
}
async function renderAdmin() {
  const box = $('#admBody'); if (!box) return;
  if (!me || !me.is_admin) { box.innerHTML = '<div class="panel"><p>Admins only. <a href="#/account">Sign in</a> with an admin account.</p></div>'; return; }
  const { data, error } = await sb.rpc('flag_queue');
  if (error) { box.innerHTML = `<p>${esc(errMsg(error))}</p>`; return; }
  box.innerHTML = data.length ? `<ul class="rlist">${data.map(q => `<li class="rv panel ${q.status === 'hidden' ? 'is-hidden' : ''}"><div class="rv-meta"><span class="tagbadge ${q.status === 'hidden' ? 'ea' : 'none'}">${esc(q.status)}</span><span>${esc(q.target_type)} #${q.target_id}</span><span>by ${esc(q.author || 'unknown')}</span><a href="#/review/${esc(q.game_slug)}">${esc(q.game_slug)}</a><span>${q.reports} report${q.reports === 1 ? '' : 's'}: ${esc(q.reasons.join(', '))}</span></div>
      <p class="rv-body">${esc(q.body)}</p><div class="btnrow"><button type="button" class="btn btn-ghost sm" data-mod="restore" data-type="${esc(q.target_type)}" data-id="${q.target_id}">Restore</button><button type="button" class="btn btn-danger sm" data-mod="remove" data-type="${esc(q.target_type)}" data-id="${q.target_id}">Remove</button></div></li>`).join('')}</ul>` : '<div class="panel"><p>Nothing to review. The queue is empty.</p></div>';
  box.onclick = async e => { const b = e.target.closest('[data-mod]'); if (!b) return;
    const { error } = await sb.rpc('moderate', { p_type: b.dataset.type, p_id: Number(b.dataset.id), p_action: b.dataset.mod });
    if (error) toast(errMsg(error), true); else { toast(b.dataset.mod === 'restore' ? 'Restored' : 'Removed'); loadStats(true); renderAdmin(); } };
}

function viewGuidelines() {
  return { title: 'Community guidelines · GREENLIGHT', nav: 'community', html: page('Community', 'Guidelines', 'Short version: be useful, be kind, be honest.', `<div class="panel prose-s">
    <h2 class="sec-h">Two kinds of reviews</h2>
    <p><strong>Editorial reviews</strong> (the main review on each game page) are written by GREENLIGHT with AI assistance and fact-checked against the critic, performance and accessibility sources linked on that page. <strong>Player reviews and comments</strong> are written by real, signed-in players and are labelled that way. Player posts are never generated by AI, and our editorial scores are never mixed with player scores.</p>
    <h2 class="sec-h">Do</h2><ul><li>Review games you’ve actually played, and be honest about hours and platform.</li><li>Explain <em>why</em>: performance, difficulty, co-op, value on Game Pass.</li><li>Mark big story spoilers clearly, or leave them out.</li><li>Disagree with the take, not the person.</li></ul>
    <h2 class="sec-h">Don’t</h2><ul><li>No harassment, hate speech, slurs or personal attacks.</li><li>No spam, ads, referral links, key selling or vote trading.</li><li>No multiple accounts to boost scores or helpful votes.</li><li>No personal information, yours or anyone else’s.</li></ul>
    <h2 class="sec-h">How moderation works</h2><ul><li>A basic filter blocks slurs, profanity, link spam and all-caps posts before they’re published.</li><li>Rate limits stop floods: up to 5 reviews an hour, 10 comments per 10 minutes, and short gaps between comments.</li><li>Anyone signed in can report a post. After ${esc(CFG.reportThreshold || 3)} reports it hides automatically until a moderator restores or removes it.</li><li>An optional AI check may flag posts for a human moderator. It never deletes posts on its own.</li></ul>
    <h2 class="sec-h">Points &amp; badges</h2><p>Reviews earn 10 points, each helpful vote your review receives earns 2, and comments earn 1. Hidden or removed posts earn nothing, and gaming the system gets points removed. Points have no cash value.</p></div>`) };
}
function viewPrivacy() {
  return { title: 'Privacy · GREENLIGHT', nav: 'community', html: page('Community', 'Privacy note', 'What we store when you use community features, and why.', `<div class="panel prose-s">
    <ul><li><strong>Reading the site</strong> needs no account and sets no tracking cookies. There are no ads or analytics. Trailers load from youtube-nocookie.com only when you press play.</li>
    <li><strong>Your email</strong> is used only to send sign-in links (via Supabase Auth) and is never shown publicly or shared. If you sign in with GitHub or Google, we receive your email from that provider.</li>
    <li><strong>Public:</strong> your display name, avatar initial, reviews, comments, helpful-vote counts, points and badges.</li>
    <li><strong>Private:</strong> your email, the posts you’ve reported and which reviews you voted on. Moderators can see reports.</li>
    <li><strong>On your device:</strong> a sign-in session is kept in your browser’s local storage so you stay signed in. Signing out removes it.</li>
    <li><strong>Moderation:</strong> posts pass through an automatic word filter. If AI moderation is switched on, the text of new posts (not your email) is sent to a moderation model to check for abuse or spam.</li>
    <li><strong>Deleting your data:</strong> you can delete any post yourself, or all of them at once from <a href="#/account">your account</a>. To delete the account itself, open an issue on the site’s <a href="https://github.com/Zayon1012/Zayon1012.github.io/issues" target="_blank" rel="noopener">GitHub repository</a> (without posting your email) and we’ll remove it.</li>
    <li><strong>Where it lives:</strong> the site is hosted on GitHub Pages. Community data is stored in a Supabase (PostgreSQL) database protected by row-level security.</li></ul></div>`) };
}

/* ---------- public API used by app.js ---------- */
window.GLC = {
  enabled: ON,
  handles: r => ROUTES.has(r),
  view(r, parts, q) {
    if (r === 'account') return viewAccount();
    if (r === 'u') return viewProfile(parts[1]);
    if (r === 'community') return viewCommunity(q);
    if (r === 'admin') return viewAdmin();
    if (r === 'guidelines') return viewGuidelines();
    return viewPrivacy();
  },
  after(root, r) {
    fillBadges(root);
    if (ON && ($('[data-pbadge],[data-pmini]', root))) loadStats(r === 'review', 60000).then(() => fillBadges(root));
    const sec = r === 'review' && $('#community', root);
    if (sec) {
      cmState.editing = false;
      if (!ON) return renderCommunity(sec);
      const go = () => renderCommunity(sec);
      if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '800px 0px' }); io.observe(sec); }
      else go();
    }
  },
};

/* ---------- boot ---------- */
navInit();
if (ON) {
  [[CFG.supabaseUrl, true], ['https://cdn.jsdelivr.net', true]].forEach(([h]) => { try { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = new URL(h).origin; l.crossOrigin = 'anonymous'; document.head.append(l); } catch (e) {} });
  const p = new URLSearchParams(location.search);
  if (p.has('code') || p.has('error_description')) {
    client().then(() => {
      if (p.has('error_description')) toast(p.get('error_description'), true); else if (me) toast(`Signed in as ${me.display_name}`);
      history.replaceState(null, '', location.pathname + (sessionStorage.getItem('gl-return') || '#/account'));
      sessionStorage.removeItem('gl-return'); rerender();
    }).catch(e => toast(errMsg(e), true));
  } else if (localStorage.getItem('gl-auth')) {
    (window.requestIdleCallback || setTimeout)(() => client().catch(() => {}), { timeout: 2500 });
  }
}
})();
