Initial public release of pi-monotonic-permissions: deterministic, monotonic
permission enforcement for Pi tool calls.

- Canonical protected-target and prospective write checks.
- Independent global/project policy composition with ALLOW < ASK < DENY.
- One-shot Cancel-first approvals; DENY cannot be approved away.
- Fail-closed evaluation and bounded Git/publication classification.
- Guarded/trusted declarative profiles and factual approval receipts.
- No additional runtime dependencies or persistent approval database.

Qualified with Pi 0.85.1 on macOS arm64. The standalone deterministic/integration
suite has 175 passing tests. The 0.x policy API may evolve before 1.0.

This is a tool-call permission layer, not an OS sandbox. Approved programs retain
host permissions; filesystem races, incomplete hard-link coverage, extension-load
failure, other extensions and human shell operations remain documented limits.
See README.md, SECURITY.md and docs/threat-model.md before use.
