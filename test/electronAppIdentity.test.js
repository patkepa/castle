import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  castleAppBundleId,
  castleApplicationName,
  resolveCastleRuntimeIconPath,
} from "../apps/desktop/electron/app_identity.ts";

test("uses Castle as the desktop application identity", () => {
  assert.equal(castleApplicationName, "Castle");
  assert.equal(castleAppBundleId, "app.castle.desktop");
});

test("resolves development and packaged Castle icons", () => {
  assert.equal(
    resolveCastleRuntimeIconPath({
      isPackaged: false,
      mainBundleDirectory: path.join(
        "/workspace",
        "apps",
        "desktop",
        ".vite",
        "build",
      ),
      resourcesPath: path.join("/Applications", "Castle.app", "Contents", "Resources"),
    }),
    path.join("/workspace", "resources", "app-icons", "castle.png"),
  );
  assert.equal(
    resolveCastleRuntimeIconPath({
      isPackaged: true,
      mainBundleDirectory: path.join("/workspace", ".vite", "build"),
      resourcesPath: path.join("/Applications", "Castle.app", "Contents", "Resources"),
    }),
    path.join("/Applications", "Castle.app", "Contents", "Resources", "castle.png"),
  );
});
