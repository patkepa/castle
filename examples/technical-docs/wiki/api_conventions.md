---
title: API conventions
---

Shared conventions keep Halcyon APIs predictable across languages and service boundaries.

## Resource design

Use nouns for resources, stable identifiers in paths, and explicit commands only when an operation cannot be represented as a resource transition.

## Compatibility

Readers must tolerate fields they do not understand. Writers introduce additive fields before depending on them and retain the previous representation through the compatibility window.

## Errors

Every error response includes a stable machine code, a human-readable message, and the request correlation identifier. Do not expose internal stack traces or provider payloads.

```json
{
  "code": "policy_denied",
  "message": "The workload is not allowed to perform this operation.",
  "request_id": "req_demo_01"
}
```
