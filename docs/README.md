# Documentation

| Document                                                  | Owner   | What it covers                                                         |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| [Master blueprint](blueprint/C32_Master_Blueprint.docx)   | All     | Critical review, domain rules, architecture, tests, business           |
| [Four-track roadmap](blueprint/C32_Roadmap_4_Tracks.docx) | All     | Work packages, milestones, handoffs, relief valves                     |
| [API contract](api/README.md)                             | Track 1 | Contract v0.1: schemas, codes, routes, changelog                       |
| [OpenAPI 3.1](api/openapi.json)                           | Track 1 | Generated from the Zod schemas; never edit by hand                     |
| [Track 1 handoff](architecture/track1-handoff.md)         | Track 1 | What Track 3 deploys: functions, triggers, env vars, IAM, alarms       |
| [Track 2 handoff](architecture/track2-handoff.md)         | Track 2 | Deploying the web app, evidence for Track 4, viva answers              |
| [UI screenshots](ui/screenshots)                          | Track 2 | 17 screenshots of every screen, for the evidence bundle                |
| [Test traceability](testing/traceability.md)              | Track 1 | Every golden test T01 to T25 and property P1 to P6, and what proves it |
| [Performance](testing/performance.md)                     | Track 1 | Local latency check against the 500 ms target (not AWS)                |
| [Decision log](architecture/decisions.md)                 | All     | Every scope or design decision with date and reason                    |
| [Contributing](../.github/CONTRIBUTING.md)                | All     | Branch per work package, commit style, merge rule                      |
