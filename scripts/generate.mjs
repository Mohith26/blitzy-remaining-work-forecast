// Simulate how long each remaining-work task actually took a human team.
// The estimates and task names are REAL (data/guides.json, parsed from public Blitzy Project Guides).
// The actual hours are SYNTHETIC: only Blitzy has that signal (PR merge times, follow-up commits,
// ticket time logs). The truth model below is an assumption, written down so the demo is honest.
//
//   log(actual / estimate) = mu[category] + priority + size + u_project + b_project * blocked[category] + eps
//     u_project  ~ Normal(0, 0.22)               shared friction inside one project (same env, same reviewers)
//     b_project  ~ Bernoulli(0.25) * log(1 + Exp(mean 0.6))   access/approval stall, hits environment/security/CI tasks
//     eps        ~ sigma[category] * t(4) * 0.55 heavy-tailed task noise
//     size       = 0.15 * max(0, log(2 / hours))   sub-2h items run proportionally long
// Usage: node scripts/generate.mjs  (seed 20261105) -> data/history.json
import { readFileSync, writeFileSync } from 'node:fs';
import { categorize, mulberry32 } from '../core/forecast.mjs';

const SEED = 20261105;
const SHOWCASE = 'blitzy-0ccb0fc7-ed62-4563-b19d-aee201d5031d'; // AWS CardDemo COBOL-to-Java Migration
const MU = { security: 0.30, observability: 0.10, cicd: 0.28, testing: 0.20, environment: 0.30, review: 0.35, handoff: -0.05, build: 0.40, decision: 0.45, other: 0.20 };
const SIGMA = { security: 0.50, observability: 0.35, cicd: 0.45, testing: 0.40, environment: 0.50, review: 0.45, handoff: 0.30, build: 0.55, decision: 0.60, other: 0.45 };
const PRIORITY = { critical: 0.08, high: 0.05, medium: 0, low: -0.05 };
const BLOCKABLE = new Set(['environment', 'security', 'cicd']);

const rng = mulberry32(SEED);
const normal = () => { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
const t4 = () => { let c = 0; for (let i = 0; i < 4; i++) { const z = normal(); c += z * z; } return normal() / Math.sqrt(c / 4); };
const expo = mean => -mean * Math.log(1 - rng());

const { guides } = JSON.parse(readFileSync(new URL('../data/guides.json', import.meta.url)));
const start = Date.UTC(2026, 0, 5), end = Date.UTC(2026, 9, 30);
const projects = guides.map(g => {
  const showcase = g.source.endsWith(SHOWCASE);
  const date = showcase ? '2026-11-04' : new Date(start + rng() * (end - start)).toISOString().slice(0, 10);
  const u = 0.22 * normal();
  const blocked = rng() < 0.25 ? Math.log(1 + expo(0.6)) : 0;
  const tasks = g.tasks.map(t => {
    const category = categorize(t.task);
    const size = 0.15 * Math.max(0, Math.log(2 / t.hours));
    const lr = MU[category] + PRIORITY[t.priority] + size + u + (BLOCKABLE.has(category) ? blocked : 0) + SIGMA[category] * 0.55 * t4();
    const actual = Math.max(0.25, Math.round(t.hours * Math.exp(lr) * 4) / 4);
    return { task: t.task, hours: t.hours, priority: t.priority, category, actual };
  });
  return { id: g.id, source: g.source, title: g.title, completed_hours: g.completed_hours, ...(showcase ? { overview: g.overview, remaining_hours: g.remaining_hours } : {}), date, showcase, project_effect: +u.toFixed(4), blocked: blocked > 0, tasks };
});
writeFileSync(new URL('../data/history.json', import.meta.url), JSON.stringify({
  seed: SEED, note: 'Task names, estimates and priorities are real (public Blitzy Project Guides). Actual hours, dates, project_effect and blocked are synthetic (see scripts/generate.mjs).',
  truth: { MU, SIGMA, PRIORITY, project_sd: 0.22, blocked_rate: 0.25 }, projects }));
const n = projects.reduce((s, p) => s + p.tasks.length, 0);
const cats = {}; projects.forEach(p => p.tasks.forEach(t => { cats[t.category] = (cats[t.category] || 0) + 1; }));
console.log(projects.length, 'projects,', n, 'tasks', cats);
