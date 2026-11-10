// Calibrated remaining-work forecasts for Blitzy Project Guides.
// Pure functions, no dependencies; runs in the browser (ES module) and under `node --test`.
//
// Pipeline
//   1. categorize(task)            map a remaining-work row to a work category (ordered regex rules)
//   2. fitModel(trainTasks)        per-category bias of log(actual / estimate), shrunk to the global median
//   3. calibrateTasks(...)         split-conformal residual pools per category (Mondrian), pooled fallback
//   4. taskInterval(...)           finite-sample valid interval for one task's actual hours
//   5. calibrateProjects(...)      project-level residuals log(actual total / predicted total)
//   6. projectInterval / predictiveCDF   valid interval and conformal predictive distribution for the total
//   7. independentMonteCarlo       the tempting baseline that assumes tasks overrun independently
//   8. backtest                    coverage and width of every method on held-out projects

export const CATEGORIES = [
  { key: 'security', label: 'Security', re: /secur|vulnerab|\bcve|owasp|harden|threat|\bsast\b|\bdast\b|pen[- ]?test|codeql|semgrep|dependency[- ]check|\bauthn?\b|permission/i },
  { key: 'observability', label: 'Observability', re: /monitor|alert|dashboard|grafana|prometheus|observab|logging|tracing|telemetry/i },
  { key: 'cicd', label: 'CI/CD & release', re: /ci\/cd|\bci\b|pipeline|deploy|release|rollout|rollback|cutover|runbook|terraform|github actions|jenkins|build matrix|rebase|packag|publish|continuous-integration/i },
  { key: 'testing', label: 'Testing & QA', re: /test|\bqa\b|\buat\b|smoke|load|perf|benchmark|regression|valid|verif|e2e|playtest|conformance|coverage|parity|characteriz|certif|spot-check|dry-run|dual-run/i },
  { key: 'environment', label: 'Environment & access', re: /credential|secret|api key|\bkey\b|access|provision|environment|env var|database|\bdb\b|license|account|infrastructure|cloud|\baws\b|azure|\bgcp\b|kubernetes|config/i },
  { key: 'review', label: 'Code review & merge', re: /review|merge|pull request|\bpr\b|approv|accept/i },
  { key: 'handoff', label: 'Docs & handoff', re: /doc|readme|knowledge transfer|training|handoff|hand-off|stakeholder|sign-?off|presentation|onboard/i },
  { key: 'decision', label: 'Decisions & coordination', re: /decision|decide|planning|coordinat|cadence|\bscope\b|owner|policy|ratif|programme|governance/i },
  { key: 'build', label: 'Implementation & fixes', re: /implement|fix|complet|\badd|build|migrat|refactor|port|integrat|support|feature|bug|wire|enable|remov|updat|upgrad/i },
];
export const OTHER = { key: 'other', label: 'Other' };
export const CATEGORY_KEYS = [...CATEGORIES.map(c => c.key), OTHER.key];
export const CATEGORY_LABEL = Object.fromEntries([...CATEGORIES, OTHER].map(c => [c.key, c.label]));

export function categorize(text) {
  for (const c of CATEGORIES) if (c.re.test(text)) return c.key;
  return OTHER.key;
}

// Small seeded PRNG (mulberry32) so every number on the page is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Empirical quantile with linear interpolation (used only for descriptive numbers and Monte Carlo).
export function quantile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

// Split-conformal upper quantile: the ceil((n+1)p)-th smallest score.
// If a new score is exchangeable with the n calibration scores, P(score_new <= q) >= p.
// Returns +Infinity when n is too small for the requested level (honest, no false precision).
export function conformalUpper(scores, p) {
  const s = [...scores].sort((a, b) => a - b);
  const k = Math.ceil((s.length + 1) * p);
  return k > s.length ? Infinity : s[k - 1];
}

// Two-sided interval for a signed residual at miscoverage alpha (alpha/2 per tail).
// Coverage >= 1 - alpha by the union bound; asymmetric, which matters because overruns are right-skewed.
export function signedInterval(residuals, level) {
  const a = (1 - level) / 2;
  const hi = conformalUpper(residuals, 1 - a);
  const lo = -conformalUpper(residuals.map(r => -r), 1 - a);
  return { lo, hi };
}

const logRatio = t => Math.log(t.actual / t.hours);

// Per-category multiplicative bias: median log(actual/estimate), shrunk toward the global median
// with weight n / (n + k). Robust to the heavy right tail of blocked tasks.
export function fitModel(trainTasks, { shrink = 20 } = {}) {
  const all = trainTasks.map(logRatio);
  const global = median(all);
  const bias = {}, count = {};
  for (const key of CATEGORY_KEYS) {
    const r = trainTasks.filter(t => t.category === key).map(logRatio);
    count[key] = r.length;
    bias[key] = r.length ? (r.length * median(r) + shrink * global) / (r.length + shrink) : global;
  }
  // Scale model for normalized (locally weighted) conformal at the project level:
  // per-category residual sd, and the between-project sd tau that tasks in one project share.
  const sd = {};
  const res = t => Math.log(t.actual / (t.hours * Math.exp(bias[t.category])));
  const pooledSd = std(trainTasks.map(res));
  for (const key of CATEGORY_KEYS) {
    const r = trainTasks.filter(t => t.category === key).map(res);
    sd[key] = r.length >= 10 ? (r.length * std(r) + shrink * pooledSd) / (r.length + shrink) : pooledSd;
  }
  const byProject = new Map();
  for (const t of trainTasks) { if (!byProject.has(t.project)) byProject.set(t.project, []); byProject.get(t.project).push(t); }
  const rp = [], within = [];
  for (const ts of byProject.values()) {
    const w = ts.map(t => t.hours * Math.exp(bias[t.category])), W = w.reduce((a, b) => a + b, 0);
    rp.push(Math.log(ts.reduce((s, t) => s + t.actual, 0) / W));
    within.push(ts.reduce((s, t, i) => s + (w[i] * sd[t.category]) ** 2, 0) / (W * W));
  }
  const tau = Math.sqrt(Math.max(0.01, variance(rp) - within.reduce((a, b) => a + b, 0) / Math.max(1, within.length)));
  return { global, bias, count, shrink, sd, tau };
}

function variance(xs) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1); }
function std(xs) { return xs.length > 1 ? Math.sqrt(variance(xs)) : 0.5; }

// Project-specific spread: shared friction tau plus the forecast-weighted task noise.
// Few large risky tasks -> wider; many small well-understood tasks -> narrower.
export function projectScale(model, tasks) {
  const w = tasks.map(t => pointForecast(model, t)), W = w.reduce((a, b) => a + b, 0);
  const within = tasks.reduce((s, t, i) => s + (w[i] * (model.sd[t.category] ?? model.tau)) ** 2, 0) / (W * W);
  return Math.sqrt(model.tau ** 2 + within);
}

export const pointForecast = (model, task) => task.hours * Math.exp(model.bias[task.category] ?? model.global);

// Residual pools for Mondrian (category-conditional) split conformal.
export function calibrateTasks(model, calTasks, { minGroup = 30 } = {}) {
  const residual = t => Math.log(t.actual / pointForecast(model, t));
  const pooled = calTasks.map(residual);
  const groups = {};
  for (const key of CATEGORY_KEYS) groups[key] = calTasks.filter(t => t.category === key).map(residual);
  return { pooled, groups, minGroup };
}

export function taskInterval(model, cal, task, level) {
  const g = cal.groups[task.category] || [];
  const useGroup = g.length >= cal.minGroup;
  const { lo, hi } = signedInterval(useGroup ? g : cal.pooled, level);
  const p = pointForecast(model, task);
  return { point: p, lo: p * Math.exp(lo), hi: p * Math.exp(hi), group: useGroup ? task.category : 'pooled', n: useGroup ? g.length : cal.pooled.length };
}

export const projectPoint = (model, tasks) => tasks.reduce((s, t) => s + pointForecast(model, t), 0);

// Project-level residuals. Tasks inside one project share friction (same environment, same reviewers,
// same customer process), so the total must be calibrated as a unit, not assembled from task intervals.
// Scores are normalized by projectScale (locally weighted conformal), so validity is unchanged
// while the width adapts to each project's mix of tasks.
export function calibrateProjects(model, calProjects) {
  return calProjects.map(p => Math.log(p.tasks.reduce((s, t) => s + t.actual, 0) / projectPoint(model, p.tasks)) / projectScale(model, p.tasks));
}

export function projectInterval(model, projResiduals, tasks, level) {
  const p = projectPoint(model, tasks), k = projectScale(model, tasks);
  const { lo, hi } = signedInterval(projResiduals, level);
  return { point: p, lo: p * Math.exp(k * lo), hi: p * Math.exp(k * hi), median: p * Math.exp(k * median(projResiduals)), scale: k, n: projResiduals.length };
}

// Conformal predictive distribution for the project total (Vovk et al.): a calibrated CDF.
// F(t) = (#{r_j < s} + 0.5 * (#{r_j = s} + 1)) / (n + 1), s = log(t / point) / scale.
export function predictiveCDF(projResiduals, point, t, scale = 1) {
  const s = Math.log(t / point) / scale;
  let below = 0, ties = 0;
  for (const r of projResiduals) { if (r < s - 1e-12) below++; else if (Math.abs(r - s) <= 1e-12) ties++; }
  return (below + 0.5 * (ties + 1)) / (projResiduals.length + 1);
}

// Baseline: simulate each task independently from its category's calibration residuals and sum.
export function independentMonteCarlo(model, cal, tasks, { level = 0.9, sims = 4000, seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const totals = new Float64Array(sims);
  for (let i = 0; i < sims; i++) {
    let s = 0;
    for (const t of tasks) {
      const g = cal.groups[t.category];
      const pool = g && g.length >= cal.minGroup ? g : cal.pooled;
      s += pointForecast(model, t) * Math.exp(pool[Math.floor(rng() * pool.length)]);
    }
    totals[i] = s;
  }
  const a = (1 - level) / 2;
  return { lo: quantile(totals, a), hi: quantile(totals, 1 - a), median: quantile(totals, 0.5) };
}

// Held-out evaluation of every method on projects the model never saw.
export function backtest(model, cal, projResiduals, testProjects, level, { sims = 1500 } = {}) {
  const res = { pointHit: 0, sumOfTask: { cover: 0, width: 0 }, independent: { cover: 0, width: 0 }, project: { cover: 0, width: 0 }, taskCover: 0, taskN: 0, byCategory: {}, n: testProjects.length };
  for (const key of CATEGORY_KEYS) res.byCategory[key] = { cover: 0, n: 0 };
  testProjects.forEach((p, i) => {
    const actual = p.tasks.reduce((s, t) => s + t.actual, 0);
    const est = p.tasks.reduce((s, t) => s + t.hours, 0);
    if (actual <= est) res.pointHit++;
    let lo = 0, hi = 0;
    for (const t of p.tasks) {
      const iv = taskInterval(model, cal, t, level);
      lo += iv.lo; hi += iv.hi;
      const ok = t.actual >= iv.lo && t.actual <= iv.hi;
      res.taskCover += ok; res.taskN++;
      res.byCategory[t.category].cover += ok; res.byCategory[t.category].n++;
    }
    res.sumOfTask.cover += actual >= lo && actual <= hi; res.sumOfTask.width += (hi - lo) / est;
    const mc = independentMonteCarlo(model, cal, p.tasks, { level, sims, seed: 1000 + i });
    res.independent.cover += actual >= mc.lo && actual <= mc.hi; res.independent.width += (mc.hi - mc.lo) / est;
    const pj = projectInterval(model, projResiduals, p.tasks, level);
    res.project.cover += actual >= pj.lo && actual <= pj.hi; res.project.width += (pj.hi - pj.lo) / est;
  });
  const n = testProjects.length;
  res.pointHit /= n;
  for (const k of ['sumOfTask', 'independent', 'project']) { res[k].cover /= n; res[k].width /= n; }
  res.taskCover /= res.taskN;
  for (const key of CATEGORY_KEYS) { const c = res.byCategory[key]; c.rate = c.n ? c.cover / c.n : NaN; }
  return res;
}

// Split projects chronologically (by PR-opened date) into train / calibration / test.
export function chronologicalSplit(projects, { train = 0.55, cal = 0.25 } = {}) {
  const s = [...projects].sort((a, b) => a.date.localeCompare(b.date));
  const a = Math.round(s.length * train), b = Math.round(s.length * (train + cal));
  return { train: s.slice(0, a), cal: s.slice(a, b), test: s.slice(b) };
}

// End-to-end: fit on train, calibrate on cal, forecast a target project.
export function buildForecaster(projects, opts = {}) {
  const split = chronologicalSplit(projects, opts);
  const flat = ps => ps.flatMap(p => p.tasks.map(t => ({ ...t, project: p.id })));
  const model = fitModel(flat(split.train), opts);
  const cal = calibrateTasks(model, flat(split.cal), opts);
  const projResiduals = calibrateProjects(model, split.cal);
  return { split, model, cal, projResiduals };
}
