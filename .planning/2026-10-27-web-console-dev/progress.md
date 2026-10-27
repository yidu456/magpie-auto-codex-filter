# Progress

- 2026-10-27: Read source and inherited setup constraints; working tree clean.
- Created dev from cd68b07 (main unchanged). Legacy suite: 58/58 pass.
- Wrote and reviewed design plus six implementation tasks with interfaces/tests/commits.
- No real client config/runtime changed; no paid requests or service restarts.
- Task 1: confirmed red against stock proxy; immutable policy, seven handler gates, stable service identity and retry snapshots implemented. All 83 tests pass; diff reviewed.
- Task 2: four regression tests failed first, then passed. Core bypass preserves gzip bytes, SSE streams without late replay when unbuffered, heartbeat can be disabled. Uploads count as active before body reads. Full suite 87/87; diff reviewed.
- Task 3 first pass: controller/API tests pass; review regressions reproduced omitted-policy implicit activation and unsafe shutdown after user edits within the same filter origin. Required explicit enable, reused endpoint parser, and refused shutdown until no supported endpoint points to filter. Full suite 98/98. Independent read-only review in progress.
- Task 3 complete: independent review found unowned-port takeover after failed activation and abandoned exit response stranding a closed controller. Both reproduced, fixed, and re-reviewed. 13 console tests plus 87 existing tests pass (100 total). No live configuration touched.
