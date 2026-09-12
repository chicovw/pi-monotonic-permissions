# Policy reference: schema versions 1 and 2

This document describes implemented fields, not proposed configuration. The early
0.x API may evolve. JSON values must have the documented structure; unknown keys,
decisions, selectors and versions are rejected. Duplicate JSON keys, including
escaped duplicates, are rejected. Input longer than 1,048,576 JavaScript string code units is rejected.

## Global and project files

`PI_MONOTONIC_PERMISSIONS_POLICY` must name an absolute global-policy path.
The global file and execution declaration are mandatory in every mode; startup
YOLO cannot bypass eligibility loading. The optional project file is exactly
`<canonical launch cwd>/.pi/pi-monotonic-permissions.json`. A genuinely absent
project file is neutral. Project-policy symlinks and a symlinked `.pi` directory
are rejected. Policies are immutable session snapshots, not automatically reloaded.
Changing a loaded policy causes tool calls to block until an explicit new snapshot.

Top-level global fields are `version`, optional `profile`, `tools`, `paths`, `bash`,
`publication`, `execution`, and optional `customTools`. The five original non-profile fields
are required. Project policy requires
`version`; other sections may be omitted. `profile` is **not valid** in a project
file. There are no includes, priorities, environment interpolation or last-match
rules. Missing project fields contribute ALLOW independently of global policy.

## Execution eligibility and classification authority

Classifications are exactly `PUBLIC < INTERNAL < PRIVATE < SECRET`. `PUBLIC`
means information the operator approves for an approved PUBLIC hosted provider;
`INTERNAL` is non-public material; `PRIVATE` is proprietary, personal or otherwise
local-only material; and `SECRET` is credential or equivalent secret material.
`SECRET` is never eligible for normal generative processing. A `LOCAL_TRUSTED`
route may have a maximum `PRIVATE` ceiling; `HOSTED_CONTROLLED` is limited to
`PUBLIC`.

Schema version 2 separates defaults, restrictions, and admitted evidence. A
global V2 declaration requires `defaultClassification`, `opaqueTools`, and
`routes`, and may contain `minimumClassification`, `ceiling`, `projects`, and
`resources`:

```json
{"defaultClassification":"PRIVATE","opaqueTools":{"bash":"PRIVATE","recall":"PRIVATE"},
 "routes":[{"provider":"omlx","api":"openai-completions","baseUrl":"http://127.0.0.1:8000/v1",
 "runtime":"omlx","environment":"LOCAL_TRUSTED","ceiling":"PRIVATE"}],
 "projects":[{"path":"/absolute/path/to/Mels","classification":"PUBLIC"}],
 "resources":[{"component":".env","classification":"SECRET"},
              {"base":"project","path":"docs/internal","kind":"tree","classification":"PRIVATE"}]}
```

`defaultClassification` selects an empty fresh session only. A true
`minimumClassification` is optional and explicit. Operator project entries are
absolute paths, resolved to their canonical directory identity at load time; the
matching entry supplies a project baseline. They exist only in the global,
operator-owned policy. A repository cannot register itself. The project policy
may set `minimumClassification`, lower a route `ceiling`, and add `resources`,
which can only raise the resulting label.

Resources select an exact `component`, an exact `file`, or a `tree`; file/tree
forms use `base: project|home|absolute`, `path`, and `kind`. Component matching
uses lexical and canonical identities. File matching also recognizes the same
existing inode and tree matching checks lexical and canonical containment.
Symlink aliases therefore cannot escape a resource classification.

Native `read`, `grep`, `find`, `ls`, `write`, and `edit` are target-classifiable:
their label is the maximum of every bounded preflight target, including path names
disclosed by discovery. They do not become PRIVATE merely because of their tool
identity. `bash`, recall, unknown extensions, and every other opaque operation
require an `opaqueTools` exact or `"*"` label. Omitted opaque labels deny. This is
an operator assertion about complete exposure, not a sandbox proof.

At initialization PMP captures a fresh-session choice from the mutually exclusive
Pi flags `--public`, `--private`, and `--secret`, or from
`PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION` with a case-sensitive
`PUBLIC`, `INTERNAL`, `PRIVATE`, or `SECRET` value. With no flag, V2 launches
default to PUBLIC. `SECRET` is an explicit non-generative posture: normal routes
remain ineligible.
It is separate from `PI_MONOTONIC_PERMISSIONS_CONTEXT_CLASSIFICATION`, which is a
parent-approved inherited child label and may also be `SECRET`. Both malformed
values fail closed. Neither is model-callable or runtime mutable. V2 persists an
initial label, including PUBLIC, in `pi-monotonic-permissions.classification` so a
resume restores its actual high-water. A resumed PRIVATE session remains PRIVATE
even if launched through a PUBLIC wrapper; use a genuinely fresh `--no-session`
launch to start distinct PUBLIC work.

The initial live label is the maximum of the fresh selection (or default), any
explicit floor, operator project baseline, project-local floor, inherited child
label, and stored session labels. Each authorized target/opaque operation can
raise it before execution. Nothing lowers it during a session, after compaction,
or through a model prompt. Eligibility is checked before ordinary policy, grants,
and mode, and grants cannot override it.

Schema V1 remains accepted unchanged: its required `context` and `history` fields
are preserved as a compatibility minimum classification and its `tools` entries
remain whole-operation labels. This intentionally retains V1's conservative
behavior. Migrate to V2 to use target-classified filesystem operations and fresh
PUBLIC sessions.

URLs may not contain credentials, queries, or fragments. LOCAL_TRUSTED requires
HTTP(S) loopback `127.0.0.1` or `[::1]`; HOSTED_CONTROLLED requires HTTPS and a
non-loopback endpoint. Host authentication is not classification authorization.
The operator is responsible for the approved service/provider behind that route;
redirect behavior and arbitrary extension JavaScript are not network containment.
The concrete Pi adapter currently accepts only `openai-completions` on Pi 0.85.1.

The implemented pure contract is callable by trusted application code:

```ts
import { mayReleaseContext } from './src/eligibility.ts';
const decision = mayReleaseContext('PRIVATE', resolvedRoute, 'PUBLIC');
// { allowed: false, reason: 'CLASSIFICATION_EXCEEDS_CEILING' }
```

`resolvedRoute` has the six fields shown above. The third argument is an optional
project ceiling, composed using the lower ceiling. Malformed input returns a deny.
This is not a registered model tool or a route selector. The schema and pure seam
are implemented; the private Pi binding is version-specific and requires review
on upgrades. Automatic routing, data detection, sanitization, and broader hosted
context authorization remain deferred.

### Runtime authority broker

PMP also publishes a versioned read-only in-process broker for an operator-installed delegation controller. Version 1 exposes `currentClassification()` and `evaluateRoute(route)`. `evaluateRoute` accepts a complete resolved route and returns an eligibility decision only if that exact provider, API, endpoint, runtime attestation, environment, and ceiling are approved by loaded policy.

The broker exposes no policy, grants, mode selector, classification mutation, or route selection operation. It is a trusted-extension integration seam, not a sandbox boundary. A controller must refuse when the broker is absent, unavailable, incompatible, malformed, or denies the route.

## Decisions and profiles

Decisions are case-sensitive `ALLOW`, `ASK`, `DENY`. Maximum severity wins across
all applicable restrictions and both layers. DENY is never approvable.

Global `profile` may be `guarded` or `trusted`. Guarded adds ASK to native write
and edit tool calls. Trusted contributes no additional restriction. An omitted
profile preserves explicit legacy policy behavior. Explicit tool/path restrictions
still win. Global `profile: "yolo"` is rejected: YOLO is startup mode, not policy.
`PI_MONOTONIC_PERMISSIONS_PROFILE` accepts exactly `guarded`, `trusted` or `yolo`
and overrides the global profile default. An invalid startup value leaves the
gate blocking. The value is captured when the extension loads. There is no runtime
switch or model-callable selector. YOLO skips ordinary policy approval after
eligibility, while classification denials remain enforced. Its footer is
`permissions: YOLO ⚠`.

## Tools

`tools` maps `read`, `write`, `edit`, `bash` to decisions. Global requires all four;
project may provide a subset. Single-file native grep uses read policy. Native
find/ls/PowerShell and recursive native grep remain unsupported in enforced modes.
Extension tools use the separate custom policy below.

- read requires target read permission.
- write requires destination write and prospective parent-creation permission.
- edit requires target read, write and edit permission.
- Recognized Bash ls/rg additionally apply read tool policy to checked paths.

## Path scopes

`paths` accepts `roots`, `inside`, `outside`, `protected`. If any scope field
(`roots`, `inside`, `outside`) is supplied, all three must be present. Global
requires them. Project can supply only `protected` without changing its scope.

`roots` is an array of `{ "base": "project|home|absolute", "path": "..." }`.
The actual `base` value is one of those three strings, not the illustrative union.
Project/home paths must be relative, cannot start with tilde and cannot lexically
escape the base. Absolute paths require `base: absolute`. Each root must resolve
to an existing directory. Containment is path-component-aware, not string-prefix.
An empty root list makes every target outside.

`inside` and `outside` map read/write/edit to decisions. Global requires all three;
project maps may be partial. Both lexical and canonical target scope are evaluated.
A `/tmp` alias of a `/private/tmp` root can therefore fail lexical containment even
if its canonical target is inside. This additional conservative restriction is
intentional in the qualified implementation.

### Protected selectors

`protected` is an array. Every rule contains at least one read/write/edit decision
and exactly one selector form:

```json
{"component":".env","read":"DENY","write":"DENY","edit":"DENY"}
```

```json
{"base":"project","path":"credentials.json","kind":"file","read":"DENY"}
```

```json
{"base":"project","path":"restricted","kind":"tree","read":"DENY","write":"DENY"}
```

Components are exact path components, not globs or suffix patterns. Empty names,
`.`/`..`, separators and control characters are invalid. Components apply wherever
they occur, including descendants, in both lexical and canonical identities.
Darwin component matching NFC-normalizes and case-folds; other platforms use
literal component comparison. Explicit file/tree selectors use the same base/path
anchors as roots. File selectors also compare device/inode for existing files.
Tree selectors use component-aware containment. Protected ALLOW cannot cancel a
restriction elsewhere. Omitted operation decisions are neutral.

### Target resolution

Tool paths support literal relative/absolute spelling, `~` and `~/`. Pi `@`
shorthand, URL forms, unsupported tilde forms and control/special space characters
are rejected. Existing targets use realpath; reads must be accessible regular
files. Pi's fallback filename spellings are not authorized after a failed check.

Only write can target a nonexistent destination. Resolution ascends with lstat
to an existing ancestor, canonicalizes it, requires a directory, then appends
missing components. Every parent native write would create receives write policy.
Dangling symlinks, loops, non-directory ancestors and unexpected errors block.
The source tree and authoritative policy identities are protected from recognized
explicit mutation. Arbitrary host programs remain a separate boundary.

## Bash

`bash` accepts `unknown`, `ordinary`, `destructive`. Global requires `unknown`.
`ordinary` and `destructive` may be omitted. Unknown is an ordinary decision;
`ASK` is recommended because arbitrary simple commands are not statically analyzed.

```json
{"unknown":"ASK","ordinary":[{"argv":["npm","test"],"decision":"ALLOW"}],"destructive":{"recursiveDelete":"DENY"}}
```

Each ordinary entry requires `argv` (nonempty array of literal strings without
control characters) and `decision`. Exact entire-vector matching applies. Duplicate
matching entries all contribute restrictions. They do not bypass known consequential
categories or path restrictions. This is not an executable allowlist.

Literal words and basic quoting are supported. Pipelines, redirection, command
chains/control syntax, functions, substitutions, background execution and ambiguous
quoting block. One `sh -c`/`bash -c` layer is recognized with exactly one literal
command string; wrapper unknown policy and inner categories both contribute.

Known inspection includes `pwd`, bounded Git status/diff/log/show forms and
`git rev-parse` with exactly one of `HEAD`, `--show-toplevel`, `--show-prefix`,
`--is-inside-work-tree`. Unsupported Git flags block. Exact `git diff --check`
requires an ordinary entry; cached/pathspec/other option variants are not inferred.

Bare `ls` accepts an optional single `-l`, `-a`, `-la`, `-al` and at most one literal
non-option target. It checks that target's read policy, not every listed name.
Bare `rg` accepts optional `-n`, `-i`, `-F` plus exactly a non-option pattern and
path. The whole search subtree is preflighted (2048 targets, depth 32). Denied
directories are not enumerated. Any denied target blocks the final command.
Unresolvable paths block; cycles are bounded. Other literal forms use unknown
policy unless separately exact-allowed; they are not automatically promoted.

Global `bash.destructive` keys:

| Key | Recognized category |
|---|---|
| `gitResetHard` | Hard reset |
| `gitClean` | Git clean forms, conservatively including dry-run |
| `gitDeleteRef` | Branch/tag deletion |
| `gitRewrite` | Explicit rebase/filter history operations |
| `recursiveDelete` | Recognized recursive rm; explicit operands also receive write checks |
| `systemDestructive` | Small recognized system-command set such as sudo/dd/mkfs/diskutil/shutdown/reboot |

## Publication

`publication` maps `gitPush`, `gitForcePush`, `gitDeletePush`, `packagePublish`
to decisions. The global object is required but individual categories may be omitted;
a missing global consequential category defaults to ASK. Missing project categories
are neutral. Every recognized category contributes independently.

Force/lease/force refspecs add `gitForcePush` to `gitPush`. Delete refspecs add
`gitDeletePush`; mirror adds force and delete restrictions. Common explicit package
publish/upload forms have `packagePublish`. Unrecognized Git forms, global options,
alias forms and ambiguous options block. There is no universal deployment detector.
Unknown simple deployments use unknown policy, not automatic ordinary ALLOW.

## Failure and approval behavior

Missing/malformed/inaccessible global policy, malformed present project policy,
canonicalization failures, unsupported shapes and evaluator exceptions block.
Expected syntax failures have sanitized `UNSUPPORTED_*` reasons; traversal limits
use `INSPECTION_LIMIT`. Other indeterminate errors use `EVALUATION_FAILED`.
A policy DENY is distinguished from failure, but both prevent intercepted execution.

Only ASK has an approval route, only in TUI with UI available. Cancel is initially
selected. Allow once rechecks the unchanged request, snapshot and target identities.
Oversize proposals block instead of truncating critical information. The present
budget is ten lines of 68 ASCII characters. Native/Bash choices remain one-shot;
custom session/persistent choices are described below. No executable-wide grant exists.
Diagnostics are off by default. Native session logging is Pi's responsibility and
may include arguments/results even though extension diagnostics omit payloads.

## Custom tools (implemented 0.1.0 fields)

`customTools` is optional in both global and project policy. It accepts only:

| Field | Values | Meaning |
|---|---|---|
| `unknown` | `ASK`, `DENY` | Structurally valid unreviewed custom-tool fallback |
| `recall` | `ALLOW`, `ASK`, `DENY` | Restriction on all calls named recall, including changed schemas |
| `operations` | object | Up to 128 reviewed operation restrictions. Keys are bounded semantic operation IDs, not package names. |
| `operations.recall.activeLineage` | `ALLOW`, `ASK`, `DENY` | Validated active-lineage recall |
| `operations.recall.allLineages` | `ALLOW`, `ASK`, `DENY` | Validated explicit `scope: "all"` recall |
| `operations.delegate.scout` | `ALLOW`, `ASK`, `DENY` | Reviewed immutable `delegate_role` scout request |

JSON operation keys contain literal dots:

```json
{
  "version": 1,
  "customTools": {
    "recall": "DENY",
    "operations": {"recall.activeLineage": "ALLOW"}
  }
}
```

This valid project policy still denies recall: the per-tool DENY wins over the
operation ALLOW. A global ASK or DENY cannot be weakened by project ALLOW.
Missing project fields are neutral. A changed/unreviewed recall schema retains
all configured recall restrictions conservatively, including operation DENY.

Global defaults when a field is absent:

| Operation | trusted | guarded / legacy |
|---|---|---|
| reviewed active lineage | ALLOW | ASK |
| reviewed all lineages | ASK | ASK |
| other reviewed bounded operation | ASK | ASK |
| unknown custom tool | ASK | DENY |

`unknown: ALLOW` is rejected even in project policy. Guarded may explicitly opt
into `unknown: ASK`; its default DENY reflects absent semantic review. Explicit
per-operation settings may replace the global defaults, then all applicable
restrictions compose. There is no generic dynamic adapter configuration API.

The Blackhole adapter validates only the exact 0.5.3 fields: optional `query`
(string), `expand` (at most 128 nonnegative safe-integer indices), `page` (positive
safe integer), `scope` (`lineage` or `all`), and `mode` (`hybrid`, `file`, `touched`).
Unknown fields and invalid values deny. These validation bounds deliberately
reject some numerically invalid shapes upstream's broad number schema accepts.
All default/ID/regex/file/touched/drill-down/pagination calls use the supplied
scope. `query: "scope:all"` is search text. Active lineage also requires Pi's
nonempty branch with valid entry IDs to avoid upstream's all-entry fallback.

`delegate_role` accepts exactly `role` and `task`. Its role is one of `scout`,
`reviewer`, `verifier`, or `implementer`, yielding the corresponding
`delegate.<role>` operation. It does not itself select a child model, provider,
runtime, extension, workspace, profile, or tool grant. A controller must make
those operator-owned decisions and obtain an eligible route from PMP's runtime
broker before it starts a child.

Schema recognition ignores descriptive annotations only; the full schema still
participates in grant invalidation. Changed/unrecognized schemas fall back to
unknown policy, with no Always Allow. Source/package review remains required.
Recall returns session history, including omitted tool outputs, not native file
permission. Its information boundary is described in the threat model.

## Operator grants (implemented 0.1.0 state)

Grants are not policy fields. Effective DENY is checked before any grant lookup.
Only effective ASK may be resolved by a grant. Supported UI choices:

| Operation | Available choices |
|---|---|
| Native or Bash ASK | Cancel, Allow once |
| Unknown custom ASK | Cancel, Allow once, Allow for session |
| Reviewed recall ASK | Above plus Always allow when source metadata is readable |

Once binds the exact request, full action/targets, session epoch, frozen policy
and selected mode to one execution. Reviewed session grants bind semantic class;
unknown session grants bind tool, contract and exact normalized arguments. They
are cleared on session shutdown/start, including new/resume/fork/reload. No session
grant is written to policy or disk.

Persistent grants live at the Pi agent directory's
`pi-monotonic-permissions/grants.json` (default `~/.pi/agent/`). `PI_CODING_AGENT_DIR`
selects that directory according to Pi conventions. Directory mode must exclude
group/world access (created 0700); file mode must exclude group/world access
(created 0600), be operator-owned, regular, and have one hard link. Symlinked
state paths and malformed/oversized state block grant use. Limits: 128 records,
65,536 file bytes at inspection. Storage uses atomic replacement, without a
cross-process grant transaction service.

State schema:

```json
{"version":1,"grants":[]}
```

Each grant has exactly `tool`, `operation`, `contract`, `context`. The first two
are bounded names; the latter two are SHA-256 hex digests. Context binds canonical
cwd, policy-file snapshot and mode. Contract binds adapter version, full exposed
tool metadata/schema/source identity and readable entry-file content. No raw
arguments, results, session messages or recalled content are stored. This is
convenience state, not an authorization format for model-authored files.

Changing any keyed identity prevents an old grant matching, including harmless
policy rewrites. Source metadata is not cryptographic package provenance.
Changes confined to imported modules or runtime configuration are not reliably
detected. Re-review package changes and revoke stale grants as needed. DENY always
wins even if a perfectly matching record exists. See OPERATIONS for inspection
and deletion; removal takes effect on the next persistent lookup.

## Status of the interface

All fields above are implemented in the 0.1.0 development tree. They are an evolving 0.x API,
not a claim of a newly published stable release. No undocumented experimental
policy fields are accepted. Runtime mode switching, generic adapter loading,
per-executable grants and browser/delegation adapters are design-only/deferred
and are not configuration options. Automatic data routing and sanitization are
also deferred; the execution eligibility declaration and release seam are stable.
