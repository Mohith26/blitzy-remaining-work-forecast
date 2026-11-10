import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../core/forecast.mjs';

const history = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url)));
const guides = JSON.parse(readFileSync(new URL('../data/guides.json', import.meta.url))).guides;

test('categorize maps real Project Guide rows to the intended categories', () => {
  const cases = {
    'OWASP NVD Vulnerability Scan & Remediation': 'security',
    'Production Database Provisioning & Configuration': 'environment',
    'Secrets Management (Vault/Environment Variables)': 'environment',
    'Grafana Dashboard Template': 'observability',
    'CI/CD Pipeline Configuration': 'cicd',
    'Performance & Load Testing': 'testing',
    'Human code review & PR approval/merge': 'review',
    'Knowledge Transfer Session with Development Team': 'handoff',
    'Snowflake warehouse-sizing decision and cost-baseline analysis': 'decision',
    'Implement 3 missing invoicing handlers (send invoice, line-items CRUD, update payment)': 'build',
  };
  for (const [text, key] of Object.entries(cases)) assert.equal(F.categorize(text), key, text);
});

test('conformalUpper uses the ceil((n+1)p)-th order statistic and refuses impossible levels', () => {
  const s = [9, 1, 8, 2, 7, 3, 6, 4, 5];
  assert.equal(F.conformalUpper(s, 0.9), 9);
  assert.equal(F.conformalUpper(s, 0.5), 5);
  assert.equal(F.conformalUpper([1, 2, 3, 4, 5], 0.9), Infinity);
});

test('split conformal intervals hit nominal coverage on exchangeable skewed data', () => {
  const rng = F.mulberry32(3);
  const draw = () => Math.log(1 + 3 * rng()) + (rng() < 0.2 ? 1.5 * rng() : 0); // right-skewed
  for (const level of [0.8, 0.9]) {
    let cover = 0; const R = 3000;
    for (let r = 0; r < R; r++) {
      const cal = Array.from({ length: 60 }, draw);
      const { lo, hi } = F.signedInterval(cal, level);
      const x = draw();
      cover += x >= lo && x <= hi;
    }
    assert.ok(cover / R >= level - 0.015, `coverage ${cover / R} at ${level}`);
    assert.ok(cover / R <= level + 0.06, `not trivially wide: ${cover / R}`);
  }
});

test('fitModel recovers known category bias from data', () => {
  const rng = F.mulberry32(11);
  const tasks = [];
  for (let i = 0; i < 4000; i++) {
    const category = i % 2 ? 'security' : 'handoff';
    const mu = category === 'security' ? 0.4 : -0.1;
    tasks.push({ category, hours: 4, actual: 4 * Math.exp(mu + 0.3 * (rng() - 0.5)), project: 'p' + (i % 200) });
  }
  const m = F.fitModel(tasks);
  assert.ok(Math.abs(m.bias.security - 0.4) < 0.03, m.bias.security);
  assert.ok(Math.abs(m.bias.handoff + 0.1) < 0.03, m.bias.handoff);
});

test('predictive CDF is monotone, bounded and consistent with the interval', () => {
  const f = F.buildForecaster(history.projects.filter(p => !p.showcase));
  const sc = history.projects.find(p => p.showcase);
  const iv = F.projectInterval(f.model, f.projResiduals, sc.tasks, 0.9);
  let prev = 0;
  for (let t = 10; t <= 150; t += 2) {
    const c = F.predictiveCDF(f.projResiduals, iv.point, t, iv.scale);
    assert.ok(c > 0 && c < 1 && c >= prev); prev = c;
  }
  assert.ok(F.predictiveCDF(f.projResiduals, iv.point, iv.lo * 0.999, iv.scale) <= 0.06);
  assert.ok(F.predictiveCDF(f.projResiduals, iv.point, iv.hi * 1.001, iv.scale) >= 0.94);
  const iv80 = F.projectInterval(f.model, f.projResiduals, sc.tasks, 0.8);
  assert.ok(iv.lo <= iv80.lo && iv80.hi <= iv.hi, 'nested intervals');
});

test('end to end: project-level conformal is calibrated, independence is not, point estimates are optimistic', () => {
  const pool = history.projects.filter(p => !p.showcase);
  const rng = F.mulberry32(5);
  let proj = 0, ind = 0, task = 0, hit = 0; const R = 25;
  for (let r = 0; r < R; r++) {
    const s = pool.map(p => [rng(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const a = Math.round(s.length * 0.55), b = Math.round(s.length * 0.8);
    const tag = ps => ps.flatMap(p => p.tasks.map(t => ({ ...t, project: p.id })));
    const model = F.fitModel(tag(s.slice(0, a)));
    const cal = F.calibrateTasks(model, tag(s.slice(a, b)));
    const pr = F.calibrateProjects(model, s.slice(a, b));
    const bt = F.backtest(model, cal, pr, s.slice(b), 0.9, { sims: 300 });
    proj += bt.project.cover; ind += bt.independent.cover; task += bt.taskCover; hit += bt.pointHit;
  }
  proj /= R; ind /= R; task /= R; hit /= R;
  assert.ok(proj > 0.86 && proj < 0.95, `project ${proj}`);
  assert.ok(task > 0.87 && task < 0.94, `task ${task}`);
  assert.ok(proj - ind > 0.08, `independence under-covers: ${ind}`);
  assert.ok(hit < 0.3, `point estimates rarely hold: ${hit}`);
});

test('data: estimates are the real Project Guide numbers; showcase guide matches its own totals', () => {
  assert.ok(guides.length > 300);
  for (const g of guides) for (const t of g.tasks) assert.ok(t.hours > 0 && t.task.length > 0);
  const sc = history.projects.find(p => p.showcase);
  assert.equal(sc.tasks.length, 8);
  assert.equal(sc.tasks.reduce((s, t) => s + t.hours, 0), 34);
  assert.equal(sc.completed_hours, 326);
  const g = guides.find(x => x.id === sc.id);
  assert.deepEqual(sc.tasks.map(t => t.hours), g.tasks.map(t => t.hours));
});
