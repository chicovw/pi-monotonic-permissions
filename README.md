# pi-monotonic-permissions

Deterministic, monotonic permission enforcement for Pi tool calls.

An early `0.1.0` release candidate for **Earendil Works Pi 0.85.1**, using Node 24
or later. There are no additional runtime dependencies. The policy schema is an
early public API and may change before 1.0.

## Why it exists

Tool permissions need to follow the target, not just the spelling of its path:

```text
DENY .env
read .env              -> DENY
read symlink -> .env   -> DENY
```

Policy authority also needs to survive project-local configuration:

```text
GLOBAL DENY + PROJECT ALLOW -> DENY
```

This extension evaluates global and project policy independently. A repository
can request tighter restrictions; it cannot grant itself more authority than the
global policy permits. These invariants apply within the interception boundary
below, not to every action a process can perform.

## Security boundary

**pi-monotonic-permissions is a permission-interception layer for Pi tool calls.
It is not an OS sandbox.**

Approved Bash commands, tests and programs execute with the user's host OS
permissions. Their children are not contained. There is no network isolation or
exfiltration protection. Human `!`/`!!` shell input and other extensions executing
code directly are outside model `tool_call` interception. Pi resource loading is
also outside it.

If the extension fails to load, it cannot enforce anything. Check Pi's loaded
extensions and the `permissions:` footer before working. A loaded gate with an
invalid policy blocks tool calls; a missing gate does not. See the
[threat model](docs/threat-model.md) and [security reporting policy](SECURITY.md).

## Enforced decisions

While the gate is loaded and receiving supported tool calls:

- Native path checks consider canonical filesystem targets and lexical protected
  selectors, including symlink chains and prospective writes under resolved parents.
- Policy composition uses `ALLOW < ASK < DENY`; project policy can only tighten.
- `ASK` requires an explicit one-shot approval. `DENY` has no approval path.
- Indeterminate requests, malformed policy and evaluation errors block execution.
- Recognized Git publication/destructive categories retain their restrictions,
  even when another rule would ordinarily allow the command.

These statements do not cover adversarial filesystem races, every hard-link
alias, or arbitrary program behavior. No system prompt or model compliance is
required for the gate's own decisions.

## Installation

The npm and GitHub examples below become usable **after publication**. Replace
`OWNER` with the repository owner. Use one loading method, not duplicate installs.
The syntax and manifest follow the [Pi 0.85.1 package contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md).

```sh
pi install npm:pi-monotonic-permissions@0.1.0
# Alternative, pinned Git package over SSH:
pi install git:git@github.com:OWNER/pi-monotonic-permissions@v0.1.0
```

A local checkout can be tried without changing Pi's installed package list:

```sh
pi -e /absolute/path/to/pi-monotonic-permissions
```

Pi loads the package's `pi.extensions` entry. The extension needs an absolute
`PI_MONOTONIC_PERMISSIONS_POLICY` environment variable. It has no implicit policy
fallback, writes no configuration, and does not install dependencies globally.
Installation alone does not establish enforcement.

## Quick start

Start with the supplied **synthetic guarded example**, then review it for your
workspace. It denies external native access, protects `.env`, `.ssh` and
`credentials.json`, asks for native edits, permits exact `npm test` and
`git diff --check`, and denies configured publication/destructive categories.
It is not a complete secret-file inventory.

From a local checkout:

```sh
mkdir -p "$HOME/.config/pi-monotonic-permissions"
cp policy.example.json "$HOME/.config/pi-monotonic-permissions/global.json"
export PI_MONOTONIC_PERMISSIONS_POLICY="$HOME/.config/pi-monotonic-permissions/global.json"
cd /absolute/path/to/a/disposable-project
pi -e /absolute/path/to/pi-monotonic-permissions
```

Launch from the project root you intend to authorize. The boundary is the launch
cwd, not automatic Git-root discovery. Keep authoritative policy outside the
repository and preferably immutable or operator-managed. Rebuild/restart after
operator policy changes; snapshots never hot reload. Keep sessions and credentials
outside the package and any immutable store.

The optional project policy is `.pi/pi-monotonic-permissions.json` beneath the
canonical launch cwd. For example, this can only restrict writes further:

```json
{"version":1,"tools":{"write":"DENY","edit":"DENY"}}
```

## Profiles

| Global profile | Ordinary native project edit | Unknown simple Bash |
|---|---|---|
| `guarded` | Adds ASK | Explicit `bash.unknown` decision |
| `trusted` | Adds no restriction | Explicit `bash.unknown` decision |
| omitted | Explicit legacy rules only | Explicit `bash.unknown` decision |

`trusted` does not erase explicit ASK or DENY rules. To permit ordinary edits,
the global tools/inside rules must allow them too. Protected and external rules
still compose restrictively. The example uses `bash.unknown: ASK` in both profiles.

Only global policy accepts `profile`. A project profile field is invalid and
blocks loading. The footer reports the loaded profile. Runtime switching and
YOLO are **not implemented**; `yolo` is rejected. There is no model-callable
escalation command or persistent grant database.

## Policy semantics

Each applicable restriction contributes independently:

| Global \ Project | ALLOW | ASK | DENY |
|---|---|---|---|
| ALLOW | ALLOW | ASK | DENY |
| ASK | ASK | ASK | DENY |
| DENY | DENY | DENY | DENY |

Missing project fields are neutral. An explicit protected `ALLOW` is not an
exception to another restriction. Wider project roots cannot widen a global
boundary. See the complete [policy reference](docs/policy-reference.md).

## Paths and tools

`read` checks target read permission. `write` checks the destination and parents
it would create. `edit` checks read, write and edit permission. Existing targets
use filesystem `realpath`; nonexistent write destinations use the nearest existing
canonical parent. Dangling links and indeterminate filesystem errors block.

Both lexical and canonical scope checks must pass. A path through an external
root alias can therefore be denied even if its canonical target is inside. On
macOS this includes `/tmp` versus `/private/tmp`. Use canonical project spelling.
Darwin protected-component matching conservatively folds case and Unicode NFC.

Native grep supports one explicit regular file. Directory grep, native find/ls
and unknown tools are blocked. The gate does not change Pi's visible tool list.

## Bash and Git

This is a bounded literal-command recognizer, not a Bash parser. Basic literal
quoting is supported. Pipelines, redirects, substitution, functions, background
execution and command chains block. One literal `sh -c`/`bash -c` layer is checked;
the wrapper still contributes unknown-command policy.

Known Git inspection has a narrow option set. `git diff --check` requires an exact
ordinary-policy entry. Narrow `rev-parse` forms are recognized. Unsupported Git
options and operations block. Push, force/lease/force-refspec, ref deletion,
mirror push, hard reset, clean and explicit history rewriting have consequential
categories. Package publication has its own category.

Exact ordinary entries match the entire argument vector, never an executable
prefix. Other simple commands use `bash.unknown`; unsupported syntax cannot be
approved as a generic unknown command.

Bounded bare `ls` forms check an explicit target. Bare `rg` supports optional
`-n`, `-i`, `-F` flags plus exactly a pattern and path. Content-search preflight
checks the subtree before execution, blocks if any checked target is denied, and
limits traversal to 2048 targets and depth 32. It does not filter results after
reading sensitive content. This check remains subject to races and external
program/configuration behavior. Details are in the policy reference.

## Approvals

The compact dialog starts with **Cancel** selected. Only **Allow once** authorizes
rechecking the same request against the frozen policies and current target
identities. Cancellation, UI failure, no TUI, a changed request/target, or an
oversize proposal blocks. DENY never opens the dialog. Repeating an ASK prompts
again. A short factual receipt is appended to an approved tool result; it is not
a grant for future requests.

## Validation and contributing

The standalone suite contains **175 tests**, passed on macOS arm64 with Pi 0.85.1.
It exercises policy, filesystem fixtures and real Pi tool interception using
deterministic streams, with no provider service or credentials. The same runtime
source previously passed interactive 80x24/120x60 approval checks, a local-model
coding workflow and a normal-profile activation smoke. Those are separate manual
evidence, not portable CI claims. Linux CI is configured but not yet run here.

```sh
npm ci --ignore-scripts
npm run validate
```

Tests need Node 24+, Git, ripgrep and `tar`; development dependencies are locked.
The npm artifact contains no tests, credentials, user policy, sessions or bundled
SDK. The package test extracts the tarball and reruns the suite against its source.
See [evaluation](docs/evaluation.md), [architecture](docs/architecture.md) and
[contribution instructions](CONTRIBUTING.md). Report suspected boundary violations
privately as described in [SECURITY.md](SECURITY.md).
