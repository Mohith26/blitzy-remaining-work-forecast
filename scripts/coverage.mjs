// Coverage check. (1) Chronological backtest used on the page. (2) Repeated random splits:
// split-conformal guarantees average coverage >= level over random exchangeable splits, so this
// is the honest test of the implementation. Usage: node scripts/coverage.mjs [repeats]
import { readFileSync } from 'node:fs';
import { buildForecaster, backtest, mulberry32, fitModel, calibrateTasks, calibrateProjects } from '../core/forecast.mjs';

const { projects } = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url)));
const pool = projects.filter(p => !p.showcase);
const f = buildForecaster(pool);
for (const level of [0.8, 0.9]) {
  const b = backtest(f.model, f.cal, f.projResiduals, f.split.test, level);
  console.log(`chronological ${level}: n=${b.n} pointHit=${b.pointHit.toFixed(3)} task=${b.taskCover.toFixed(3)} sumOfTask=${b.sumOfTask.cover.toFixed(3)}/${b.sumOfTask.width.toFixed(2)} independent=${b.independent.cover.toFixed(3)}/${b.independent.width.toFixed(2)} project=${b.project.cover.toFixed(3)}/${b.project.width.toFixed(2)}`);
}
const R = +(process.argv[2] || 100);
const rng = mulberry32(99);
const acc = { task: 0, project: 0, independent: 0, sumOfTask: 0 };
for (let r = 0; r < R; r++) {
  const s = [...pool].map(p => [rng(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const a = Math.round(s.length * 0.55), b = Math.round(s.length * 0.8);
  const model = fitModel(s.slice(0, a).flatMap(p => p.tasks.map(t => ({ ...t, project: p.id }))));
  const cal = calibrateTasks(model, s.slice(a, b).flatMap(p => p.tasks));
  const pr = calibrateProjects(model, s.slice(a, b));
  const bt = backtest(model, cal, pr, s.slice(b), 0.9, { sims: 400 });
  acc.task += bt.taskCover; acc.project += bt.project.cover; acc.independent += bt.independent.cover; acc.sumOfTask += bt.sumOfTask.cover;
}
for (const k in acc) acc[k] = +(acc[k] / R).toFixed(3);
console.log(`random splits x${R} at 0.9:`, acc);
