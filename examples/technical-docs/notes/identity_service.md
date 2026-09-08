---
title: Identity service
---

The identity service issues short-lived workload credentials and evaluates service-to-service policy.

## Responsibilities

- Authenticate workloads using platform-issued identity documents.
- Issue scoped, short-lived credentials.
- Publish signed key sets to regional caches.
- Record policy decisions for later investigation.

## Availability model

Regional runtimes validate existing credentials without a synchronous call to the identity service. Issuance failures stop new sessions but do not interrupt already-authorized traffic.

## Operational signals

Alert on issuance error ratio, signing-key age, regional cache freshness, and authorization latency. During an incident, follow [incident response](../stash/incident_response.md).
