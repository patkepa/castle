---
title: Event pipeline
---

The event pipeline transports audit, telemetry, and product events from regional runtimes to durable consumers.

## Event envelope

Every event includes a globally unique identifier, schema name and version, occurrence time, producer identity, region, and correlation identifier.

## Delivery contract

Delivery is at least once. Consumers must be idempotent and must treat ordering as local to a partition key. Poison events move to a quarantine stream with their validation failure.

## Backpressure

Producers buffer within a strict disk budget. When that budget is exhausted, audit events take precedence over diagnostic telemetry and sampling increases automatically.
