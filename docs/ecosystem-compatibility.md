# Ecosystem compatibility

Compatibility is evaluated against the exact Pi version and package contract. An extension executing trusted JavaScript is outside pmp's sandbox boundary; this table describes model-callable surfaces only.

| Package | Version tested | Model-callable surface | pmp treatment | Status |
| --- | ---: | --- | --- | --- |
| Pi native | 0.85.1 | read, write, edit, bash, grep, find, ls, powershell | native semantic authorization | Qualified |
| pi-blackhole | 0.5.3 | recall | reviewed `history.recall` adapter | Qualified |
| @firstpick/pi-extension-stats | 0.3.3 | slash/UI analytics commands | no adapter required | Qualified |
| model-discovery | 0.9.1 | catalogue/status | no adapter required | Qualified |
| pi-bar | 0.3.44 | status footer | no adapter required | Qualified |
| pi-daddy | 0.25.0 | delegation | high-authority delegation; targeted integration required | Audited |
| pi-subagents | 0.67.0 | delegation/process surfaces | not activated; requires the same delegation review | Audited |
| pi-herdsman | 0.5.2 | Herdr/process surfaces | not activated; execution infrastructure | Audited |
| pi-experiences | 0.1.65 | memory/context automation | not activated; privacy review required | Audited |

Unknown extension tools use conservative fallback: TUI requests may ask in trusted mode, noninteractive requests deny when approval is unavailable, malformed calls deny, and YOLO bypasses ordinary tool friction only after classification eligibility passes.
