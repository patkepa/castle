---
title: Deployments
---

Halcyon deployments progress from validation to canary regions and then through bounded production waves.

## Release sequence

1. Build an immutable artifact and software bill of materials.
2. Run unit, contract, migration, and smoke tests.
3. Deploy to the internal environment.
4. Promote to one canary region and observe its service-level indicators.
5. Continue through production waves with an automatic pause between waves.

## Rollback

Rollback re-points the deployment manifest to the last healthy artifact. Database changes must remain backward compatible so an application rollback never requires an emergency schema rollback.

## Verification

Confirm request success, tail latency, saturation, and event delivery before closing the release. Record deviations in the change log.
