# pi-blackhole 0.5.3 source review

Reviewed 2026-09-11 for the 0.1.0 adapter. The inspected artifact is the npm
package `pi-blackhole@0.5.3`, downloaded from the npm registry:

- tarball: <https://registry.npmjs.org/pi-blackhole/-/pi-blackhole-0.5.3.tgz>
- SHA-512 integrity: `sha512-0En3tc/lplMLjSqeejHTLGwUijG0KLarmdu1f6oO0TcGfxlQTr8qQt9BpWkq7yJm6YNOEw54l/pSzR+VB4dIxg==`
- SHA-1 shasum: `3f0931ed916c876512c6a2b735595ca7f1333fa0`
- npm `gitHead`: `7e0c9d1ff06e7024989408e3f4b5eac8409c53e6`
- package repository: <https://github.com/k0valik/pi-blackhole>

The package declares version 0.5.3 and peer-compatible Pi packages beginning
at 0.81.1. Its source package includes `index.ts` and `src/**/*.ts`; the
package main is `dist/index.js`, while the Pi extension manifest loads `index.ts`.
The qualification harness uses that Pi manifest entry with unchanged source.

## Recall tool contract

`index.ts` calls `registerRecallTool(pi, omRuntime)`. The adapter-facing tool
registration in `src/tools/recall.ts` is:

- name: `recall`
- optional `query: string`
- optional `expand: number[]`
- optional `page: number` (1-based)
- optional `scope: "lineage" | "all"`
- optional `mode: "hybrid" | "file" | "touched"`

The TypeBox schema describes `query` as text/regex search, `#N` expansion,
`#N:path` file drill-down, `#N:text` message drill-down, and 12-character
hexadecimal observation/reflection IDs. `mode:file` searches file content and
`mode:touched` aggregates touched files.

The default scope is active lineage. `normalizeRecallScope()` maps only the
literal case-insensitive value `all` to the broader scope; absent or invalid
values become `lineage`. The implementation derives active membership from
`ctx.sessionManager.getBranch()` via `getActiveLineageEntryIds()`.

That helper falls back to `getEntries()` when `getBranch()` throws or returns
an empty branch. A permission adapter must require a valid nonempty working
branch before treating default recall as bounded active-lineage recall; an
indeterminate branch must fail closed.

The explicit broad operation is therefore `scope: "all"`, or a query carrying
the human-facing `scope:all` token when using `/blackhole-recall`. The tool
returns the scope in result headers and pagination messages when it is `all`.

## Index and drill-down behavior

`#N` refers to a session-global message index. The global index is preserved
across compaction and branches in 0.5.3. `#N:path` accepts a path pattern and
optional `:full`, `:offset`, or `:offset:limit` suffix. `#N:text` similarly
pages message text. `#N:file` is an auto-selected file drill-down form.

The drill-down branch first parses scope and then checks the requested global
index against active-lineage rendered entries. An off-lineage index is rejected
unless `scope:"all"` is explicit. `expandEntryFile()` still loads the raw
session unfiltered after this membership check so global index numbers do not
shift. This fixes the historical `#N:path` scope bypass.

Historical issue evidence:

- [Issue #54: `recall #N:path` drill-down bypasses lineage scope](https://github.com/k0valik/pi-blackhole/issues/54)
- [Issue #82: summary `#N` references after compaction](https://github.com/k0valik/pi-blackhole/issues/82)

The parser is anchored (`^#(\\d+):(.+?)(?::(full|\\d+(?::\\d+)?))?$`), so inline
text mentioning `#N:path` is not treated as a drill-down. A query matching
`#N` alone dispatches to expansion. A 12-character hex query dispatches to
the observational-memory source lookup. Other queries use the default hybrid
search path.

The `#N` dispatch calls `vccRecall({ query: "", expand: [index] }, ctx)` without
forwarding parsed `scope`. Consequently `#N` with `scope:"all"` can lose the
broad scope, while explicit `expand:[N], scope:"all"` retains it. Treat this as
a 0.5.3 compatibility limitation.

## Recall information boundary and response limits

Recall reads the raw Pi session JSONL and Blackhole ledger-linked history. It
can recover prior messages and tool results omitted by compaction, including
information that is no longer in active context. It does not itself grant
native filesystem access, but it is an information-disclosure capability.

Search, entry expansion and memory-ID responses use `recallResponseMaxChars`,
default 48,000 characters. Drill-down dispatch returns directly; `#N:path:full`
and `#N:text:full` can return complete stored content without this character cap.
Do not treat the setting as a universal recall response bound.
Search results, expansions, and related observations provide continuation
references such as `#N:text`, `#N:path`, and `page:N`. This bound was added after
[Issue #83](https://github.com/k0valik/pi-blackhole/issues/83), where five
long search results exceeded 250,000 characters in 0.5.2.

## Observational memory and compaction

`UnifiedConfig.memory` defaults to `true`. `maybeLaunchConsolidation()` exits
before launching any worker when `runtime.config.memory === false`; this is the
entry point for Observer, Reflector, and Dropper consolidation. Therefore the
0.1.0 integration must set `memory: false` and verify logs/model requests to
confirm no memory-worker calls. Recall and deterministic compaction remain
available because they are separate paths.

The extension registers compaction and memory hooks during startup. With the
default `compactionEngine: "blackhole"`, `session_before_compact` runs the
deterministic structural compaction pipeline. `compaction: "manual"` disables
automatic compaction triggers while retaining explicit `/blackhole` operation.
The package uses Pi session-manager branch/session APIs and an inline
compaction adapter; these are compatibility-sensitive internal integration
points even though 0.5.3 declares peer compatibility with Pi 0.85.1.

Pinned source references: [`src/tools/recall.ts`](https://github.com/k0valik/pi-blackhole/blob/7e0c9d1ff06e7024989408e3f4b5eac8409c53e6/src/tools/recall.ts), [`src/core/lineage.ts`](https://github.com/k0valik/pi-blackhole/blob/7e0c9d1ff06e7024989408e3f4b5eac8409c53e6/src/core/lineage.ts), [`src/core/drill-down.ts`](https://github.com/k0valik/pi-blackhole/blob/7e0c9d1ff06e7024989408e3f4b5eac8409c53e6/src/core/drill-down.ts), and [`src/om/consolidation.ts`](https://github.com/k0valik/pi-blackhole/blob/7e0c9d1ff06e7024989408e3f4b5eac8409c53e6/src/om/consolidation.ts).

Memory-off history: [Issue #36: OM still working after setting it off](https://github.com/k0valik/pi-blackhole/issues/36)
reports that earlier releases failed to gate all worker entry points. The
0.5.3 source has the explicit consolidation guard; qualification should still
exercise the exact pinned runtime.

## Upstream issue risks relevant to 0.1.0

Issue #54 demonstrates why the adapter must classify `#N:path` by the same
lineage scope as ordinary recall. Issue #82 demonstrates that adapter tests
should use session-global indices after repeated compaction and branching.
Issue #83 demonstrates why the permission receipt can identify the bounded
operation while the returned result remains potentially sensitive.

The package's `scope:all` searches all session lineages, so it must map to a
broader operation class (`recall.allLineages`) and require ASK under the
trusted policy. Default recall, including `#N` and `#N:path` after membership
validation, maps to `recall.activeLineage`.

The reviewed source reads local session history directly. If a future session
switches from local inference to a hosted model, recall can reintroduce
historical local-only information into the hosted context. This package does
not provide general data-classification routing. The current qualification
environment must document its local-only model choice separately.
