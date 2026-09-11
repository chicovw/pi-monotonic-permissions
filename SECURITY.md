# Security policy

## Supported versions

This is an initial 0.x project. Only the latest published 0.x release is intended
to receive fixes; no older-branch maintenance or response SLA is promised. The
current release candidate targets Pi 0.85.1. Other Pi versions are unqualified.
No formal third-party audit has been performed.

## Private reporting

Before first publication, the maintainer must enable GitHub private vulnerability
reporting for the final repository and verify its **Security > Report a
vulnerability** entry. Repository ownership is still a release placeholder.
There is currently no live reporting endpoint promised by this staging package.
Do not put exploit details or secrets in a public issue. If the private button
is unavailable, open a minimal issue requesting a private contact without details.

Include the package/Pi/Node versions, OS/filesystem, a synthetic policy and fixture,
expected versus actual decision, exact tool request, and whether execution occurred.
Use fake marker data. Never send real credentials or private session histories.
Coordinated disclosure is preferred; propose a timeline with the maintainer.

## In-scope issues

While a correctly loaded gate is intercepting a supported model tool call:

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
