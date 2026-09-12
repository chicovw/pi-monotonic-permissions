# Adapter authoring

An adapter is unnecessary for a status-only or presentation-only extension that exposes no model-callable tool. Simple deterministic tools can use an operator-owned declarative descriptor. Tools that parse history, release context, delegate work, or expose multiple targets require reviewed code.

Adapters normalize a tool into a semantic operation and bind it to a contract identifier. pmp fingerprints the tool schema after removing descriptions. A schema or source-contract change does not silently retain the previous reviewed authority; it falls back to the unknown-tool path.

Register adapters from operator-controlled configuration or an explicitly installed package. Project files and model prompts cannot register or widen authoritative adapters. Keep adapter state outside the Nix store when it is mutable, and review package provenance separately because pmp does not sandbox extension JavaScript.
