---
title: Local development
---

Set up a repeatable Halcyon development environment and run the standard verification loop.

## Prerequisites

Install the pinned toolchain described by the repository, Docker, and the Halcyon developer certificate. Keep project-specific configuration in the ignored local environment file.

## Start the stack

```sh
make bootstrap
make dev
```

The development command starts the control-plane API, a local data-plane worker, and the event pipeline emulator. Readiness is reported only after migrations and health probes complete.

## Before opening a change

Run unit tests, contract tests, formatting, and the local smoke test. Changes to a public contract must include a compatibility test and an update to [API conventions](api_conventions.md).
