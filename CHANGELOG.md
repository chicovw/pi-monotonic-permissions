## Unreleased - V1.3 development

V1.3 is an architecture milestone, not a newly published semantic version.
Package metadata remains 0.1.0 pending the operator release gate.

- Explicit reviewed custom-tool adapters, beginning with Blackhole 0.5.3 recall.
- Trusted unknown-tool ASK fallback; guarded defaults to DENY with explicit ASK opt-in.
- Independent global/project custom-tool policy with monotonic composition.
- Narrow custom-operation session grants and persistent reviewed-operation grants.
- Grant invalidation by policy/mode/context and exposed tool/source contract identity.
- Execution eligibility above policy, grants and mode, using
  PUBLIC < INTERNAL < PRIVATE < SECRET. SECRET is ineligible for normal generative
  processing; project ceilings only tighten and grants cannot declassify data.
- Explicit context-release contract for already resolved routes, with no automatic
  routing or sanitization. Conservative session classifications persist on resume.
- Startup-only operator YOLO bypasses ordinary tool-policy enforcement only after
  execution eligibility passes. Classification denials remain enforced.
- Version-specific post-authentication request veto for Pi 0.85.1's reviewed
  openai-completions path; runtime trust remains an operator declaration.
- Updated extension trust boundary, operations, security, evaluation and policy docs.
- Blackhole remains optional; observational memory and automatic compaction remain off
  in the disposable compatibility evaluation.

## 0.1.0

Initial public release candidate, extracted from a locally qualified implementation.
No prior public releases are implied.

- Canonical protected-target and prospective destination checks for native tools.
- Independent global/project policy evaluation with monotonic composition.
- ALLOW, one-shot ASK, non-overridable DENY and fail-closed evaluation.
- Guarded and trusted declarative profiles; no runtime escalation.
- Bounded shell/Git classification and target-checked inspection.
- Cancel-first compact approval dialogs and factual tool-result receipts.
- Dependency-free runtime, Pi 0.85.1 integration tests and documented threat model.

Not an OS sandbox. Runtime YOLO, persistent grants and arbitrary process/network
containment are not included. The policy API may evolve before 1.0.
