# Remaining Work Forecast for Blitzy Project Guides (concept demo)

**Live demo:** https://mohith26.github.io/blitzy-remaining-work-forecast/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Blitzy.

Every Blitzy Project Guide ends the autonomous part of a project with a handoff: "326 hours completed, 34 hours remain", followed by a Remaining Work Detail table that splits those 34 hours across tasks like *CI/CD Pipeline Configuration (8h)* or *Production Database Provisioning (4h)*. That number is what an engineering manager plans the human 20% around, and it is a single point estimate.

This demo adds a **Remaining work forecast** to the Project Guide view (step 6 of the project page), rebuilt to look like the production app:

- **Calibrated median and range for the whole project** (e.g. "34h in the guide, 48h median, 90% range 33–100h"), with a guarantee that the range holds on 90% of projects.
- **"Chance it's done within N hours"** from a conformal predictive distribution (drag the slider).
- **Per-task ranges** in the Remaining Work Detail table, calibrated separately for each kind of work (environment and access, CI/CD, security, review, testing...).
- **Range impact**: how far the project's upper bound drops once a task is closed, so the team can attack the task that removes the most uncertainty first.
- **Forecast Calibration** section: held-out backtest against the alternatives, and a calibration curve across confidence levels.

## Why this is a real gap

- Project Guides give point estimates. Across the 383 public guides I parsed, no Remaining Work Detail table gives a range. In 30 of them the agents apply hand-set "Enterprise Multipliers" (for example 1.10× compliance × 1.10× uncertainty buffer = 1.21×), which is the right instinct with no data behind the number.
- The guides themselves sometimes write ad hoc ranges by hand in other sections (the CardDemo guide lists "4–8 hours" for CI/CD in *Critical Unresolved Issues* and 8 hours in the table).
- Blitzy's docs already show a range for *agent runtime* ("Estimated 2 - 8 hours to complete", from comparable runs). Nothing equivalent exists for the *human* remaining work, which is the number customers budget against.

## How it works

`core/forecast.mjs` (no dependencies, runs in the browser and in Node):

1. **Categorize** each remaining-work row with ordered rules (security, observability, CI/CD and release, testing and QA, environment and access, code review and merge, docs and handoff, decisions and coordination, implementation, other).
2. **Bias correction**: per category, the median of log(actual / estimate) on the oldest 55% of projects, shrunk toward the global median (weight n/(n+20)).
3. **Per-task ranges**: Mondrian (category-conditional) split conformal on the signed log residuals, with separate lower and upper tails because overruns are right-skewed; the finite-sample quantile is the ceil((n+1)p)-th order statistic, and categories with fewer than 30 calibration tasks fall back to the pooled residuals.
4. **Project range**: tasks inside one project overrun together (same environment, same approvers, same customer process), so the total is calibrated as one unit: the score is log(actual total / predicted total), normalized by a project-specific scale (between-project sd plus forecast-weighted task noise, fitted on the training split). Split conformal on these scores gives a valid interval for the total; the same scores give a **conformal predictive distribution** (Vovk et al.), which is the "chance it's done within N hours" curve.
5. **Range impact**: the drop in the project's upper bound when one task is removed from the remaining set.
6. **Backtest**: the chronologically newest 20% of projects are held out, plus 40 random re-splits (the conformal guarantee holds on average over exchangeable splits, so this is the honest check).

What the backtest shows on this data (all numbers recomputed live on the page):

| Method | Coverage at 90% (latest 65 projects) | Avg. over random re-splits |
|---|---|---|
| Guide point estimate (actual ≤ estimate) | 12% | 12% |
| Sum of per-task ranges | 100%, but 2.8× the estimate wide | ~98% |
| Independent simulation (tasks overrun independently) | 75% | ~71% |
| **Project-level conformal (this forecast)** | 86% (±3.7 pp sampling error) | **~90%** |

The independence assumption is the interesting failure: it looks principled, and it under-covers because the shared project friction is exactly what makes a remaining-work estimate slip.

## Data

- `data/guides.json`: **real** remaining-work rows (task name, hours, priority), completed hours and the overview paragraph, parsed from 328 unique public Blitzy Project Guides (2,390 tasks) in github.com/Blitzy-Sandbox and github.com/blitzy-public-samples. Re-create with `scripts/fetch_guides.sh` (GitHub CLI) and `scripts/extract_corpus.py`.
- `data/history.json`: the same projects plus **synthetic** actual completion hours and PR dates from `scripts/generate.mjs` (seed 20261105). Only Blitzy has the real signal (time from PR open to merge, follow-up commits, ticket time logs), so the truth model is written down in the script: a per-category bias, a shared project effect (sd 0.22), a 25% chance of an access/approval stall that hits environment, security and CI tasks together, heavy-tailed task noise, and longer relative overruns for sub-2-hour items.
- The page shows the AWS CardDemo COBOL-to-Java Migration guide (blitzy-public-samples/aws-carddemo-blitzy, branch blitzy-0ccb0fc7...), whose 8 remaining tasks and 34 hours are its real numbers. Its synthetic outcome is never used by the model.

## Tests

```
node --test test/forecast.test.mjs     # 7 tests: categorization, finite-sample quantile, coverage on skewed exchangeable data,
                                       # bias recovery, CDF monotonicity/nesting, end-to-end calibration vs independence, data integrity
node scripts/coverage.mjs 60           # chronological backtest + 60 random re-splits
```

## Honest limitations

- **Outcomes are simulated.** The method and the UI are real; the coverage numbers are only as meaningful as the truth model. With Blitzy's own merge and time-log data the same code would fit real bias and spread per category, and the backtest would become a real claim.
- Conformal validity assumes past projects are exchangeable with the new one. The chronological split is the drift check; a production version would add a recency weighting or an online (adaptive conformal) update as the agents and the customer mix change.
- Categories come from keyword rules on task names. Blitzy already knows each task's type when it writes the guide, which would be cleaner.
- Range impact removes one task at a time; it is a prioritization hint, not a causal effect.
- The app shell is rebuilt from public screenshots, the docs and the production CSS tokens (Inter, Roboto Mono, #5B39F3, Lucide icons). The Project Guide panel itself has no public screenshot, so its document styling follows the tech-spec markdown rules in the production stylesheet.

## Novelty note

Checked Blitzy's docs (Project Guide, Code, Code Review, PR Review, Glossary), blog, launch posts, the Nov 2026 TFiR interview, and all 383 public Project Guides: remaining human hours are point estimates (sometimes multiplied by fixed buffers). Adjacent work exists but targets different numbers: Cognition's AI Productivity Guarantee estimates hours of output Devin delivered, open-source agent-estimate does PERT estimates of agent task time, and Blitzy's own runtime estimate is a range for agent generation time.
