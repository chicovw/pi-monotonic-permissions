# Public claims review

This is a review aid, not an independent audit. Strong README/SECURITY statements
require a loaded gate and supported Pi runtime. Ordinary policy claims apply in
guarded/trusted; declared classification eligibility also applies in YOLO. All listed test files
are in `tests/`; extracted-package validation repeats them against shipped source.

| Public claim | Implementation | Deterministic regression | Pi/manual evidence | Limit / accepted wording |
|---|---|---|---|---|
| Canonical protected reads and mutations | paths.ts resolveTarget; policy.ts matches; requests.ts describe | paths.test.ts, requests.test.ts, profiles.test.ts | pi-integration.test.ts protected aliases | Decision-time explicit targets; no universal file secrecy |
| Prospective writes under resolved parents | paths.ts resolveTarget; requests.ts parent operations | paths.test.ts prospective/dangling-parent cases | Native write integration plus deterministic filesystem cases | Races remain after check |
| Project can only tighten | policy.ts evaluate/compose; config.ts parsePolicy | policy.test.ts nine combinations; global-policy.test.ts | permissive project integration | Global policy/operator storage must be trusted |
| DENY cannot be approved | index.ts DENY branch before UI | approvals.test.ts; profiles.test.ts | native denied call has no UI | Human can change authoritative policy outside gate |
| Native ASK / chosen Allow once is one-shot | index.ts request digest, epoch, recheck and receipts | approvals.test.ts repeat/change/failure cases | real SDK repeated writes and manual TUI | Residual post-check race; broader custom grants are separate |
| Fail-closed evaluation | config.ts validation; index.ts start/call catches | config.test.ts, requests.test.ts | malformed-policy versus missing-extension integration | Imported gate only; module-load failure cannot enforce |
| Consequential categories stay restrictive | bash.ts classify; policy.ts category maximum | bash.test.ts; global-policy.test.ts | blocked push/reset integration | Bounded syntax only; no arbitrary process analysis |
| Cancel-first readable approval | index.ts approvalMessage/ui.select | approvals.test.ts compact required fields | Manual 80x24 and 120x60 checks before extraction | Large proposals block; other terminal sizes unqualified |
| Guarded/trusted retain floor | config.ts profile field; policy.ts PROFILE_GUARDED | profiles.test.ts | trusted SDK/native-edit and prior normal-profile smoke | No runtime switch; explicit global ASK remains ASK |
| Bounded ls/rg preflight | inspection.ts; bash.ts scan; policy.ts read floor | profiles.test.ts target, subtree, loop/limit cases | actual Pi rg/ls execution | Environment/program configs and races not attested |
| No runtime dependencies or telemetry | src imports; index.ts optional diagnostic callback | package allowlist; requests.test.ts diagnostics | local package load with no provider call | Pi/development SDK dependencies are separate; native history not redacted |
| Model-visible factual approval receipt | index.ts tool_result/takeReceipt | approvals.test.ts | pi-integration.test.ts, prior local-model report | Receipt is evidence, not authority; not a complete audit log |

Rejected wording: "secure sandbox", "prevents exfiltration", "protects all secrets",
"contains subprocesses", "isolates projects", "eliminates symlink races", "works
on every Pi version", and "independently audited". Documentation instead names
the exact checked operation, preconditions and remaining boundary.

## V1.3 claim review

| Claim | Implementation and evidence | Limit |
|---|---|---|
| Reviewed normal recall ALLOW in trusted | custom-tools.ts schema/branch checks; custom-tools.test.ts; real pinned Blackhole harness | Installed package must actually be reviewed 0.5.3; schema is not provenance |
| Broader recall ASK | explicit scope classification and monotonic custom policy; unit, Pi and Blackhole tests | Upstream #N loses explicit all scope; expand:[N] retains it |
| Unknown tools governed | trusted ASK / guarded DENY defaults, explicit guarded ASK, malformed-call tests | Native unsupported surfaces remain denied; no semantic guarantees for an unknown tool |
| Grants cannot override DENY | policy before grant lookup; unit and Pi regressions | YOLO still cannot bypass classification eligibility |
| Session grants disappear | start/shutdown clear memory; actual Pi recreated sessions | Does not revoke a separately persisted operator grant |
| Persistent grants survive unchanged restart | owner-only file plus context/contract keys; Pi and pinned Blackhole restart tests | Policy rewrites invalidate even if semantically identical; concurrent writes may lose updates |
| Schema/source changes invalidate grants | full tool metadata and entry-file hash, adapter version tests | Imported code/config changes can escape these fingerprints; no attestation |
| YOLO startup bypass and visibility | captured environment, no command/tool setter; actual Pi synthetic status test | Bypasses ordinary policy only after execution eligibility; extension/approved process execution remains outside containment |
| Classification eligibility precedes policy, grants and mode | `eligibility.ts`, route seam and eligibility tests | Caller declarations are not secret scanning; unsupported APIs are denied by the version-pinned seam |
| Grants cannot declassify context | eligibility gate runs before grant lookup | No automatic routing or sanitization |
| Fail-closed custom errors | strict JSON/args, source lookup, branch availability and storage tests | A missing extension cannot enforce; malformed calls remain denied in YOLO |
| Blackhole compaction reduces live context | real Pi session.compact and synthetic evidence harness | One deliberately large fixture; separate local-model recall succeeded, no universal ratio |
| Memory workers off in fixture | memory:false, real agent events, source guard, no worker-start/error logs or ledger entries; no network in offline phase | Bounded run, not all possible host events; normal profile still gated |

A disposable local oMLX model recovered omitted historical evidence using recall.
No V1.3 normal-profile activation, remote CI, npm
publication or independent audit is claimed at Human Gate 1. Historical V1.2
interactive/native evidence is not evidence for new V1.3 grant dialog layouts.
