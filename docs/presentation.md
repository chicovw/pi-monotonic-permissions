# Repository and gallery presentation

GitHub About / repository description:

> Deterministic, monotonic permission enforcement for Pi tool calls.

Suggested topics: `pi-package`, `pi-extension`, `permissions`, `policy`,
`typescript`, `security-tooling`, `developer-tools`, `human-in-the-loop`.

Suggested release title: **pi-monotonic-permissions 0.1.0**.
Use release-notes-v0.1.0.md as the reviewed release body.

Pi gallery copy:

> Canonical target checks, monotonic global/project policy and one-shot approvals
> for Pi tool calls. Guarded and trusted profiles, fail-closed decisions, and
> bounded Git/publication classification. A permission layer, not an OS sandbox.

## One small capture

Record an actual disposable-project session at 120x60, showing:

1. Footer `permissions: trusted` and extension loaded.
2. Native read `.env` returns `Permission blocked: POLICY_DENY`.
3. Native read `alias` (symlink to `.env`) returns the same denial.
4. Native edit of `src/example.ts` proceeds without an approval prompt.

Use only a fake marker, generic project name and relative tool paths. Crop or
redact the cwd/provider/user identifier before sharing. Label any edited capture
as cropped/redacted, do not fabricate a terminal transcript. No current capture
is bundled because internal terminal output contains local paths. A screenshot
or short MP4 is a release presentation follow-up, not validation evidence.

Pi 0.85.1 documents optional preview metadata inside `pi`, for example:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"],
    "image": "https://example.org/pi-monotonic-permissions/preview.png"
  }
}
```

Replace the example URL only after a real preview is hosted. `video` accepts an
MP4 URL and takes precedence if both are specified. No nonexistent preview URL is
added to package.json. Source: [official package documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md).
