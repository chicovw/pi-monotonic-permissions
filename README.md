# pi-monotonic-permissions

Deterministic, monotonic permission enforcement for Pi tool calls.

V1.3.1 is an unreleased compatibility follow-up to the V1.3 architecture update
in the early `0.1.0` package candidate. It targets **Earendil Works Pi 0.85.1**, using Node 24
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

**Tool policy governs model-requested tool invocation. It does not sandbox trusted
extension JavaScript.** Installing an extension requires package/source review.
A loaded extension can independently read files, spawn processes or use networks.
These boundaries apply to reviewed extensions too.

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

In guarded/trusted mode, while the gate is loaded and receiving tool calls:

- Native path checks consider canonical filesystem targets and lexical protected
  selectors, including symlink chains and prospective writes under resolved parents.
- Policy composition uses `ALLOW < ASK < DENY`; project policy can only tighten.
- `ASK` requires an operator approval or matching operator grant. `DENY` has no approval path.
- Indeterminate requests, malformed policy and evaluation errors block execution.
- Recognized Git publication/destructive categories retain their restrictions,
  even when another rule would ordinarily allow the command.

These statements do not cover adversarial filesystem races, every hard-link
alias, or arbitrary program behavior. No system prompt or model compliance is
required for the gate's own decisions.

## Installation

The npm and GitHub examples below become usable **after publication**. The public repository is
[github.com/chicovw/pi-monotonic-permissions](https://github.com/chicovw/pi-monotonic-permissions).
Use one loading method, not duplicate installs.
The syntax and manifest follow the [Pi 0.85.1 package contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md).

```sh
pi install npm:pi-monotonic-permissions@0.1.0
# Alternative, pinned Git package over SSH:
pi install git:git@github.com:chicovw/pi-monotonic-permissions@v0.1.0
```

A local checkout can be tried without changing Pi's installed package list:

```sh
pi -e /absolute/path/to/pi-monotonic-permissions
```

Pi loads the package's `pi.extensions` entry. The extension needs an absolute
`PI_MONOTONIC_PERMISSIONS_POLICY` environment variable containing both ordinary
policy and the mandatory `execution` declaration. There is no implicit fallback
in any mode. Always Allow writes separate mutable operator state; authoritative
policy is never edited by approval. No dependencies are installed globally.
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

Only global policy accepts the legacy `profile` default. A project profile field
is invalid and blocks policy loading. The operator may instead select the mode
at launch with `PI_MONOTONIC_PERMISSIONS_PROFILE=guarded|trusted|yolo`. That value
is captured when the extension loads. There is no runtime switching command or
model-callable mode tool.

## Eligibility / Policy / Grants / Mode

Execution eligibility is a higher authority layer evaluated before policy,
grants and mode. The levels are `PUBLIC`, `INTERNAL`, `PRIVATE`, and `SECRET`,
in that order. Approved loopback `LOCAL_TRUSTED` execution may process up to
`PRIVATE`; `HOSTED_CONTROLLED` execution defaults to `PUBLIC`; `SECRET` is
never eligible for normal generative processing. A project may lower a ceiling,
never raise it. Grants cannot override eligibility denial, and labels are
caller/operator declarations: V1.3 provides no secret scanner or automatic
sanitization.

| Classification | Meaning |
|---|---|
| PUBLIC | Information already public or explicitly approved for unrestricted hosted processing. |
| INTERNAL | Non-public project information requiring project-specific authorization before hosted processing. |
| PRIVATE | Proprietary, unpublished, personal, security-sensitive, canonical, or otherwise restricted information intended for approved local processing, unless a separately authorized sanitized derivative is supplied. |
| SECRET | Credentials, API keys, tokens, passwords, private keys, protected authentication material, or equivalent secrets. Never eligible for normal generative processing, including local LLMs. |

Use credentials through deterministic or human-controlled mechanisms that do not
expose their values to the model. Classification compares the declared material
against the resolved environment ceiling, not the model name. V1.3 supports
hosted ceilings of PUBLIC only; it does not grant broader hosted authorization or
perform sanitization.

- **Eligibility** governs declared context/resource release before ordinary authority.
- **Policy** is normal authority: global policy plus a project layer that only tightens.
- **Grants** are operator convenience state. They can resolve matching ASK to
  ALLOW after policy evaluation; they cannot resolve DENY.
- **Mode** is the operator's autonomy choice. Guarded adds native write/edit ASK;
  trusted permits ordinary edits where policy allows. YOLO bypasses ordinary
  tool-policy approval only after execution eligibility passes.

## True YOLO

```sh
PI_MONOTONIC_PERMISSIONS_PROFILE=yolo pi
```

**YOLO bypasses ordinary pi-monotonic-permissions tool-policy approval after
execution-environment eligibility passes.** Classification denials remain
absolute: `PRIVATE` cannot reach a hosted `PUBLIC` route, and `SECRET` cannot
reach normal generative inference even locally.
The persistent footer reads `permissions: YOLO ⚠`. Other Pi/OS controls may still
reject an operation; this extension does not override those controls. Ordinary
protected-path and publication policy can be bypassed in YOLO. SECRET component
rules, unclassifiable requests, and recognized mutations of enforcement authority
remain denied. Commands and tools execute with Pi and the OS user's privileges.

YOLO is an explicit operator startup choice, not a policy field. Project files,
model prompts, skills, memory and subagents have no mode-selection API. There is
no runtime `/permissions yolo`. In-process extension code and arbitrary approved
programs remain outside this permission layer; this is not launch containment.

## Extensible Pi tool governance

pi-monotonic-permissions governs native Pi tools and reviewed extension-provided
model tools. Native adapters and an explicit custom-adapter registry describe
operations before independent global/project evaluation.

The first reviewed adapter is Blackhole 0.5.3 `recall`. Its known argument schema
must match. An unknown or changed schema falls back conservatively; it does not
silently inherit reviewed ALLOW. A tool name/schema is not a package authenticity
attestation. The operator must install the reviewed source. Source metadata and
entry-file fingerprints detect some changes, not every transitive code change.

After an explicit exposure declaration passes eligibility, structurally valid unknown tools ASK in trusted. The dialog identifies the tool,
unknown adapter, complete escaped arguments and exact grant scope. Unknown tools
may receive one-shot or exact-argument session grants, never Always Allow.
Guarded/legacy default to DENY because their semantics are unreviewed; an explicit
`customTools.unknown: ASK` may enable operator review. Malformed calls and proposals
that cannot fit the approval display block. There is no blanket custom-tool ALLOW.

## Blackhole integration

Blackhole is optional, never a dependency of this package. With the reviewed
0.5.3 tool schema, a valid active branch, and eligible declared history:

```text
trusted: recall active lineage -> ALLOW
trusted: recall scope:all      -> ASK
guarded: either recall class   -> ASK
```

The API argument for the broader operation is `{"scope":"all"}`; the string
`scope:all` inside `query` alone is ordinary search text. Policy can DENY recall
entirely or tighten either operation. The adapter validates branch availability
because Blackhole otherwise falls back to all entries on failed/empty lookup.

Recall reads prior Pi/Blackhole session history, including earlier tool results.
It does not grant native filesystem permission, but it **is an information-disclosure
capability**. History may contain information omitted from active context.
History is not automatically eligible context. Recall must pass the same release
gate. V1.3 does not select routes or sanitize data automatically.

For the initial integration set `memory: false`, `compaction: "manual"`, and
`compactionEngine: "blackhole"`. Compaction plus session-history recall is separate
from Observer/Reflector/Dropper observational memory workers. See
[operations](OPERATIONS.md), [source review](docs/blackhole-source-review.md) and
[evaluation limits](docs/evaluation.md), including structural truncation.

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
and native PowerShell are blocked in enforced modes. The gate does not change Pi's visible tool list.

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

The compact dialog starts with **Cancel** selected. **Allow once** authorizes one
unchanged request after session, policy, arguments and targets are rechecked.
Native/Bash approvals remain one-shot; no executable-wide session grant is added.
Cancellation, UI failure, no TUI, a changed request/target, or an oversize proposal
blocks. DENY never opens the dialog. Factual receipts describe explicit approvals;
they carry no authority and are not a complete audit log.

Reviewed custom operations also offer **Allow for session**. Unknown tools bind
session grants to exact normalized arguments. Session grants disappear on shutdown,
new/resumed/forked session or reload, never altering declarative policy.

### Always Allow

For reviewed recall with readable source metadata, **Always allow** stores a
persistent operator grant in `$PI_CODING_AGENT_DIR/pi-monotonic-permissions/grants.json`
(default `~/.pi/agent/pi-monotonic-permissions/grants.json`). This is mutable user
state outside the Nix store, separate from authoritative policy. Grants contain
bounded operation names and hashes, no raw arguments, results or recalled content.

Grants apply only to effective ASK, never DENY. Recall grants bind to the reviewed
operation class, so active-lineage and all-lineages authority never merge. They
also bind to project cwd, policy-file snapshot, mode, tool metadata/schema, adapter
version and entry-file content. Changed identity asks again. Imported code changes
that leave these identities unchanged are not detected; package review and exact
pins remain essential. Inspect/delete grants using the simple file operations in
[OPERATIONS.md](OPERATIONS.md). No grant-management service is required.

## Validation and contributing

The standalone suite contains **265 tests**, passed on macOS arm64 with Pi 0.85.1.
It exercises policy, filesystem fixtures and real Pi tool interception using
deterministic streams, with no provider service or credentials. The V1.2 runtime
previously passed interactive 80x24/120x60 approval checks, a local-model
coding workflow and a normal-profile activation smoke. Those are historical manual
evidence, not portable CI claims. GitHub CI at the pre-fix public commit passed
on Ubuntu 24.04 and macOS 14. The V1.3.1 working tree must obtain its own green
public CI result after the human gate.

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

The eligibility declaration covers initial context and all existing session history
conservatively. Admitted higher-classified tool exposure raises a session label,
which is persisted as metadata and restored on resume. Nothing automatically
lowers that label after compaction. Missing exposure labels deny; the example
therefore does not authorize Bash or unknown tool exposure. An operator declaration
for an opaque tool asserts its entire possible exposure, not a verified sandbox.

The request veto uses a private Pi 0.85.1 `prepareRequest` seam after authentication
resolves the endpoint. Only `openai-completions` is currently qualified. Route
configuration attests the approved runtime at an exact provider/API/endpoint;
it does not detect service replacement or prove an extension provider's network
behavior. See [the seam review](docs/pi-eligibility-seam-review.md).
The compatibility check reads Pi's public `VERSION` export. It requires exactly
`0.85.1` in addition to the reviewed private runtime structure. Missing, malformed,
or different version values fail closed. This avoids assuming the public package
has a filesystem path when Pi loads extensions through its bundled virtual modules.
### Delegated execution eligibility

Delegation controllers may use the side-effect-free `mayReleaseContext` export to check whether already-classified context may be released to an already-resolved execution route. The seam performs no routing, process launch, policy mutation, or grant mutation. It enforces the same classification ceilings and SECRET restriction as the runtime gate; ordinary tool policy and delegated capability resolution remain separate concerns.
