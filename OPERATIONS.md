# Operations

This document covers the public package. Workstation policy and immutable source
pins belong in the operator's configuration repository, not mutable grant state.

## Startup

Use Pi 0.85.1 and Node 24+. A valid operator-owned `execution` declaration is
mandatory, including for YOLO. Review the example route and exposure labels;
Bash and unknown tools have no exposure declaration in the example. Install/review the extension source and set an absolute
`PI_MONOTONIC_PERMISSIONS_POLICY` path. Launch from the intended project root.

```sh
PI_MONOTONIC_PERMISSIONS_PROFILE=trusted pi
PI_MONOTONIC_PERMISSIONS_PROFILE=guarded pi
# Bypasses ordinary tool policy only after classification eligibility:
PI_MONOTONIC_PERMISSIONS_PROFILE=yolo pi
```

The footer must show the selected mode. `permissions: unavailable` means a loaded
blocking gate; a missing status may mean no gate loaded. Verify with harmless
synthetic fixtures before relying on normal enforcement. YOLO must display
`permissions: YOLO ⚠`; after eligibility it bypasses native/custom/Bash
publication checks. There is no runtime escalation command.

Operator startup mode overrides the global legacy profile default. Repository
policy cannot set mode. Do not treat instructions, memories or model claims as
permission authority. Approved host programs and extension JavaScript execute
with OS privileges independently of native tool policy.

## Inspect and revoke persistent grants

Default state: `~/.pi/agent/pi-monotonic-permissions/grants.json`.
If `PI_CODING_AGENT_DIR` is set, use that agent directory instead. Keep it outside
the Nix store. The file is operator convenience state, not declarative policy.

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
cat "$agent_dir/pi-monotonic-permissions/grants.json"
# Revoke all persistent grants; reviewed ASK operations will prompt again:
printf '%s\n' '{"version":1,"grants":[]}' > "$agent_dir/pi-monotonic-permissions/grants.json"
chmod 600 "$agent_dir/pi-monotonic-permissions/grants.json"
```

Run revocation only when the file exists. To revoke one grant, use a text editor
to delete its entire record, retaining valid JSON. Each record identifies tool and
operation plus opaque context/contract hashes. No history or payload is stored.
Do not hand-author grants to infer broader authority. Restart to clear existing
session grants too; persistent revocation alone does not revoke a separately
selected memory-only session grant.

The extension creates the state directory with mode 0700 and file with mode 0600.
Wrong ownership, group/world permissions, symlinks, malformed state or excessive
size blocks persistent lookup/save for ASK. Fix the state as the operator or
remove/recreate the dedicated grant file; never weaken policy to hide a storage
error. Atomic writes can lose simultaneous convenience updates from separate Pi
processes. Keep grant edits and Always Allow choices sequential when practical.

Policy changes, startup-mode changes, source entry/schema/metadata changes and
adapter updates cause old grants to stop matching. Imported code can change
without changing those identities. Re-review updated packages and revoke old
grants when source semantics change. A location/source label is not provenance.

## Optional Blackhole 0.5.3

Use an exact reviewed source pin. Do not add Blackhole to this package's runtime
dependencies. Its configuration path is
`$PI_CODING_AGENT_DIR/pi-blackhole/pi-blackhole-config.json`, under `~/.pi/agent`
by default. For the initial evaluation:

```json
{
  "memory": false,
  "compaction": "manual",
  "compactionEngine": "blackhole"
}
```

Use `/blackhole` for manual deterministic compaction. Do not enable automatic
compaction as part of this qualification. Observer/Reflector/Dropper workers
remain off. Raw session history remains available for recall; it is not
observational-memory capture. Check effective config, logs, session entries and
model requests rather than assuming that a UI toggle is durable configuration.
Blackhole also reads project configuration, so verify the effective memory setting.

Trusted global policy can use:

```json
"customTools": {
  "unknown": "ASK",
  "recall": "ALLOW",
  "operations": {
    "recall.activeLineage": "ALLOW",
    "recall.allLineages": "ASK"
  }
}
```

This is a section to insert in a complete version-1 global policy. Project rules
may tighten it. Global/project recall DENY defeats every grant. `scope:all` is a
human shorthand for the tool argument `scope: "all"`; it is not parsed from query
text by the model-tool adapter. In 0.5.3 `query: "#N"` loses explicit broader scope
upstream; use `expand: [N], scope: "all"` for approved off-branch index expansion.

Blackhole clips structural history. In the evaluated source, older user text is
clipped at 300 characters and older transcript lines can be omitted entirely.
Review the compacted context for current objectives, governance, unresolved work
and evidence. Recall can recover missing exact details, but does not guarantee
that a model will notice missing governance. Keep compaction manual while assessing
this risk. [Evaluation](docs/evaluation.md) distinguishes measured behavior from
unqualified model behavior and normal-profile activation.

Local/private history may be unsuitable for hosted inference. The planned
workstation integration uses local oMLX with no automatic hosted fallback.
This package enforces declared context/history eligibility against the resolved
runtime route before policy and mode. Reconsider history eligibility
before changing models or execution environments.

## Reproducible standalone qualification

```sh
npm ci --ignore-scripts
npm run validate
# Optional, with an independently fetched exact Blackhole 0.5.3 package:
node scripts/test-blackhole.mjs /absolute/path/to/unpacked-pi-blackhole
# Optional authorized local oMLX run, using only disposable synthetic history:
BLACKHOLE_LOCAL_OMLX=1 node scripts/test-blackhole.mjs /absolute/path/to/unpacked-pi-blackhole
# Optional 0.1.0 compatibility check against approved local inference:
node scripts/test-cli-compat.mjs \
  --policy /absolute/path/to/global-policy.json \
  --unbundled /absolute/path/to/pi/dist/cli.js
```

The harness copies Blackhole into disposable state, resolves the locked Pi 0.85.1
SDK, disables memory/automatic compaction, and uses deterministic streams. A
separate live qualification passed with the exact Blackhole 0.5.3 source and
operator-selected Qwen3.8-27B-oQ4e-mtp on approved loopback-local oMLX: the
compaction reduction was 751578 to 7283 JSON bytes (179275 to 1729 estimated
tokens), and recall recovered `E_PARENT_ALIAS_7F3C` and `src/paths.ts:143` with
zero approval prompts. No hosted route or network was used for that deterministic
phase.

## Eligibility troubleshooting

`CLASSIFICATION_DENY` means the declared context or tool exposure exceeds the
resolved route ceiling (or the route is not approved). Grants and YOLO cannot
resolve it. `CLASSIFICATION_UNAVAILABLE` means exposure has not been declared.
`EXECUTION_API_UNSUPPORTED` means the runtime is outside the currently qualified
Pi 0.85.1 `openai-completions` path. Correct operator configuration and restart;
do not loosen classification just to remove the denial.
`EXECUTION_RUNTIME_UNAVAILABLE` means the public running Pi version is not the
qualified `0.85.1`, is unavailable, or the installed request wrapper is no longer
current. `EXECUTION_RUNTIME_UNSUPPORTED` means the reviewed private runtime method
is absent. Neither condition is approvable.

A session's classification can rise after tool admission. Its metadata persists
through resume and compaction. Do not delete labels to reuse a private session
with hosted inference. Supply a separately authorized, sanitized new context if
needed. Classified SECRET input is never eligible for normal generative processing.
Labels are declarations, not a scanner: keep secret values out of prompts/history.
