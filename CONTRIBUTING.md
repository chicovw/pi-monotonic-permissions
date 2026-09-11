# Contributing

Use Node 24+, Git, ripgrep and tar. Install locked development dependencies with
`npm ci --ignore-scripts`, then run `npm run validate`.

Keep permission changes separate from packaging or wording changes. Reproduce a
policy failure with synthetic data before changing code. Add the regression at
the layer that actually failed; keep canonical-target, monotonic authority,
non-overridable DENY and one-shot approval tests intact. Do not add dependencies
or expand shell syntax without discussing the threat-model implications first.

Tests use deterministic Pi streams, no hosted provider or private local server.
The macOS case/normalization tests are platform-specific. CI on another platform
is additional evidence, not proof of equivalent filesystem semantics.

Describe the trigger, expected/actual behavior, implementation change and validation
in a pull request. Do not attach private sessions or credentials. Security reports
follow SECURITY.md. Submission represents your right to contribute under MIT;
review new third-party code and notices before copying it.
