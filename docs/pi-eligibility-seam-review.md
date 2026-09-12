# Pi 0.85.1 eligibility seam review

Reviewed against the installed `@earendil-works/pi-coding-agent` 0.85.1 and its nested `@earendil-works/pi-ai` 0.85.1 package. The installed package metadata identifies the upstream repository as `https://github.com/earendil-works/pi` and the coding-agent package directory as `packages/coding-agent`.

V1.3.1 also reviewed the public runtime identity available to extensions. Pi's
tagged `packages/coding-agent/src/index.ts` re-exports `VERSION` from `config.ts`,
and `config.ts` derives it from the running package metadata. The installed
`dist/index.js` and `dist/index.d.ts` expose the same value. Both Pi's bundled
virtual-module loader and its unbundled loader return `"0.85.1"` for
`@earendil-works/pi-coding-agent`'s public `VERSION` export.

## Finding

The smallest useful seam is a bounded wrapper around Pi 0.85.1's private `ModelRuntime.prepareRequest(model, options)` method, implemented in this repository's `src/pi-runtime.ts`. `prepareRequest` runs after authentication resolution, auth `baseUrl` override, header/environment merging, and provider selection, but before the prepared request is handed to `provider.stream` or `provider.streamSimple`. `ModelRuntime.streamSimple` itself is before auth resolution and is not sufficient.

The wrapper receives a resolved route descriptor and calls classification eligibility before returning the prepared request. This is a route gate, not automatic routing or a general DLP system.

Pi's `ModelRuntime.prepareRequest` selects the provider, awaits `getAuth`,
applies an auth `baseUrl` override, merges headers/environment, and returns the
prepared request. The wrapper checks that return value before any provider
stream receives context. Only provider/API/base URL enter the eligibility
callback; credentials, headers and environment values stay in Pi. This source
path is `packages/coding-agent/src/core/model-runtime.ts` in the pinned release.

## Existing extension hooks and failure behavior

The coding-agent wires `streamFn` to `modelRuntime.streamSimple` and passes `onPayload`, `onResponse`, and a `transformHeaders` callback. Installed `dist/core/sdk.js` around lines 195-225 shows that `onPayload` is implemented by the extension runner's `before_provider_request` event, while `transformHeaders` invokes `before_provider_headers` after provider attribution headers are merged.

Those extension hooks are unsuitable as the sole fail-closed eligibility gate. `ExtensionRunner.emitBeforeProviderRequest()` and `emitBeforeProviderHeaders()` catch handler exceptions, emit an extension error, and continue; installed `dist/core/extensions/runner.js` around lines 820-875. A handler throwing therefore does not stop the request. `before_provider_request` can replace an opaque payload, but it is not given the resolved endpoint or auth resolution and it cannot reliably signal a deny through the current event result. Header mutation is also too late and cannot prevent a transport from sending.

The direct `onPayload` callback is invoked by each built-in API adapter before its provider SDK request. The installed pi-ai adapters contain this call in OpenAI completions, OpenAI responses, Azure responses, Anthropic messages, Google, Mistral, Bedrock, Pi messages, and related adapters. The callback is not a universal transport boundary: custom providers may implement arbitrary behavior, and the provider registration contract only documents that custom `streamSimple` implementations should invoke `options.onPayload` and `options.onResponse`. See `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` around lines 1090-1105.

`onPayload` also runs before the provider request is retried, not as an outer request authorization transaction. Built-in adapters call `retryProviderRequest` around SDK calls; see nested pi-ai `dist/utils/provider-retry.js` around lines 75-100. A future gate must either authorize each actual attempt or ensure retries cannot change the resolved route. It must fail closed if the route identity is unavailable or changes.

## Transport coverage limits

The shared request options expose an optional `fetch`, `transport`, timeout, retry, and websocket settings; see nested pi-ai `dist/types.d.ts` around lines 45-135. The `fetch` option explicitly does not affect WebSocket transports. Therefore a fetch wrapper alone cannot cover all standard-provider transports. A provider-specific stream boundary can cover the providers routed through `Models.streamSimple`, but it cannot claim coverage for extension code that performs its own network calls, a custom provider that ignores the callback contract, or a transport implemented outside this path.

The recommended contract is explicit: eligibility is enforced after preparation and before Pi calls the selected provider's `stream`/`streamSimple`; providers that cannot expose a stable resolved route are denied. The current wrapper qualifies only the tested `openai-completions` API. Registered provider identity is operator-declared and cannot prove implementation behavior, redirect destinations, DNS behavior, or absence of additional network calls. A loopback URL proves only the configured route. The implementation should not infer local trust from `model.id` or provider branding.

## Scope and lifecycle implications

The seam covers normal model requests, including compaction requests that use the agent's stream function, provided they pass through `prepareRequest`. It does not automatically classify or sanitize session history. Blackhole recall must therefore be treated as an information-release operation: historical messages and tool results are not automatically eligible merely because they are in the session.

The seam does not select Qwen versus another model, local versus hosted, fallback routes, or model-to-role assignments. A later router may propose a route; the eligibility function accepts or rejects that resolved proposal. YOLO may bypass ordinary tool approval only after this gate passes. Classification DENY remains authoritative over grants and autonomy mode, including for SECRET on approved local execution.

## Implemented release contract

`src/eligibility.ts` exports `mayReleaseContext(classification, resolvedRoute,
projectCeiling?)`, returning `{allowed, reason}`. The resolved route contains
`provider`, `api`, `baseUrl`, operator-attested `runtime`, `environment`
(LOCAL_TRUSTED or HOSTED_CONTROLLED), and `ceiling`. See the
[precise policy reference](policy-reference.md#execution-eligibility).

Invalid identity, malformed classification, and SECRET return a deny. Pi resolves
provider/API/endpoint; the policy supplies the approved service/environment and
ceiling. The runtime label is not discovered process or package provenance.
Operator grants apply only after eligibility succeeds. Route changes and later
provider requests are rechecked against the conservative session classification.

Runtime qualification requires two independent facts: the public Pi `VERSION`
must equal the explicitly reviewed `0.85.1`, and the registry must expose the
reviewed private `runtime.prepareRequest` structure. V1.3 previously found the
version by resolving the public package to an on-disk `package.json`. That worked
through unbundled Pi but failed closed in the bundled CLI, whose supported public
module is virtual rather than filesystem-backed. V1.3.1 consumes `VERSION`
directly and retains the structure check. Unknown versions, missing values,
missing runtime methods, wrapper replacement, unresolved routes, and unsupported
API transports remain fail closed.

## Conclusion

Pi 0.85.1 provides a useful request construction path, but its extension events are observability/transformation hooks rather than a fail-closed authorization mechanism. The robust V1.3.1 seam combines Pi's public version value with the pinned post-auth private `ModelRuntime.prepareRequest` structure, an explicit route descriptor, and deny-by-default eligibility. Unsupported APIs and unapproved provider/API/endpoint triples remain ineligible.
The wrapper does not independently authenticate provider code or transport behavior. The seam must be requalified for every Pi version update and cannot claim to intercept arbitrary extension network activity.

Primary source links:

- [Pi repository, 0.85.1 package source](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent)
- [Pi 0.85.1 public exports](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/index.ts)
- [Pi 0.85.1 VERSION definition](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/config.ts)
- [Pi extension documentation/source](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent/src/core/extensions)
- [Pi AI request types](https://github.com/earendil-works/pi/tree/v0.85.1/packages/ai/src)
