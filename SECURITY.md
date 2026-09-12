# Security policy

## Supported versions

This is an initial 0.x project. Only the latest published 0.x release is intended
to receive fixes; no older-branch maintenance or response SLA is promised. The
current release candidate targets Pi 0.85.1. Other Pi versions are unqualified.
No formal third-party audit has been performed.

## Private reporting

Before first publication, the maintainer must enable GitHub private vulnerability
reporting for the final repository and verify its **Security > Report a
vulnerability** entry. The public repository is
[chicovw/pi-monotonic-permissions](https://github.com/chicovw/pi-monotonic-permissions).
Private reporting availability has not been verified in this development task.
Do not put exploit details or secrets in a public issue. If the private button
is unavailable, open a minimal issue requesting a private contact without details.

Include the package/Pi/Node versions, OS/filesystem, a synthetic policy and fixture,
expected versus actual decision, exact tool request, and whether execution occurred.
Use fake marker data. Never send real credentials or private session histories.
Coordinated disclosure is preferred; propose a timeline with the maintainer.

## In-scope issues

In guarded/trusted mode, while a correctly loaded gate intercepts a model tool call:

- A denied protected target becomes readable through a symlink or path alias.
- Project policy weakens an authoritative global restriction.
- DENY becomes approvable or an approval authorizes a different request.
- A policy/evaluator error silently becomes ALLOW.
- A supported consequential operation is misclassified as ordinary, bypassing
  its configured category restriction.
- Approval presentation conceals material action details or defaults to assent.

The claim is deterministic policy interception under the stated assumptions,
not universal filesystem secrecy. See [the threat model](docs/threat-model.md).

## Documented boundaries

These behaviors alone are not violations of the implemented policy boundary:

- An approved arbitrary program accesses files or networks using OS permissions.
- A human runs a shell command, including Pi `!`/`!!` input.
- Another extension executes code without model tool interception.
- Pi starts without this extension after a module-load failure.
- An adversarial process exploits the documented check/execute race window, or
  accesses a hard-link alias not covered by exact-file identity rules.

Reports about these limitations and mitigation research are welcome, but the
package does not claim OS, network or subprocess containment. A reproducible
failure of a documented check remains relevant even if it involves those areas.

## Custom tools and grants

Execution eligibility is evaluated before policy, grants and mode. `PUBLIC`,
`INTERNAL`, `PRIVATE`, and `SECRET` are ordered classifications. Approved
loopback-local execution may reach `PRIVATE`; hosted execution defaults to
`PUBLIC`; declared `SECRET` is never authorized for normal generative inference. Project
ceilings may only lower the configured ceiling. No grant can declassify data or
override this denial. Missing or malformed declarations fail closed.

In-scope failures include reviewed adapters misclassifying broader operations,
`scope:all` executing under active-lineage permission, project policy weakening a
global custom-tool DENY, malformed custom calls failing open, and stale grants
matching a changed identity that the implementation promises to invalidate.
DENY must remain unapprovable even when a session/persistent grant exists.

A stale or overly broad grant can create excessive authority when semantics evolve.
Keys include reviewed operation, mode, cwd/policy hashes, full exposed tool metadata,
schema, adapter version, and entry-file hash. Pi's `sourceInfo` is location/source
metadata, not cryptographic provenance. Changes confined to imported modules,
configuration or external resources can evade those fingerprints. Exact package
pins, installation review and grant revocation remain operator responsibilities.
No stored grant contains raw tool inputs, outputs or recalled history. The state
directory must be owner-only and files must be owner-only regular files; unsafe or
malformed state fails closed when a persistent grant is consulted.

## YOLO operator override

YOLO intentionally bypasses ordinary model-tool approval after execution
eligibility succeeds. It does not bypass classification ceilings: hosted
`PUBLIC` routes cannot receive `PRIVATE`, and `SECRET` remains ineligible even
locally. Intentional startup-selected YOLO
behavior is outside normal enforcement guarantees. Entering YOLO through an
unauthorized model/project mode-selection path would be an in-scope defect.
No runtime escalation API is supplied. Other host controls remain independent.

## Extension JavaScript

Tool policy governs model-requested invocation. It does not sandbox installed
extension JavaScript. A malicious installed extension can independently access
files, processes and networks, or interfere with in-process state. That behavior
alone is outside this gate's stated guarantee. Source/package review is the
installation trust gate; adapter recognition does not establish installation trust.

## Execution eligibility and supported runtime

In every mode, an in-scope defect includes approving a correctly classified
resource above the resolved ceiling, weakening a global ceiling through project
configuration, a grant overriding classification denial, or forgetting an admitted
session classification on resume. The pure contract and the Pi 0.85.1 post-auth
request veto are tested separately. Runtime qualification requires Pi's public
`VERSION` value to equal `0.85.1` and the reviewed private `prepareRequest`
structure to exist. Missing, malformed, or different versions and missing runtime
structure fail closed. Other Pi versions are unsupported; a module that cannot
load cannot supply a request veto.

The operator supplies classifications and attests the runtime at the exact
provider/API/endpoint. This is not secret detection, a service authenticity check,
or transport containment. A wrong declaration can expose data. A replacement
service, arbitrary provider implementation, or installed extension running its own
network code remains outside this boundary. Only `openai-completions` has been
qualified. Credentials are consumed within Pi's deterministic authentication path;
the eligibility callback receives no credential/header/environment values.
