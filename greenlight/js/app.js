/* GREENLIGHT — vanilla hash-router SPA. All content comes from data/issue.json. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const RM = matchMedia('(prefers-reduced-motion: reduce)');
let D = null, G = {}, ISSUE = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];
const fmtDate = iso => { const [y,m,d] = iso.split('-').map(Number); return `${MONTHS[m-1]} ${d}`; };
const fmtDateLong = iso => { const [y,m,d] = iso.split('-').map(Number); const wd = new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}); return `${wd}, ${MONTHS[m-1]} ${d}`; };

/* Normalise any score string to 0–100 (null if not numeric, e.g. "Average"). */
function norm(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/^\s*([\d.]+)\s*\/\s*([\d.]+)/);
  if (m) return Math.round(parseFloat(m[1]) / parseFloat(m[2]) * 100);
  if (/^\d+$/.test(String(v).trim())) return parseInt(v, 10);
  return null;
}
const gameScore = g => g.aggregate ? g.aggregate.value : (g.badge && (g.badge.kind === 'score' || g.badge.kind === 'outlet') ? norm(g.badge.value) : null);
/* Sort key: aggregates outrank single-outlet scores, which outrank unscored games. */
const sortKey = g => g.aggregate ? 1000 + g.aggregate.value : (g.badge && g.badge.kind === 'outlet' && norm(g.badge.value) != null) ? 500 + norm(g.badge.value) : -1;
const hltbMain = g => { if (!g.hltb || g.hltb.status === 'none' || !g.hltb.rows.length) return null;
  const v = g.hltb.rows[0].v.replace('½', '.5').match(/[\d.]+/); return v ? parseFloat(v[0]) : null; };

/* ---------- Image helpers ---------- */
const srcset = (slug, i) => [400, 800, 1600].map(w => `img/${slug}-${i}-${w}.webp ${w}w`).join(', ');
function pic(g, i, { sizes = '100vw', alt, eager = false, cls = '', pos = '' } = {}) {
  const a = alt ?? `${g.title} screenshot`;
  return `<img class="${cls}" src="img/${g.slug}-${i}-800.webp" srcset="${srcset(g.slug, i)}" sizes="${sizes}" width="1600" height="900" alt="${esc(a)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"${pos ? ` style="object-position:${pos}"` : ''}>`;
}

/* ---------- Badges ---------- */
function ring(value, size = '', label = '') {
  const n = norm(value), pct = n == null ? 0 : n;
  const C = 2 * Math.PI * 44;
  const isFrac = typeof value === 'string' && value.includes('/');
  const txt = isFrac ? `${value.split('/')[0]}<small>/${value.split('/')[1]}</small>` : esc(value);
  return `<div class="badge ${size} ${pct >= 85 ? 'hi' : ''}" role="img" aria-label="${esc(label || 'Score')}: ${esc(value)}" data-count="${isFrac ? '' : pct}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="44" fill="none" stroke-width="7"/><circle class="arc" cx="50" cy="50" r="44" fill="none" stroke-width="7" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${(C * (1 - pct / 100)).toFixed(1)}"/></svg>
    <span class="num" aria-hidden="true">${txt}</span></div>`;
}
function badge(g, size = '') {
  const b = g.badge || {};
  if (b.kind === 'score' || b.kind === 'outlet') return ring(b.value, size, `${b.label}${b.kind === 'score' ? ' Top Critic Average' : ' review score'}`);
  return '';
}
function tag(g) {
  const b = g.badge || {};
  if (b.kind === 'text') return `<span class="tagbadge ea">${esc(b.value === 'EARLY ACCESS' ? 'Early Access' : b.value)}</span>`;
  if (b.kind === 'upcoming') return `<span class="tagbadge soon">Preview · ${esc(b.value)}</span>`;
  if (b.kind === 'none') return `<span class="tagbadge none">Not reviewed</span>`;
  return '';
}
const scoreOrTag = (g, size = 'sm') => badge(g, size) || tag(g);
const badgeCaption = g => { const b = g.badge || {}; return b.kind === 'score' ? `${b.label} · ${b.sub}` : b.kind === 'outlet' ? `${b.label} · ${b.sub}` : b.sub || ''; };

function animateBadges(root = app) {
  const items = $$('.badge, .obar i, .rank .bar i', root);
  const run = el => {
    if (el.classList.contains('badge')) {
      const arc = $('.arc', el); if (arc) arc.style.strokeDashoffset = arc.dataset.off;
      const target = el.dataset.count, num = $('.num', el);
      if (target && !RM.matches && num) {
        const t = +target, t0 = performance.now(), dur = 1100;
        const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          num.textContent = Math.round(t * e); if (k < 1) requestAnimationFrame(step); };
        num.textContent = '0'; requestAnimationFrame(step);
      }
    } else el.style.width = el.dataset.w;
  };
  if (RM.matches || !('IntersectionObserver' in window)) { items.forEach(el => { const a = $('.arc', el); if (a) a.style.transition = 'none'; run(el); }); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: .3 });
  items.forEach(el => io.observe(el));
}
function reveal(root = app) {
  const els = $$('.reveal', root);
  if (RM.matches || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
}

/* ---------- Shared bits ---------- */
const tierNames = g => g.tiers.map(t => D.tiers[t]).join(' · ');
const genreName = s => (D.genres.find(x => x.slug === s) || { name: s }).name;
const reviewed = () => D.games.filter(g => g.reviewed).sort((a, b) => a.order - b.order);
const gameHref = g => g.reviewed ? `#/review/${g.slug}` : `#/lineup?q=${g.slug}`;
const footer = () => `<footer class="site"><div class="wrap">
  <p><strong>GREENLIGHT</strong> · ${esc(D.site.tagline)} · Issue ${ISSUE.number}: ${esc(ISSUE.title)} (${esc(ISSUE.window)})</p>
  <p>Scores and data checked ${esc(fmtDateLong(D.site.checked))}, 2026. Only real scores from real outlets are shown; missing data is marked “Not yet reported”. Game art © the respective publishers. <a href="#/sources">Sources &amp; credits</a>.</p>
  <p>Unofficial fan publication, not affiliated with Microsoft or Xbox.</p></div></footer>`;

function card(g, { feature = false, extra = '', sizes = '(min-width:1000px) 33vw, (min-width:600px) 50vw, 100vw' } = {}) {
  const pick = ISSUE.editorsPick === g.slug;
  return `<a class="card reveal ${feature ? 'feature-card' : ''} ${extra}" href="#/review/${g.slug}">
    <div class="card-media">${pic(g, g.hero ?? 0, { sizes: feature ? '(min-width:900px) 60vw, 100vw' : sizes, alt: '', pos: g.heroPos })}
      ${pick ? '<span class="tagbadge pick">Editor’s pick</span>' : (g.badge.kind === 'text' ? tag(g) : '')}</div>
    <div class="card-body">${badge(g, feature ? 'md' : 'sm')}<span class="kicker">${esc(g.kicker || g.genres.map(genreName).join(' · '))}</span>
      <h3>${esc(g.title)}</h3><p>${esc(g.deck || g.blurb)}</p>
      <div class="card-foot"><span class="chip-s">${esc(fmtDate(g.date))}</span>${g.tiers.map(t => `<span class="chip-s tier">${esc(D.tiers[t])}</span>`).join('')}</div></div></a>`;
}
function row(g) {
  const inner = `${pic(g, 0, { sizes: '(min-width:700px) 160px, 96px', alt: '' })}
    <div><h3>${esc(g.title)}</h3><div class="meta"><span>${esc(fmtDateLong(g.date))}</span><span class="tiers">${esc(tierNames(g))}</span><span>${esc(g.genres.map(genreName).join(', '))}</span></div>
    ${g.reviewed ? '<span class="go">Read review →</span>' : `<div class="meta"><span>${esc(g.blurb)}</span></div>`}</div>
    <div class="end">${scoreOrTag(g)}</div>`;
  return g.reviewed ? `<li><a class="row" href="#/review/${g.slug}" aria-label="${esc(g.title)} review">${inner}</a></li>` : `<li><div class="row" id="g-${g.slug}">${inner}</div></li>`;
}

/* ---------- Views ---------- */
function viewHome() {
  const cover = G[ISSUE.coverGame];
  const covImg = ISSUE.coverImage.replace(`${cover.slug}-`, '');
  const aggs = reviewed().filter(g => g.aggregate).sort((a, b) => b.aggregate.value - a.aggregate.value);
  const others = D.games.filter(g => !g.reviewed).sort((a, b) => a.date.localeCompare(b.date));
  const rv = reviewed();
  const pick = G[ISSUE.editorsPick];
  const genreCounts = D.genres.map(x => ({ ...x, n: D.games.filter(g => g.genres.includes(x.slug)).length })).filter(x => x.n);
  return `<section class="cover" aria-label="Cover">
    <div class="cover-img">${pic(cover, covImg, { eager: true, sizes: '(max-aspect-ratio: 16/9) 178vh, 100vw', alt: 'Dune: Awakening key art: a sandworm erupts from the desert of Arrakis' })}</div>
    <div class="cover-inner">
      <div class="cover-top"><p class="masthead">Green<span>light</span></p>
      <div class="cover-meta"><span class="hide-s">${esc(D.site.tagline)}</span><span class="dot hide-s"></span><span>Issue ${ISSUE.number}</span><span class="dot"></span><span>${esc(ISSUE.window)}</span></div></div>
      <div class="cover-bottom"><div class="cover-grid">
        <div class="cover-feature">
          <span class="kicker">${esc(cover.kicker)}</span>
          <h2>${esc(cover.title)}</h2>
          <p>${esc(cover.deck)}</p>
          <div class="cover-badges">${aggs.map(g => `<a class="cover-badge" href="#/review/${g.slug}">${ring(g.aggregate.value, 'sm', `${g.title}, OpenCritic Top Critic Average`)}<span class="t">${esc(g.title.replace(/:.*$/, ''))}<small>OpenCritic</small></span></a>`).join('')}</div>
          <div class="cta-row"><a class="btn btn-primary" href="#/review/${cover.slug}">Read the cover review</a><a class="btn btn-ghost" href="#/verdict">What to play tonight?</a></div>
        </div>
        <ul class="cover-lines">${ISSUE.coverLines.map(c => `<li><a href="#/review/${c.slug}"><span class="cl-k">${esc(c.k)}</span><span class="cl-t">${esc(c.t)}</span></a></li>`).join('')}</ul>
      </div>
      <div class="scroll-cue"><a href="#issue" data-scroll="issue">Into the issue<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></a></div></div>
    </div></section>
  <div class="wrap" id="issue">
    <section class="section"><div class="section-h"><div><span class="kicker">In this issue</span><h2>8 games, reviewed</h2></div><a class="more" href="#/verdict">See the verdict →</a></div>
      <div class="grid cols-3">${card(pick, { feature: true })}${rv.filter(g => g.slug !== pick.slug).map((g, i, a) => card(g, { extra: i === 0 ? 'span2' : i === a.length - 1 && a.length % 3 === 1 ? 'span2-lg' : '' })).join('')}</div></section>
    <section class="section reveal"><div class="section-h"><div><span class="kicker">Browse</span><h2>By genre</h2></div><a class="more" href="#/genres">All genres →</a></div>
      <nav class="chips" aria-label="Genres">${genreCounts.map(x => `<a class="chip" href="#/genre/${x.slug}">${esc(x.name)}<span class="n">${x.n}</span></a>`).join('')}</nav></section>
    <section class="section"><div class="section-h"><div><span class="kicker">Also arriving</span><h2>The rest of the lineup</h2></div><a class="more" href="#/lineup">Full lineup →</a></div>
      <ul class="rows">${others.map(row).join('')}</ul></section>
    <section class="section reveal leaving"><h2>Leaving ${esc(ISSUE.leavingDate)}</h2><p class="muted" style="margin:6px 0 0">Last chance to finish these before they leave Game Pass.</p>
      <ul>${ISSUE.leaving.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
  </div>${footer()}`;
}

function viewGenres() {
  const list = D.genres.map(x => ({ ...x, games: D.games.filter(g => g.genres.includes(x.slug)) })).filter(x => x.games.length)
    .sort((a, b) => b.games.length - a.games.length);
  return `<div class="page"><div class="wrap">
    <header class="page-head"><span class="kicker">Genre hubs</span><h1>Browse by genre</h1><p>Every game in this issue, tagged by what it plays like. Pick a hub to see its games with scores, tiers and dates.</p></header>
    <div class="grid cols-3">${list.map(x => { const g = x.games.find(g => g.reviewed) || x.games[0]; return `<a class="gtile reveal" href="#/genre/${x.slug}">${pic(g, g.reviewed ? (g.hero ?? 0) : 0, { sizes: '(min-width:1000px) 33vw, (min-width:600px) 50vw, 100vw', alt: '' })}<span class="cnt">${x.games.length} game${x.games.length > 1 ? 's' : ''}</span><h3>${esc(x.name)}</h3><p>${esc(x.blurb)}</p></a>`; }).join('')}</div>
  </div></div>${footer()}`;
}

function viewGenre(slug) {
  const x = D.genres.find(g => g.slug === slug);
  if (!x) return viewNotFound();
  const games = D.games.filter(g => g.genres.includes(slug)).sort((a, b) => sortKey(b) - sortKey(a) || a.date.localeCompare(b.date));
  const counts = D.genres.map(g => ({ ...g, n: D.games.filter(z => z.genres.includes(g.slug)).length })).filter(g => g.n);
  return `<div class="page"><div class="wrap">
    <header class="page-head"><a class="kicker" href="#/genres" style="text-decoration:none">← All genres</a><h1>${esc(x.name)}</h1><p>${esc(x.blurb)} ${games.length} game${games.length > 1 ? 's' : ''} in this issue.</p></header>
    <nav class="chips" aria-label="Genres">${counts.map(g => `<a class="chip" href="#/genre/${g.slug}" ${g.slug === slug ? 'aria-current="page"' : ''}>${esc(g.name)}<span class="n">${g.n}</span></a>`).join('')}</nav>
    <ul class="rows" style="margin-top:14px">${games.map(row).join('')}</ul>
    <p class="muted" style="font-size:.85rem;margin-top:14px">Ranked by OpenCritic aggregate first, then single-outlet review scores; unreviewed, preview and Early Access games follow by date. <a href="#/lineup?genre=${slug}">Open in the lineup filter →</a></p>
  </div></div>${footer()}`;
}

function parseQuery(q) { const o = {}; new URLSearchParams(q || '').forEach((v, k) => o[k] = v); return o; }
function viewLineup(q) {
  const f = { tier: q.tier || 'all', genre: q.genre || 'all', platform: q.platform || 'all', sort: q.sort || 'date' };
  const genres = D.genres.filter(x => D.games.some(g => g.genres.includes(x.slug)));
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="page"><div class="wrap">
    <header class="page-head"><span class="kicker">${esc(ISSUE.window)}</span><h1>The lineup</h1><p>All ${D.games.length} games arriving on Game Pass in this window, per <a href="${esc(ISSUE.lineupSource)}" rel="noopener" target="_blank">Xbox Wire</a> and follow-up announcements. Scores show where real reviews exist; otherwise you’ll see a status badge.</p></header>
    <form class="filters" id="filters" aria-label="Filter and sort the lineup">
      <div class="fgroup"><span id="tierlab">Tier</span><div class="chips" role="group" aria-labelledby="tierlab">${[['all', 'All tiers'], ...Object.entries(D.tiers)].map(([k, v]) => `<button type="button" class="chip" data-tier="${k}" aria-pressed="${f.tier === k}">${esc(v)}</button>`).join('')}</div></div>
      <div class="fgrid">
        <label class="fgroup"><span>Genre</span><div class="selectwrap"><select name="genre">${opt('all', f.genre, 'All genres')}${genres.map(g => opt(g.slug, f.genre, g.name)).join('')}</select></div></label>
        <label class="fgroup"><span>Platform</span><div class="selectwrap"><select name="platform">${opt('all', f.platform, 'All platforms')}${Object.entries(D.platforms).map(([k, v]) => opt(k, f.platform, v)).join('')}</select></div></label>
      </div>
      <label class="fgroup"><span>Sort by</span><div class="selectwrap"><select name="sort">${opt('date', f.sort, 'Date (earliest first)')}${opt('score', f.sort, 'Score (highest first)')}${opt('name', f.sort, 'Name (A–Z)')}</select></div></label>
      <div class="fcount"><span id="count" role="status"></span><span style="font-size:.8rem">Score sort: aggregates first, then single-outlet scores.</span><button type="button" class="linkbtn" id="reset">Reset filters</button></div>
    </form>
    <ul class="rows" id="lineupList"></ul>
    <section class="section leaving"><h2>Leaving ${esc(ISSUE.leavingDate)}</h2><p class="muted" style="margin:6px 0 0">${ISSUE.leaving.length} games leave Game Pass at the end of the month.</p><ul>${ISSUE.leaving.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
  </div></div>${footer()}`;
}
function bindLineup(q) {
  const f = { tier: q.tier || 'all', genre: q.genre || 'all', platform: q.platform || 'all', sort: q.sort || 'date' };
  const list = $('#lineupList'), form = $('#filters');
  const apply = (push = true) => {
    let gs = D.games.filter(g => (f.tier === 'all' || g.tiers.includes(f.tier)) && (f.genre === 'all' || g.genres.includes(f.genre)) && (f.platform === 'all' || g.platforms.includes(f.platform)));
    const by = { date: (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
      name: (a, b) => a.title.localeCompare(b.title),
      score: (a, b) => sortKey(b) - sortKey(a) || a.date.localeCompare(b.date) };
    gs.sort(by[f.sort] || by.date);
    list.innerHTML = gs.length ? gs.map(row).join('') : '<li class="panel">No games match those filters. <button type="button" class="linkbtn" data-reset>Reset</button></li>';
    $('#count').textContent = `Showing ${gs.length} of ${D.games.length} games`;
    $$('[data-tier]', form).forEach(b => b.setAttribute('aria-pressed', b.dataset.tier === f.tier));
    animateBadges(list);
    if (push) { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v !== 'all' && !(k === 'sort' && v === 'date')) p.set(k, v); });
      const h = '#/lineup' + (p.toString() ? '?' + p : ''); if (location.hash !== h) history.replaceState(null, '', h); }
  };
  form.addEventListener('click', e => { const b = e.target.closest('[data-tier]'); if (b) { f.tier = b.dataset.tier; apply(); } });
  form.addEventListener('change', e => { if (e.target.name) { f[e.target.name] = e.target.value; apply(); } });
  const reset = () => { Object.assign(f, { tier: 'all', genre: 'all', platform: 'all', sort: 'date' }); $$('select', form).forEach(s => s.value = s.name === 'sort' ? 'date' : 'all'); apply(); };
  $('#reset').addEventListener('click', reset);
  list.addEventListener('click', e => { if (e.target.closest('[data-reset]')) reset(); });
  apply(false);
  if (q.q) { const el = document.getElementById('g-' + q.q); if (el) { el.scrollIntoView({ block: 'center' }); el.style.borderColor = 'var(--lime)'; } }
}

function srcLinks(src) {
  if (!src || !src.length) return '';
  return `<div class="src"><span>Source:</span>${src.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('<span aria-hidden="true">·</span>')}</div>`;
}
const isNYR = t => /^not yet reported\.?$/i.test((t || '').trim());
function perfItem(label, p) {
  if (!p) return '';
  const nyr = isNYR(p.text);
  return `<div class="perf-item ${nyr ? 'nyr' : ''}"><h4>${esc(label)}</h4>${nyr ? '<span class="nyr-tag">Not yet reported</span>' : `<p>${esc(p.text)}</p>`}${srcLinks(p.src)}</div>`;
}

function viewReview(slug) {
  const g = G[slug];
  if (!g || !g.reviewed) return viewNotFound();
  const rv = reviewed(), idx = rv.indexOf(g), prev = rv[(idx - 1 + rv.length) % rv.length], next = rv[(idx + 1) % rv.length];
  const hl = g.hltb;
  const hltbHtml = hl.status === 'none'
    ? `<span class="nyr-tag">Not yet reported</span><p class="muted" style="font-size:.9rem;margin:10px 0 0">${esc(hl.note || 'HowLongToBeat has no completion data for this game yet.')}</p>`
    : `<div class="hltb">${hl.rows.map(r => `<div><b>${esc(r.v)}</b><span>${esc(r.k)}</span></div>`).join('')}</div>${hl.status === 'partial' ? '<p class="muted" style="font-size:.85rem;margin:0 0 6px"><strong>Small sample:</strong> treat as a rough guide.</p>' : ''}<p class="muted" style="font-size:.85rem;margin:0">${esc(hl.note || '')}</p>`;
  const a11yNYR = /^not yet reported/i.test(g.a11y.text);
  const nowWait = /wait/i.test(g.nowOrWait.call) && !/^play now/i.test(g.nowOrWait.call);
  return `<article>
  <header class="rhero">${pic(g, g.hero ?? 0, { eager: true, sizes: '100vw', alt: `${g.title} screenshot`, pos: g.heroPos })}
    <div class="rhero-inner">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Issue</a><span aria-hidden="true">/</span>${g.genres.map(s => `<a href="#/genre/${s}">${esc(genreName(s))}</a>`).join('<span aria-hidden="true">·</span>')}</nav>
      <span class="kicker">${esc(g.kicker)}</span>
      <h1>${esc(g.title)}</h1>
      <p class="deck">${esc(g.deck)}</p>
      <div class="rhero-row">${badge(g, 'lg') ? `<div class="badge-wrap">${badge(g, 'lg')}<div class="badge-lab"><b>${esc(g.badge.label)}</b>${esc(g.badge.sub)}</div></div>` : `<div class="badge-wrap">${tag(g)}<div class="badge-lab"><b>${esc(g.badge.label)}</b>${esc(g.badge.sub)}</div></div>`}
        <a class="btn btn-primary" href="${esc(g.store)}" target="_blank" rel="noopener">Open in Xbox Store ↗</a></div>
    </div></header>
  <div class="wrap page" style="padding-top:18px">
    <div class="rgrid">
      <div class="rmain">
        <div class="prose">${g.body.map(p => `<p>${esc(p)}</p>`).join('')}</div>
        ${g.quote ? `<blockquote class="pull">“${esc(g.quote.text)}”<cite>— ${esc(g.quote.by)}</cite></blockquote>` : ''}
        <section class="hm section" aria-label="Hits and misses">
          <div class="panel hits"><h2 class="ph">${esc(g.prolabel || 'Hits')}</h2><ul>${g.pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
          <div class="panel misses"><h2 class="ph">${esc(g.conlabel || 'Misses')}</h2><ul>${g.cons.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
        </section>
        <div class="playif reveal"><span class="kicker">Play it if…</span><p>…${esc(g.playIf)}</p></div>
        <section class="section"><div class="section-h"><h2>Trailer</h2><span class="muted" style="font-size:.85rem">Official · ${esc(g.trailer.channel)} on YouTube</span></div>
          <div class="trailer" id="trailer"><button type="button" data-yt="${esc(g.trailer.id)}" data-title="${esc(g.trailer.title)}" aria-label="Play trailer: ${esc(g.trailer.title)}">${pic(g, g.gallery[1] ?? 0, { sizes: '(min-width:1000px) 760px, 100vw', alt: '' })}<span class="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg></span><span class="tl">${esc(g.trailer.title)}</span></button></div>
          <p class="src"><a href="https://www.youtube.com/watch?v=${esc(g.trailer.id)}" target="_blank" rel="noopener">Watch on YouTube ↗</a><span>Loads from youtube-nocookie.com only when you press play.</span></p></section>
        <section class="section"><div class="section-h"><h2>Gallery</h2><span class="muted" style="font-size:.85rem">Tap to expand · swipe to browse</span></div>
          <div class="gallery">${g.gallery.map((i, n) => `<button type="button" data-lb="${n}" aria-label="Open screenshot ${n + 1} of ${g.gallery.length}">${pic(g, i, { sizes: '(min-width:800px) 250px, 50vw', alt: `${g.title} screenshot ${n + 1}` })}</button>`).join('')}</div></section>
        <section class="section"><div class="section-h"><h2>Deep dive</h2></div>
          <div class="depth">
            <div class="panel"><h3 class="ph">Time to beat</h3>${hltbHtml}${srcLinks(hl.src)}</div>
            <div class="panel"><h3 class="ph">Play now or wait?</h3><div class="now"><span class="call ${nowWait ? 'wait' : ''}">${esc(g.nowOrWait.call)}</span><p>${esc(g.nowOrWait.text)}</p></div><p class="muted" style="font-size:.78rem;margin:10px 0 0">GREENLIGHT’s call, based on the sourced reviews and performance reports on this page.</p></div>
            <div class="panel wide"><h3 class="ph">How it runs</h3><div class="perf">${perfItem('Xbox Series X', g.perf.seriesX)}${perfItem('Xbox Series S', g.perf.seriesS)}${perfItem('PC', g.perf.pc)}${g.perf.other ? perfItem('Also reported', g.perf.other) : ''}</div></div>
            <div class="panel wide"><h3 class="ph">Accessibility</h3>${a11yNYR && isNYR(g.a11y.text) ? '<span class="nyr-tag">Not yet reported</span>' : (a11yNYR ? `<span class="nyr-tag">Not yet reported</span><p style="margin:10px 0 0">${esc(g.a11y.text.replace(/^Not yet reported\.?\s*/i, ''))}</p>` : `<p style="margin:0">${esc(g.a11y.text)}</p>`)}${srcLinks(g.a11y.src)}</div>
          </div></section>
      </div>
      <aside class="rside">
        <div class="panel"><h2>The scores</h2>
          ${g.aggregate ? `<div class="agg">${ring(g.aggregate.value, 'md', g.aggregate.label)}<p><strong style="color:#fff">${esc(g.aggregate.label)}</strong><br>${g.aggregate.recommend != null ? `${g.aggregate.recommend}% of critics recommend · ` : ''}<a href="${esc(g.aggregate.url)}" target="_blank" rel="noopener">OpenCritic ↗</a>${g.aggregate.note ? `<br><span style="font-size:.8rem">${esc(g.aggregate.note)}</span>` : ''}</p></div>` : `<p class="muted" style="font-size:.88rem;margin:0 0 8px">${esc(g.badge.sub || 'No aggregate score yet')}.</p>`}
          <ul class="outlets">${g.outlets.map(o => { const n = norm(o.score); return `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.outlet)}${o.via ? `<small>${esc(o.via)}</small>` : ''}</a><span class="oscore">${n != null ? `<span class="obar" aria-hidden="true"><i data-w="${n}%"></i></span>` : ''}<b>${esc(o.score)}</b></span></li>`; }).join('')}</ul>
        </div>
        <div class="panel" style="margin-top:14px"><h2>Fact file</h2><dl class="facts">${g.facts.map(f => `<div><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join('')}</dl>
          <a class="btn btn-primary store" href="${esc(g.store)}" target="_blank" rel="noopener">Open in Xbox Store ↗</a></div>
        ${g.sources && g.sources.length ? `<div class="panel" style="margin-top:14px"><h2>Further reading</h2><ul style="margin:0;padding-left:18px">${g.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 0">${esc(s.label)}</a></li>`).join('')}</ul></div>` : ''}
      </aside>
    </div>
    <nav class="pager" aria-label="More reviews"><a href="#/review/${prev.slug}"><small>← Previous</small><span>${esc(prev.title)}</span></a><a class="next" href="#/review/${next.slug}"><small>Next →</small><span>${esc(next.title)}</span></a></nav>
  </div></article>${footer()}`;
}
function bindReview(slug) {
  const g = G[slug];
  const t = $('#trailer button');
  if (t) t.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.dataset.yt)}?autoplay=1&rel=0&modestbranding=1`;
    f.title = t.dataset.title; f.loading = 'lazy';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.referrerPolicy = 'strict-origin-when-cross-origin'; f.allowFullscreen = true;
    t.replaceWith(f); f.focus();
  });
  $$('.gallery [data-lb]').forEach(b => b.addEventListener('click', () => LB.open(g, +b.dataset.lb, b)));
}

/* ---------- Verdict: ranking + picker ---------- */
const MODES = {
  score: { label: 'Critic score', desc: 'OpenCritic Top Critic Average where one exists. Games without an aggregate are listed separately with their single-outlet or Early Access status.' },
  time: { label: 'Shortest first', desc: 'HowLongToBeat main-story time. Games without HLTB data are listed separately.' },
  coop: { label: 'Co-op nights', desc: 'Games that support co-op, ranked by score.' },
};
function rankHtml(mode) {
  const rv = reviewed();
  let ranked = [], rest = [], val, why;
  if (mode === 'score') { ranked = rv.filter(g => g.aggregate).sort((a, b) => b.aggregate.value - a.aggregate.value); rest = rv.filter(g => !g.aggregate);
    val = g => ({ v: g.aggregate.value, s: 'OpenCritic', w: g.aggregate.value }); why = g => `${g.aggregate.recommend}% recommend · ${g.nowOrWait.call}`; }
  if (mode === 'time') { ranked = rv.filter(g => hltbMain(g) != null).sort((a, b) => hltbMain(a) - hltbMain(b)); rest = rv.filter(g => hltbMain(g) == null);
    const max = Math.max(...ranked.map(hltbMain)); val = g => ({ v: g.hltb.rows[0].v, s: 'Main story', w: Math.max(6, Math.round(hltbMain(g) / max * 100)) }); why = g => g.hltb.status === 'partial' ? 'HLTB · small sample' : 'HowLongToBeat'; }
  if (mode === 'coop') { ranked = rv.filter(g => g.picker.players.includes('coop')).sort((a, b) => sortKey(b) - sortKey(a)); rest = rv.filter(g => !g.picker.players.includes('coop'));
    val = g => { const s = gameScore(g); return { v: g.aggregate ? g.aggregate.value : (g.badge.kind === 'outlet' ? g.badge.value : 'EA'), s: g.aggregate ? 'OpenCritic' : g.badge.label, w: s ?? 0 }; }; why = g => g.nowOrWait.call; }
  const li = (g, i, isRanked) => { const x = isRanked ? val(g) : null; return `<li><a href="#/review/${g.slug}"><span class="pos ${isRanked ? '' : 'na'}">${isRanked ? i + 1 : '—'}</span>
    <div><h3>${esc(g.title)}</h3>${isRanked ? `<div class="bar" aria-hidden="true"><i data-w="${x.w}%"></i></div><div class="why">${esc(why(g))}</div>` : `<div class="why">${esc(mode === 'score' ? (g.badge.kind === 'text' ? `Early Access · ${g.badge.sub}` : `${g.badge.label}: ${g.badge.value} · ${g.badge.sub}`) : mode === 'time' ? 'Time to beat not yet reported' : 'Solo only')}</div>`}</div>
    <span class="val">${isRanked ? `${esc(x.v)}<small>${esc(x.s)}</small>` : ''}</span></a></li>`; };
  return `<p class="muted" style="font-size:.88rem;margin:0 0 12px">${esc(MODES[mode].desc)}</p><ol class="rank">${ranked.map((g, i) => li(g, i, true)).join('')}</ol>
    ${rest.length ? `<div class="divider">${mode === 'score' ? 'No aggregate yet' : mode === 'time' ? 'No HLTB data yet' : 'Solo only'}</div><ul class="rank">${rest.map(g => li(g, 0, false)).join('')}</ul>` : ''}`;
}
function viewVerdict() {
  const radios = (name, entries, def) => entries.map(([k, v]) => `<label class="opt"><input type="radio" name="${name}" value="${k}" ${k === def ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('');
  return `<div class="page"><div class="wrap">
    <header class="page-head"><span class="kicker">The verdict</span><h1>Ranked &amp; recommended</h1><p>How the eight reviewed games stack up, and a quick picker that matches them to your night using their real attributes: genre feel, HowLongToBeat times and co-op support.</p></header>
    <div class="vgrid">
      <section class="picker" id="picker" aria-labelledby="pk-h"><span class="kicker">60-second picker</span><h2 id="pk-h">What should I play tonight?</h2>
        <form id="pickForm">
          <fieldset><legend>Mood</legend><div class="opts">${radios('mood', [['any', 'Surprise me'], ...Object.entries(D.moods)], 'any')}</div></fieldset>
          <fieldset><legend>Time available</legend><div class="opts">${radios('session', Object.entries(D.sessions), 'evening')}</div></fieldset>
          <fieldset><legend>Players</legend><div class="opts">${radios('players', [['solo', 'Solo'], ['coop', 'Co-op with friends']], 'solo')}</div></fieldset>
        </form>
        <div class="pick-out" id="pickOut" aria-live="polite"></div>
      </section>
      <section class="section" style="margin-top:28px" aria-labelledby="rk-h"><div class="section-h"><h2 id="rk-h">The ranking</h2></div>
        <div class="chips" role="tablist" aria-label="Ranking mode">${Object.entries(MODES).map(([k, m], i) => `<button type="button" class="chip" role="tab" data-mode="${k}" aria-selected="${i === 0}" aria-pressed="${i === 0}">${esc(m.label)}</button>`).join('')}</div>
        <div id="rankOut" style="margin-top:10px">${rankHtml('score')}</div></section>
    </div>
  </div></div>${footer()}`;
}
const SESS = ['short', 'evening', 'long'];
function avail(g) {
  if (g.date <= D.site.checked) return '';
  if (/premium/i.test(g.tierNote || '')) return `<p class="muted" style="font-size:.85rem;margin-top:8px">Already on Ultimate &amp; PC Game Pass; joins Premium ${esc(fmtDateLong(g.date))}.</p>`;
  return `<p class="muted" style="font-size:.85rem;margin-top:8px">Arrives on Game Pass ${esc(fmtDateLong(g.date))}.</p>`;
}
function pick(mood, session, players) {
  return reviewed().map(g => {
    const p = g.picker; if (!p.players.includes(players)) return null;
    let s = 0; const why = [];
    if (mood === 'any') s += 1; else if (p.moods.includes(mood)) { s += 3; why.push(D.moods[mood]); }
    const d = Math.abs(SESS.indexOf(p.session) - SESS.indexOf(session));
    if (d === 0) { s += 2; why.push(`Fits: ${D.sessions[session].toLowerCase()}`); } else if (d === 1) s += 0.5;
    why.push(players === 'coop' ? 'Supports co-op' : 'Great solo');
    const hm = hltbMain(g); if (hm != null) why.push(`Main story ≈ ${g.hltb.rows[0].v} (HLTB)`);
    if (g.aggregate) why.push(`OpenCritic ${g.aggregate.value}`); else if (g.badge.kind === 'outlet') why.push(`${g.badge.label} ${g.badge.value}`); else why.push('Early Access');
    return { g, s: s + Math.max(sortKey(g), 0) / 10000, why, fit: d };
  }).filter(Boolean).sort((a, b) => b.s - a.s);
}
function bindVerdict() {
  const form = $('#pickForm'), out = $('#pickOut');
  const draw = () => {
    const v = Object.fromEntries(new FormData(form));
    const res = pick(v.mood, v.session, v.players);
    if (!res.length) { out.innerHTML = '<p class="panel">Nothing matches that combination. Try another mood.</p>'; return; }
    const [top, ...alts] = res; const g = top.g;
    const sessNote = top.fit > 0 ? `<p class="muted" style="font-size:.85rem;margin-top:8px">Heads-up: this is best in ${g.picker.session === 'long' ? 'longer sessions' : g.picker.session === 'short' ? 'short bursts' : 'an evening sitting'}, but it’s the closest match.</p>` : '';
    out.innerHTML = `<a class="pick-main" href="#/review/${g.slug}"><div class="card-media">${pic(g, g.hero ?? 0, { sizes: '(min-width:700px) 40vw, 100vw', alt: '', pos: g.heroPos })}</div>
      <div class="pm-body"><span class="kicker">Tonight, play</span><h3>${esc(g.title)}</h3><p>Play it if ${esc(g.playIf)}</p>${avail(g)}
      <div class="reasons">${top.why.map(w => `<span>${esc(w)}</span>`).join('')}</div>${sessNote}</div></a>
      ${alts.length ? `<div class="divider">Or try</div><ul class="rank alts">${alts.slice(0, 2).map(a => `<li><a href="#/review/${a.g.slug}"><span class="pos na">${scoreOrTag(a.g) ? '' : ''}</span><div><h3>${esc(a.g.title)}</h3><div class="why">${esc(a.why.slice(0, 2).join(' · '))}</div></div><span class="val">${a.g.aggregate ? a.g.aggregate.value : ''}</span></a></li>`).join('')}</ul>` : ''}`;
    $$('.alts .pos', out).forEach(p => p.remove()); $$('.alts a', out).forEach(a => a.style.gridTemplateColumns = '1fr auto');
  };
  form.addEventListener('change', draw); draw();
  const tabs = $$('[data-mode]');
  tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(x => { x.setAttribute('aria-selected', x === b); x.setAttribute('aria-pressed', x === b); });
    $('#rankOut').innerHTML = rankHtml(b.dataset.mode); animateBadges($('#rankOut'));
  }));
}

function viewSources() {
  const per = reviewed().map(g => {
    const L = [];
    const add = (label, url) => { if (url && !L.some(x => x.url === url)) L.push({ label, url }); };
    if (g.aggregate) add(`OpenCritic — ${g.title}`, g.aggregate.url);
    g.outlets.forEach(o => add(`${o.outlet} (${o.score})${o.via ? ' ' + o.via : ''}`, o.url));
    (g.hltb.src || []).forEach(s => add(s.label, s.url));
    ['seriesX', 'seriesS', 'pc', 'other'].forEach(k => g.perf[k] && (g.perf[k].src || []).forEach(s => add(`${s.label} (performance)`, s.url)));
    (g.a11y.src || []).forEach(s => add(`${s.label} (accessibility)`, s.url));
    (g.sources || []).forEach(s => add(s.label, s.url));
    add(`Official trailer: ${g.trailer.title} (${g.trailer.channel})`, `https://www.youtube.com/watch?v=${g.trailer.id}`);
    add('Xbox Store listing', g.store);
    return { g, L };
  });
  return `<div class="page"><div class="wrap">
    <header class="page-head"><span class="kicker">Transparency</span><h1>Sources &amp; credits</h1><p>Every score, time, performance note and accessibility detail on this site links back to where it came from. Data was checked ${esc(fmtDateLong(D.site.checked))}, 2026. Where no reliable data existed, we say “Not yet reported” rather than guess.</p></header>
    <section class="panel srcgrp"><h3>Lineup &amp; dates</h3><ul><li><a href="${esc(ISSUE.lineupSource)}" target="_blank" rel="noopener">Xbox Wire: Xbox Game Pass September 2026 wave 2</a></li></ul></section>
    <div class="grid cols-2" style="margin-top:14px">${per.map(({ g, L }) => `<section class="panel srcgrp reveal"><h3><a href="#/review/${g.slug}" style="color:#fff;text-decoration:none">${esc(g.title)}</a></h3><ul>${L.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul></section>`).join('')}</div>
    <section class="section panel srcgrp"><h3>Art credits</h3><p style="margin:0 0 10px">${esc(D.art.note)}</p>
      <ul>${D.games.map(g => `<li>${esc(g.title)}: © ${esc(g.dev)} and publishers. <a href="https://store.steampowered.com/app/${g.steam}/" target="_blank" rel="noopener">Steam store page (image source)</a></li>`).join('')}</ul>
      <p class="muted" style="font-size:.85rem;margin:10px 0 0">Trailers are embedded from the official Xbox, publisher or developer YouTube channels via youtube-nocookie.com and only load when played. Fonts: Anton, Oswald and Inter (SIL Open Font License), self-hosted.</p></section>
  </div></div>${footer()}`;
}
function viewNotFound() {
  return `<div class="page"><div class="wrap"><header class="page-head"><span class="kicker">404</span><h1>Not found</h1><p>That page isn’t in this issue. <a href="#/">Back to the cover</a>.</p></header></div></div>${footer()}`;
}

/* ---------- Lightbox ---------- */
const LB = (() => {
  const dlg = $('#lightbox'), img = $('#lbImg'), cnt = $('#lbCount'), cap = $('#lbCap');
  let g = null, i = 0, opener = null;
  const show = (dir = 0) => {
    const k = g.gallery[i];
    img.style.opacity = RM.matches ? 1 : .2;
    img.onload = () => { img.style.opacity = 1; img.style.transform = 'none'; };
    img.srcset = srcset(g.slug, k); img.sizes = '100vw'; img.src = `img/${g.slug}-${k}-1600.webp`;
    img.alt = `${g.title} screenshot ${i + 1} of ${g.gallery.length}`;
    cnt.textContent = `${i + 1} / ${g.gallery.length}`; cap.textContent = `${g.title} · © ${g.dev}`;
    [g.gallery[(i + 1) % g.gallery.length], g.gallery[(i - 1 + g.gallery.length) % g.gallery.length]].forEach(n => { const p = new Image(); p.src = `img/${g.slug}-${n}-1600.webp`; });
  };
  const go = d => { i = (i + d + g.gallery.length) % g.gallery.length; show(d); };
  $('#lbPrev').addEventListener('click', () => go(-1));
  $('#lbNext').addEventListener('click', () => go(1));
  $('#lbClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
  dlg.addEventListener('close', () => { document.documentElement.style.overflow = ''; if (opener) opener.focus({ preventScroll: true }); });
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.id === 'lbStage') dlg.close(); });
  // swipe
  const stage = $('#lbStage'); let x0 = null, y0 = 0, t0 = 0;
  stage.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); });
  stage.addEventListener('pointermove', e => { if (x0 == null || RM.matches) return; const dx = e.clientX - x0; if (Math.abs(dx) > 8) img.style.transform = `translateX(${dx * .6}px)`; });
  const end = e => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); } else img.style.transform = 'none';
    if (Math.abs(dx) > 8) e.stopPropagation(); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', () => { x0 = null; img.style.transform = 'none'; });
  stage.addEventListener('click', e => { if (e.target === img) e.stopPropagation(); });
  return { open(game, idx, from) { g = game; i = idx; opener = from; show(); document.documentElement.style.overflow = 'hidden'; dlg.showModal(); $('#lbClose').focus(); } };
})();

/* ---------- Router ---------- */
function route() {
  const h = location.hash || '#/';
  if (!h.startsWith('#/')) return; // in-page anchors
  const [path, qs] = h.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  const q = parseQuery(qs);
  let html, title = 'GREENLIGHT — The Game Pass Review', nav = 'home', bind = null;
  const r = parts[0] || '';
  if (r === '') { html = viewHome(); }
  else if (r === 'genres') { html = viewGenres(); nav = 'genres'; title = 'Browse by genre · GREENLIGHT'; }
  else if (r === 'genre') { html = viewGenre(parts[1]); nav = 'genres'; title = `${genreName(parts[1])} games · GREENLIGHT`; }
  else if (r === 'lineup') { html = viewLineup(q); nav = 'lineup'; title = 'The lineup · GREENLIGHT'; bind = () => bindLineup(q); }
  else if (r === 'review') { html = viewReview(parts[1]); nav = ''; const g = G[parts[1]]; if (g) title = `${g.title} review · GREENLIGHT`; bind = () => bindReview(parts[1]); }
  else if (r === 'verdict') { html = viewVerdict(); nav = 'verdict'; title = 'The verdict · GREENLIGHT'; bind = bindVerdict; }
  else if (r === 'sources') { html = viewSources(); nav = 'sources'; title = 'Sources & credits · GREENLIGHT'; }
  else html = viewNotFound();
  const same = app.dataset.route === path && r === 'lineup';
  if (same) return; // lineup filter updates use replaceState, no re-render needed
  app.dataset.route = path;
  app.innerHTML = html; document.title = title;
  document.body.classList.toggle('on-cover', r === '');
  $$('[data-nav]').forEach(a => a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  window.scrollTo(0, 0);
  if (bind) try { bind(); } catch (e) { console.error(e); }
  animateBadges(); reveal();
  if (route.first) app.focus({ preventScroll: true }); route.first = true;
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-scroll]'); if (!a) return;
  e.preventDefault(); const t = document.getElementById(a.dataset.scroll);
  if (t) t.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth' });
});
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 40), { passive: true });
addEventListener('hashchange', route);

fetch('data/issue.json').then(r => r.json()).then(d => {
  D = d; ISSUE = d.issues[0]; d.games.forEach(g => G[g.slug] = g); route();
}).catch(err => { app.innerHTML = `<div class="wrap page"><h1>Couldn’t load the issue</h1><p>${esc(err.message)}</p></div>`; });
})();
