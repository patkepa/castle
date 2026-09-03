---
title: Engineering principles
---

Halcyon engineers optimize for systems that are understandable during both ordinary work and incidents.

## Make boundaries explicit

Every service publishes its owner, interface, data contract, and failure behavior. A dependency that cannot be explained cannot be operated safely.

## Prefer reversible changes

Small deployments, compatibility windows, and feature controls keep changes easy to observe and undo. We separate schema rollout from behavior rollout whenever possible.

## Operate what you build

Service teams own alerts, runbooks, capacity planning, and post-incident improvements. The platform team supplies common tooling without absorbing product ownership.
