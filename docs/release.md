# Human release checklist

No external repository, tag, release or registry publication is created by this
checklist. Execute only after reviewing the package. Keep the existing internal
consumer unchanged until a separate migration decision.

## 0.1.0 human gates

The public identity is `github.com/chicovw/pi-monotonic-permissions`.
Prepare and validate locally, then stop without staging or committing. The human
reviews the exact diff, commits and pushes, and supplies the remote SHA. Only then
may a separately authorized configuration task repin that SHA. Do not treat this
checklist as authorization to create repositories, branches, tags or releases.

Before a public release, verify private vulnerability reporting at the repository,
review package contents and run remote CI before claiming Linux compatibility.
Keep credentials, runtime grants, sessions and operator policy out of source.

Suggested commit subject: `Add 0.1.0 extensible tool governance, grants and operator YOLO`.
Package semantic version is 0.1.0.

## Tag and release later (human only)

When main is reviewed, CI is green, all placeholders are gone and npm metadata is
finalized, make the tag on that exact commit. Do not move an existing release tag.

```sh
git status --short
npm run validate
git tag -a v0.1.0 -m "pi-monotonic-permissions 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --verify-tag --title "pi-monotonic-permissions 0.1.0" --notes-file docs/release-notes-v0.1.0.md
```

## Publish npm later (human only)

A registry lookup returned 404 during preparation; this neither reserves the name
nor guarantees account rights. Recheck, review the tarball and use npm's normal
interactive authentication/2FA. Never put tokens into this repository or workflow.

```sh
npm view pi-monotonic-permissions version
npm login
npm whoami
npm run validate
npm pack --dry-run
npm pack
npm publish ./pi-monotonic-permissions-0.1.0.tgz --access public
npm view pi-monotonic-permissions@0.1.0 version dist.integrity
```

Publishing is intentionally not automated. A version cannot normally be republished
with different contents. See the [official npm publish documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

## Verify discovery later

The [Pi package contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)
uses the `pi-package` npm keyword for gallery discovery. Confirm the published
manifest contains that keyword and `pi.extensions`, then check
[pi.dev/packages](https://pi.dev/packages) for the package. Indexing timing is not
guaranteed here. Test a pinned install in a disposable `PI_CODING_AGENT_DIR` before
changing a daily profile. No separate gallery submission API is assumed.

## Source provenance

Seven runtime TypeScript modules were copied unchanged from the qualified
first-party implementation. Inspection found only Node standard-library, relative
module and type-only Pi imports, with no vendored permission framework or retained
third-party notices. Tests retain the regression assertions but use synthetic
policy/model data and a registry-pinned development SDK. MIT is the proposed
permissive license, using the [SPDX MIT text](https://spdx.org/licenses/MIT.html).
Development dependencies keep their own licenses and are not bundled in npm.

## Reference verification

CI uses full commit pins for [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0),
verified against public release pages. No hosted workflow was run during export.
