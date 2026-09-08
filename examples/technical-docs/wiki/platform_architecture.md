---
title: Platform architecture
---

How Halcyon's control plane, data plane, and edge runtime fit together.

## System overview

Halcyon runs a multi-tenant platform that separates control-plane responsibilities from data-plane execution. The control plane configures, orchestrates, and observes; the data plane serves traffic and persists data close to users.

> **Architecture at a glance:** Commands move through versioned interfaces. Workloads keep serving from their last valid configuration when the control plane is unavailable.

The [identity service](../notes/identity_service.md) establishes workload identity. The [event pipeline](../notes/event_pipeline.md) carries operational evidence without sitting on the request path.

## Request lifecycle

A request enters at the edge, is authenticated and authorized, routed to the appropriate service, processed, and returned. Every hop emits the same correlation identifier.

```text
edge -> identity -> router -> service -> store -> response
  \---------- telemetry -> event pipeline ----------/
```

Changes to routing and policy use monotonic configuration versions. A runtime accepts a version only after its schema and dependencies have passed local validation.

## Reliability boundaries

- **Regional isolation:** the serving path has no synchronous cross-region dependency.
- **Service isolation:** bulkheads and timeouts protect upstream callers.
- **Control-plane safety:** changes are validated and rolled out progressively.

See [deployments](../stash/deployments.md) for the release sequence and [incident response](../stash/incident_response.md) for degraded-mode procedures.
