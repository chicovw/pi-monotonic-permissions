# Public claims review

This is a review aid, not an independent audit. Strong README/SECURITY statements
are scoped to a loaded gate receiving model tool calls. All listed test files
are in `tests/`; extracted-package validation repeats them against shipped source.

| Public claim | Implementation | Deterministic regression | Pi/manual evidence | Limit / accepted wording |
|---|---|---|---|---|
| Canonical protected reads and mutations | paths.ts resolveTarget; policy.ts matches; requests.ts describe | paths.test.ts, requests.test.ts, profiles.test.ts | pi-integration.test.ts protected aliases | Decision-time explicit targets; no universal file secrecy |
| Prospective writes under resolved parents | paths.ts resolveTarget; requests.ts parent operations | paths.test.ts prospective/dangling-parent cases | Native write integration plus deterministic filesystem cases | Races remain after check |
| Project can only tighten | policy.ts evaluate/compose; config.ts parsePolicy | policy.test.ts nine combinations; global-policy.test.ts | permissive project integration | Global policy/operator storage must be trusted |
| DENY cannot be approved | index.ts DENY branch before UI | approvals.test.ts; profiles.test.ts | native denied call has no UI | Human can change authoritative policy outside gate |
| ASK is one-shot | index.ts request digest, epoch, recheck and receipts | approvals.test.ts repeat/change/failure cases | real SDK repeated writes and manual TUI | Residual post-check race; no persistent grants |
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
