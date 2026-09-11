# Policy reference: schema version 1

This document describes implemented fields, not proposed configuration. The early
0.x API may evolve. JSON values must have the documented structure; unknown keys,
decisions, selectors and versions are rejected. Duplicate JSON keys, including
escaped duplicates, are rejected. Input longer than 1,048,576 JavaScript string code units is rejected.

## Global and project files

`PI_MONOTONIC_PERMISSIONS_POLICY` must name an absolute global-policy path.
The global file is mandatory. The optional project file is exactly
`<canonical launch cwd>/.pi/pi-monotonic-permissions.json`. A genuinely absent
project file is neutral. Project-policy symlinks and a symlinked `.pi` directory
are rejected. Policies are immutable session snapshots, not automatically reloaded.
Changing a loaded policy causes tool calls to block until an explicit new snapshot.

Top-level global fields are `version`, optional `profile`, `tools`, `paths`, `bash`
and `publication`. All except `profile` are required. Project policy requires
`version`; other sections may be omitted. `profile` is **not valid** in a project
file. There are no includes, priorities, environment interpolation or last-match
rules. Missing project fields contribute ALLOW independently of global policy.

## Decisions and profiles

Decisions are case-sensitive `ALLOW`, `ASK`, `DENY`. Maximum severity wins across
all applicable restrictions and both layers. DENY is never approvable.

Global `profile` may be `guarded` or `trusted`. Guarded adds ASK to native write
and edit tool calls. Trusted contributes no additional restriction. An omitted
profile preserves explicit legacy policy behavior. Explicit tool/path restrictions
still win. `yolo`, runtime switching and persistent profile grants do not exist.

## Tools

`tools` maps `read`, `write`, `edit`, `bash` to decisions. Global requires all four;
project may provide a subset. Single-file native grep uses read policy. Unknown
model-requested tools, native find/ls and recursive native grep block.

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
budget is ten lines of 68 ASCII characters. No permanent or executable-wide grant.
Diagnostics are off by default. Native session logging is Pi's responsibility and
may include arguments/results even though extension diagnostics omit payloads.
