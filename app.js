import * as F from './core/forecast.mjs';

const $ = s => document.querySelector(s);
const fmtH = h => (h >= 100 ? Math.round(h) : h >= 10 ? Math.round(h) : Math.round(h * 2) / 2).toLocaleString('en-US');
const pct = x => `${(100 * x).toFixed(0)}%`;
const pct1 = x => `${(100 * x).toFixed(1)}%`;
const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

const state = { level: 0.9, target: 40 };
let H, pool, sc, f, resplit = null;

async function main() {
  H = await (await fetch('data/history.json')).json();
  pool = H.projects.filter(p => !p.showcase);
  sc = H.projects.find(p => p.showcase);
  f = F.buildForecaster(pool);
  renderStatic();
  render();
  setTimeout(() => { resplit = computeResplits(40); render(); }, 30);
}

// Repeated random re-splits: the honest check of a conformal guarantee (it holds on average over splits).
function computeResplits(R) {
  const rng = F.mulberry32(20261109);
  const levels = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
  const acc = { levels, project: levels.map(() => 0), independent: levels.map(() => 0), task: levels.map(() => 0), pointHit: 0, R, nTest: 0 };
  const tag = ps => ps.flatMap(p => p.tasks.map(t => ({ ...t, project: p.id })));
  for (let r = 0; r < R; r++) {
    const s = pool.map(p => [rng(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const a = Math.round(s.length * 0.55), b = Math.round(s.length * 0.8);
    const model = F.fitModel(tag(s.slice(0, a)));
    const cal = F.calibrateTasks(model, tag(s.slice(a, b)));
    const pr = F.calibrateProjects(model, s.slice(a, b));
    const test = s.slice(b); acc.nTest = test.length;
    let hit = 0;
    const cover = levels.map(() => [0, 0, 0, 0]);
    test.forEach((p, i) => {
      const actual = p.tasks.reduce((x, t) => x + t.actual, 0);
      hit += actual <= p.tasks.reduce((x, t) => x + t.hours, 0);
      // one set of independent draws reused for every level
      const prng = F.mulberry32(500 + i + 1000 * r), sims = 300, tot = [];
      for (let k = 0; k < sims; k++) {
        let x = 0;
        for (const t of p.tasks) { const g = cal.groups[t.category]; const pl = g && g.length >= cal.minGroup ? g : cal.pooled; x += F.pointForecast(model, t) * Math.exp(pl[Math.floor(prng() * pl.length)]); }
        tot.push(x);
      }
      levels.forEach((L, j) => {
        const iv = F.projectInterval(model, pr, p.tasks, L);
        cover[j][0] += actual >= iv.lo && actual <= iv.hi;
        cover[j][1] += actual >= F.quantile(tot, (1 - L) / 2) && actual <= F.quantile(tot, 1 - (1 - L) / 2);
        for (const t of p.tasks) { const ti = F.taskInterval(model, cal, t, L); cover[j][2] += t.actual >= ti.lo && t.actual <= ti.hi; cover[j][3]++; }
      });
    });
    acc.pointHit += hit / test.length;
    levels.forEach((L, j) => { acc.project[j] += cover[j][0] / test.length; acc.independent[j] += cover[j][1] / test.length; acc.task[j] += cover[j][2] / cover[j][3]; });
  }
  acc.pointHit /= R;
  for (const k of ['project', 'independent', 'task']) acc[k] = acc[k].map(x => x / R);
  return acc;
}

function renderStatic() {
  const repo = sc.source.split('/').slice(4, 5)[0];
  const branch = sc.source.split('/tree/')[1];
  $('#proj-title').textContent = sc.title.replace(/^Blitzy Project Guide —\s*/, '');
  $('#meta-src').innerHTML = `${esc(repo)}/main → ${esc(branch.slice(0, 15))} <i data-lucide="arrow-up-right"></i>`;
  $('#meta-src').href = sc.source;
  $('#meta-saved').textContent = `${fmtH(sc.completed_hours)}h`;
  $('#s1').textContent = sc.title;
  $('#overview').innerHTML = md(sc.overview);
  $('#more').addEventListener('click', e => { e.preventDefault(); $('#overview').classList.toggle('open'); e.target.textContent = $('#overview').classList.contains('open') ? 'Show less' : 'Show more'; });
  const total = sc.completed_hours + sc.remaining_hours;
  $('#status-line').innerHTML = `<strong>Completion: ${fmtH(sc.completed_hours)} hours completed out of ${fmtH(total)} total hours = ${(100 * sc.completed_hours / total).toFixed(1)}% complete</strong>`;
  $('#status-table').innerHTML = `
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td><strong>Total Project Hours</strong></td><td>${fmtH(total)}</td></tr>
    <tr><td><strong>Completed Hours (AI)</strong></td><td>${fmtH(sc.completed_hours)}</td></tr>
    <tr><td><strong>Remaining Hours</strong></td><td>${fmtH(sc.remaining_hours)}</td></tr>
    <tr><td><strong>Completion Percentage</strong></td><td>${(100 * sc.completed_hours / total).toFixed(1)}%</td></tr>`;
  const cal = f.split.cal;
  $('#cal-n').textContent = cal.length;
  $('#cal-dates').textContent = `${fmtDate(cal[0].date)} – ${fmtDate(cal[cal.length - 1].date)}, 2026`;
  $('#train-n').textContent = f.split.train.length;
  document.querySelectorAll('.cal-n2').forEach(n => { n.textContent = cal.length; });
  $('#corpus-n').textContent = H.projects.length;
  $('#corpus-tasks').textContent = H.projects.reduce((s, p) => s + p.tasks.length, 0).toLocaleString('en-US');
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { state.level = +b.dataset.level; render(); }));
  $('#target').addEventListener('input', e => { state.target = +e.target.value; render(); });
}

function render() {
  const L = state.level, Lp = pct(L);
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', +b.dataset.level === L));
  document.querySelectorAll('.lvl').forEach(n => { n.textContent = Lp; });
  const est = sc.tasks.reduce((s, t) => s + t.hours, 0);
  const iv = F.projectInterval(f.model, f.projResiduals, sc.tasks, L);
  const pt = state.target;
  const pDone = F.predictiveCDF(f.projResiduals, iv.point, pt, iv.scale);
  const pEst = F.predictiveCDF(f.projResiduals, iv.point, est, iv.scale);

  $('#s-est').innerHTML = `${fmtH(est)}<small>h</small>`;
  $('#s-med').innerHTML = `${fmtH(iv.median)}<small>h</small>`;
  $('#s-med-n').textContent = `×${(iv.median / est).toFixed(2)} the guide estimate`;
  $('#s-rng').innerHTML = `${fmtH(iv.lo)}–${fmtH(iv.hi)}<small>h</small>`;
  $('#s-est-n').textContent = `${pct(pEst)} chance it holds`;
  $('#meta-fc').innerHTML = `${fmtH(iv.median)}h median · ${fmtH(iv.lo)}–${fmtH(iv.hi)}h`;
  $('#t-val').textContent = `${pt} h`;
  $('#t-big').textContent = pct(pDone);
  $('#t-line').textContent = pt === 40 ? 'one engineer-week' : pt < 40 ? `${(pt / 8).toFixed(1)} engineer-days` : `${(pt / 40).toFixed(1)} engineer-weeks`;
  $('#target').value = pt;

  // Remaining work table with per-task conformal ranges and how much each task drives the upper bound.
  const tasksIv = sc.tasks.map(t => F.taskInterval(f.model, f.cal, t, L));
  const impact = sc.tasks.map((_, i) => {
    const rest = sc.tasks.filter((__, j) => j !== i);
    return iv.hi - F.projectInterval(f.model, f.projResiduals, rest, L).hi;
  });
  const maxHi = Math.max(...tasksIv.map(x => x.hi)) * 1.05, maxImp = Math.max(...impact);
  const top = impact.indexOf(maxImp);
  $('#rw-body').innerHTML = sc.tasks.map((t, i) => {
    const x = tasksIv[i], X = v => `${(100 * v / maxHi).toFixed(2)}%`;
    return `<tr class="${i === top ? 'top' : ''}">
      <td>${esc(t.task)}<div class="cat">${F.CATEGORY_LABEL[t.category]} · calibrated on ${x.n} ${x.group === 'pooled' ? 'tasks (pooled)' : 'tasks'}</div></td>
      <td class="num">${fmtH(t.hours)}</td>
      <td><span class="pri ${t.priority}">${t.priority[0].toUpperCase() + t.priority.slice(1)}</span></td>
      <td><div class="rangebar"><div class="track"></div><div class="band" style="left:${X(x.lo)};width:calc(${X(x.hi)} - ${X(x.lo)})"></div><div class="est" style="left:${X(t.hours)}"></div><div class="pt" style="left:${X(x.point)}"></div></div></td>
      <td class="rng">${fmtH(x.lo)}–${fmtH(x.hi)} h</td>
      <td class="impact"><span class="bar" style="width:${(46 * impact[i] / maxImp).toFixed(1)}px"></span>−${fmtH(impact[i])} h</td></tr>`;
  }).join('') + `<tr><td><strong>Total Remaining</strong></td><td class="num"><strong>${fmtH(est)}</strong></td><td></td><td colspan="2" class="rng"><strong>${fmtH(iv.lo)}–${fmtH(iv.hi)} h</strong> <span class="cat" style="display:inline">project-level, not a sum</span></td><td></td></tr>`;
  $('#top-task').textContent = sc.tasks[top].task;
  $('#top-drop').textContent = `${fmtH(maxImp)} h`;
  const sumHi = tasksIv.reduce((s, x) => s + x.hi, 0), sumLo = tasksIv.reduce((s, x) => s + x.lo, 0);
  $('#sum-range').textContent = `${fmtH(sumLo)}–${fmtH(sumHi)} h`;

  drawCDF(iv, est, pt);
  renderBacktest(L);
  if (window.lucide) window.lucide.createIcons();
}

function drawCDF(iv, est, target) {
  const W = Math.max(360, Math.round($('#cdf').clientWidth || 640)), Ht = 190, l = 36, r = 12, t = 10, b = 26;
  const xmax = Math.ceil(Math.max(iv.hi * 1.2, target + 10, 60) / 20) * 20;
  const X = v => l + (W - l - r) * v / xmax, Y = p => t + (Ht - t - b) * (1 - p);
  let d = '';
  for (let k = 0; k <= 240; k++) {
    const v = Math.max(0.5, xmax * k / 240);
    d += `${k ? 'L' : 'M'}${X(v).toFixed(1)},${Y(F.predictiveCDF(f.projResiduals, iv.point, v, iv.scale)).toFixed(1)}`;
  }
  const grid = [0, 0.25, 0.5, 0.75, 1].map(p => `<line x1="${l}" x2="${W - r}" y1="${Y(p)}" y2="${Y(p)}" stroke="#e9e9e9"/><text class="axis" x="${l - 6}" y="${Y(p) + 4}" text-anchor="end">${p * 100}%</text>`).join('');
  const step = xmax <= 120 ? 20 : 40;
  const xt = Array.from({ length: Math.floor(xmax / step) + 1 }, (_, i) => i * step).map(v => `<text class="axis" x="${X(v)}" y="${Ht - 8}" text-anchor="middle">${v}h</text>`).join('');
  const pT = F.predictiveCDF(f.projResiduals, iv.point, target, iv.scale);
  $('#cdf').innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}">
    ${grid}${xt}
    <rect x="${X(iv.lo)}" y="${t}" width="${X(iv.hi) - X(iv.lo)}" height="${Ht - t - b}" fill="#5b39f3" opacity="0.08"/>
    <line x1="${X(iv.lo)}" x2="${X(iv.lo)}" y1="${t}" y2="${Ht - b}" stroke="#d4cbfc"/><line x1="${X(iv.hi)}" x2="${X(iv.hi)}" y1="${t}" y2="${Ht - b}" stroke="#d4cbfc"/>
    <line x1="${X(est)}" x2="${X(est)}" y1="${t}" y2="${Ht - b}" stroke="#333" stroke-dasharray="3 3"/>
    <text class="axis" x="${X(est) + 6}" y="${t + 11}" text-anchor="start" style="fill:#333">Guide estimate ${fmtH(est)}h</text>
    <path d="${d}" fill="none" stroke="#5b39f3" stroke-width="2" stroke-linejoin="round"/>
    <line x1="${X(target)}" x2="${X(target)}" y1="${Y(pT)}" y2="${Ht - b}" stroke="#5b39f3" stroke-width="1"/>
    <line x1="${l}" x2="${X(target)}" y1="${Y(pT)}" y2="${Y(pT)}" stroke="#5b39f3" stroke-width="1" stroke-dasharray="2 3"/>
    <circle cx="${X(target)}" cy="${Y(pT)}" r="5" fill="#5b39f3" stroke="#fff" stroke-width="2"/>
    <text class="axis" x="${(X(iv.lo) + X(iv.hi)) / 2}" y="${Ht - b - 6}" text-anchor="middle" style="fill:#5b39f3;font-weight:500">${pct(state.level)} range</text>
  </svg>`;
}

function renderBacktest(L) {
  const bt = F.backtest(f.model, f.cal, f.projResiduals, f.split.test, L, { sims: 1200 });
  const rows = [
    { nm: 'Guide point estimate', sub: 'actual ≤ estimate', c: bt.pointHit, w: null },
    { nm: 'Sum of task ranges', sub: 'add each task’s interval', c: bt.sumOfTask.cover, w: bt.sumOfTask.width },
    { nm: 'Independent simulation', sub: 'tasks overrun independently', c: bt.independent.cover, w: bt.independent.width },
    { nm: 'Project-level conformal', sub: 'this forecast', c: bt.project.cover, w: bt.project.width, good: true },
  ];
  $('#bt-rows').innerHTML = rows.map(x => `<div class="mrow"><div class="nm">${x.nm}<small>${x.sub}</small></div>
    <div class="bar"><i class="${x.good ? 'good' : ''}" style="width:${(100 * x.c).toFixed(1)}%"></i><b style="left:${(100 * L).toFixed(1)}%"></b></div>
    <div class="val">${pct(x.c)} covered<small>${x.w == null ? '—' : `width ${x.w.toFixed(2)}× est.`}</small></div></div>`).join('');
  $('#bt-n').textContent = bt.n;
  $('#bt-dates').textContent = `${fmtDate(f.split.test[0].date)} – ${fmtDate(f.split.test[f.split.test.length - 1].date)}`;
  $('#bt-proj').textContent = pct1(bt.project.cover);
  const se = Math.sqrt(L * (1 - L) / bt.n);
  $('#bt-se').textContent = `±${(100 * se).toFixed(1)} pp`;
  $('#bt-ind').textContent = pct(bt.independent.cover);
  $('#bt-task').textContent = pct1(bt.taskCover);
  $('#bt-hit').textContent = pct(bt.pointHit);

  if (!resplit) { $('#curve').innerHTML = '<div class="loading">Re-splitting history…</div>'; return; }
  const j = resplit.levels.indexOf(L);
  $('#rs-proj').textContent = pct1(resplit.project[j]);
  $('#rs-ind').textContent = pct1(resplit.independent[j]);
  $('#rs-task').textContent = pct1(resplit.task[j]);
  $('#rs-R').textContent = resplit.R;
  document.querySelectorAll('.rsR').forEach(n => { n.textContent = resplit.R; });
  drawCurve(L);
}

function drawCurve(L) {
  const W = Math.max(320, Math.round($('#curve').clientWidth || 420)), Ht = 230, l = 40, r = 12, t = 12, b = 36;
  const lo = 0.4, X = v => l + (W - l - r) * (v - lo) / (1 - lo), Y = v => t + (Ht - t - b) * (1 - (v - lo) / (1 - lo));
  const ticks = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const grid = ticks.map(v => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e9e9e9"/><text class="axis" x="${l - 6}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text><text class="axis" x="${X(v)}" y="${Ht - 20}" text-anchor="middle">${v * 100}%</text>`).join('');
  const line = (arr, color, dash = '') => {
    const d = resplit.levels.map((v, i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(Math.max(lo, arr[i])).toFixed(1)}`).join('');
    const dots = resplit.levels.map((v, i) => `<circle cx="${X(v)}" cy="${Y(Math.max(lo, arr[i]))}" r="${v === L ? 4.5 : 3}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>${dots}`;
  };
  $('#curve').innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}">
    ${grid}<text class="axis" x="${(l + W - r) / 2}" y="${Ht - 1}" text-anchor="middle">Promised coverage</text>
    <line x1="${X(lo)}" y1="${Y(lo)}" x2="${X(1)}" y2="${Y(1)}" stroke="#999" stroke-dasharray="3 3"/>
    ${line(resplit.independent, '#d4cbfc', '4 3')}${line(resplit.project, '#5b39f3')}
  </svg>`;
}

main().catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="color:#991010;padding:20px">${esc(String(e && e.stack || e))}</pre>`); console.error(e); });
