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

The standalone release candidate passes **175/175 tests** on macOS arm64 with
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

All seven runtime module files were compared byte-for-byte during extraction.
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
