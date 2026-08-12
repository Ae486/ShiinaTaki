# Secure MCP Lifecycle and Home Management

## Goal

Turn the boot-only MCP client into a host-owned operator product with secure desired state, truthful runtime status,
candidate validation, last-good publication, immutable Run snapshots, and generation-safe draining.

## Dependencies

- `08-12-approval-productization` and `08-12-host-secret-catalog` complete.

## Scope

- Shared MCP CRUD/test/reconnect/status/diagnostic schemas and Core operator APIs.
- Core desired metadata plus Host-local runtime manager/secret resolution.
- Parent `info.md` section 3 candidate, lease, drain, close, crash, and persistence contracts.
- Pagination, existing schema compatibility, selected tools, collision rejection, failure isolation.
- Home MCP page with loading/empty/validation/partial-failure/reconnecting/success states.

## Acceptance Criteria

- [ ] Ordinary add/edit/enable/disable/remove/test/reconnect requires no process restart.
- [ ] Failed candidate keeps last-good truth; test never publishes tools.
- [ ] An in-flight call stays on its captured generation while future Runs see the replacement.
- [ ] Disable/remove/secret clear block new leases and close/drain exactly once.
- [ ] Crash/restart reconciles desired state without restoring fake runtime truth or replaying calls.
- [ ] One bad server/tool does not disable unrelated tools.

## Out of Scope

- Automatic `tools/list_changed` until SDK/adapter support is proven.
- MCP marketplace, prompts/resources/Apps product surfaces, or provider-specific servers.
