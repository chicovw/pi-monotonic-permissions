# Evaluation methodology and evidence

## From observed failures to invariants

Existing permission solutions were evaluated before a custom implementation was
chosen. Bounded synthetic tests exposed two distinct classes of failure: matching
only a supplied path instead of its canonical target, and allowing lower-authority
project configuration to weaken a global restriction. This is evidence about the
tested conditions, not a judgment about other projects or their current releases.

Those findings became explicit implementation invariants:

```text
DENY .env; read alias -> .env          -> DENY
GLOBAL DENY + PROJECT ALLOW           -> DENY
DENY + attempted approval             -> DENY, no approval UI
indeterminate mandatory evaluation    -> block
```

No third-party permission implementation is bundled. Rather than expanding a
framework, the implementation separates request description, target resolution,
pure policy evaluation, approval handling and bounded command classification.

## Validation layers

1. Pure policy tests cover all nine authority combinations, neutrality and scope.
2. Disposable filesystem tests exercise direct/chained symlinks, protected reads
   and mutations, prospective destinations, external paths, errors, Darwin case
   behavior and normalized spelling.
3. Approval tests check decline, one-shot reuse, changed requests/targets and UI failure.
4. Real Pi SDK tests replace only the model stream. Native tools, extension hooks,
   policy loading and session behavior still execute. No model service is contacted.
5. Interactive checks exercised Cancel-first dialogs at 80x24 and 120x60.
6. A local-model workflow reproduced a defect, edited one source line, validated
   and respected protected/publication denials. A normal-profile smoke separately
   verified three ordinary native operations and two protected denials.

## Evidence scope

The pre-edit V1.2 baseline passed **175/175 tests** on macOS arm64 with
Node 24 and the npm development SDK pinned to **Pi 0.85.1**. TypeScript validation
is separate. The tarball test reruns the same suite against extracted source and
checks package-directory resource loading. CI is configured for macOS and Linux;
remote CI has not been executed during preparation. Do not treat a configured
matrix as verified platform support.

Pre-extraction manual evidence used the same runtime modules: 80x24/120x60 TUI
checks, local inference and normal-profile usage. The local-model ergonomics run
had 14 tool calls: 10 ALLOW, three DENY and one declined ASK, with no ordinary
engineering approval prompts. These are one bounded run, not a performance study
or an independence/security audit. No raw personal sessions, paths or model
credentials are part of the package.

The original seven runtime module files were compared byte-for-byte during the initial extraction.
V1.3 package validation also compares the two added runtime modules.
Test portability changes replace machine-specific SDK lookup, model labels and
workstation policy with synthetic fixtures. Core regression assertions are retained.
The standalone package has no dependency on an internal source tree or local model.

## Interpretation

Passing tests provide evidence for these cases and their checked assumptions.
They do not prove arbitrary command safety, kernel containment, absence of races
or immunity to all aliases. The threat model defines those limits. An external
review should begin with canonical identity, policy composition and approval
revalidation, then examine consequential classification and load-failure behavior.

See the internal-maintenance [claims review](claims-review.md) for claim-to-code
and test mappings. It records softened wording as well as supported assertions.

## V1.3 corrective architecture

V1/V1.2 deliberately denied unsupported tools. Blackhole showed that blanket custom
tool denial prevents legitimate Pi extensibility: compaction relies on recall to
recover omitted details. V1.3 separates trusted extension installation from
model-requested tool permission. Reviewed adapters and a conservative unknown-tool
fallback preserve operator control without blanket custom-tool ALLOW. This is an
architecture correction, not a rollback of guarded/trusted invariants.

The complete baseline passed before source edits. The V1.3 suite now has **263/263
passing tests**, including the original 175 cases. The obsolete test description
that called YOLO design-only was updated: policy-file YOLO still rejects, while
startup YOLO has its own tests. Its model `permissions` call still cannot change
mode; the denial reason is now conservative policy DENY instead of unsupported.
No canonical-path regression was removed.

Added deterministic coverage proves:

- reviewed active recall ALLOW in trusted and ASK in guarded;
- explicit all-lineage recall ASK, with decline and one-shot repeat behavior;
- unknown trusted ASK, guarded default DENY, explicit guarded ASK, malformed DENY;
- global/project custom-tool monotonicity, including changed schema restrictions;
- session scope, exact unknown arguments, shutdown/restart clearing;
- persistent restart, policy independence, owner-only state and revocation;
- DENY before a matching persistent grant, and distinct active/all grant scope;
- schema, description, source entry/source identity, mode and policy invalidation;
- active-lineage branch revalidation and empty/failed-branch fallback prevention;
- classification precedence, project ceilings, persisted admission labels, and post-auth request veto;
- startup YOLO ordinary-policy bypass after eligibility, visible status and no model/project mode-selection surface.

Actual Pi 0.85.1 sessions exercise native tools, reviewed-schema custom tools,
unknown tools, all supported grant choices, new session instances, both extension
orders, guarded/trusted and harmless synthetic YOLO. No provider is called.
TypeScript, npm content validation and the full suite against an extracted tarball
are separate checks. Historical interactive V1.2 UX evidence does not qualify the
new four-choice V1.3 grant dialog at every terminal size.

## Exact Blackhole 0.5.3 evaluation

The optional `scripts/test-blackhole.mjs` harness checks all 119 runtime files
against the inspected npm artifact digest, copies them unchanged into disposable
state, and loads the real source extension through Pi 0.85.1. Blackhole is not a
runtime or development dependency of this package. The exact upstream source and
issue investigation is recorded in [the source review](blackhole-source-review.md).

Configuration: `memory:false`, `compaction:"manual"`, `compactionEngine:"blackhole"`,
minimal tail, debug logging enabled. Worker thresholds were set low for this fixture
to expose an accidental memory launch. Normal operator configuration was not loaded.
The test drives actual Pi `session.compact("__pi_vcc__")`, session history and recall
hooks with deterministic model streams. The raw session contains 45 inspection
iterations, large source/tool outputs, completed actions, failed lexical attempts,
rationale, a nested-destination TODO, evidence pointers and an abandoned branch.

| Live context measurement | Before manual compaction | After |
|---|---:|---:|
| JSON bytes | 751,578 | 7,283 |
| Pi estimated message tokens | 179,275 | 1,729 |

This fixture reduced serialized live context by 99.03%. Estimates are Pi's message
estimator, not observed provider token billing. One deliberately large synthetic
fixture does not establish a universal compression threshold.

The compacted context retained the concise initial objective, alias-denial
acceptance criterion, no-publication/no-policy-edit governance, canonical-parent
decision, nested-destination TODO and source/test evidence pointers. An exact
historical error placed deep inside an older tool result was absent afterward.
A real recalled result recovered `E_PARENT_ALIAS_7F3C` and `src/paths.ts:143` without
an approval prompt. The deterministic stream then answered with that evidence.
This proves the permission/recall execution path, not autonomous model selection.

Branch regressions exercise default search, global `#N`, `#N:path`, `#N:text`,
explicit broader search and `expand:[N]`. An abandoned branch marker is excluded
by active-lineage calls and recovered by approved broader calls. Broader decline,
one-shot/repeat, session and persistent/restart behavior runs against real Blackhole.
Persistent choices leave policy bytes unchanged.

The offline phase observed zero network requests, zero compaction model calls and zero
Observer/Reflector/Dropper start/error/model-unavailable log events while real
agent/turn events ran over substantial history. Effective file configuration
remained `memory:false`. Source inspection confirms the consolidation guard exits
before worker launch. This is bounded runtime evidence, not proof about every
possible host event. Raw session history remains present for recall.

### Approved local inference after compaction

With `BLACKHOLE_LOCAL_OMLX=1`, the same harness restores the synthetic session's
compaction branch before any deterministic recall result, verifies that the exact
error is absent, then runs the operator-selected `Qwen3.8-27B-oQ4e-mtp` through
oMLX at `http://127.0.0.1:8000/v1`. No normal user state or credentials are loaded.
The declaration is PRIVATE, LOCAL_TRUSTED with ceiling PRIVATE. A fetch guard in
the qualification harness rejects non-loopback destinations and redirects.

The actual model made two successful recall calls across three local provider
requests, recovered `E_PARENT_ALIAS_7F3C` and `src/paths.ts:143`, and answered
correctly with zero approval prompts. Observer/Reflector/Dropper worker logs and
ledger entries remained absent. Compaction itself made zero model requests.
This qualifies this synthetic local recall workflow, not all model behavior or
normal-profile activation.

### Compaction limits found during evaluation

Two exploratory fixtures failed structural preservation: an initial instruction
block longer than 300 characters was clipped, and instructions spread across early
messages were omitted by the transcript-tail limit. The final passing fixture uses
a concise initial control block. This is a material Blackhole limitation, not
something the permission adapter fixes. Manual review after compaction is needed;
recall access does not ensure the model notices omitted governance or TODOs.
No Blackhole source patch or automatic compaction enablement was made.

The published 0.5.3 source also drops `scope:"all"` in the `query:"#N"` shortcut;
explicit `expand:[N]` retains it. The permission adapter conservatively classifies
any explicit all scope as broader even when upstream subsequently narrows it.
Blackhole uses internal Pi session-binding/compaction APIs, a maintenance risk.

## Human gate status

Standalone validation is separate from workstation activation. Human Gate 1
requires the operator to commit/push and provide the remote SHA before any dotfiles
repin. Non-activating Nix validation, rebuild approval, normal-profile integration,
shared-skill checks and final Blackhole
qualification belong to subsequent authorized phases. None is claimed complete by
this standalone development evidence. Stats and the other deferred integrations
remain out of scope.
