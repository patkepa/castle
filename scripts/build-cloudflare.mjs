import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), ".cargo");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const cargoPath = path.join(cargoHome, "bin", cargo);
const hasCargo = existsSync(cargoPath) || commandExists(cargo);

if (!hasCargo) {
  const install = spawnSync(
    "sh",
    [
      "-c",
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
    ],
    { stdio: "inherit" },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const pathPrefix = path.join(cargoHome, "bin");
const build = spawnSync("npm", ["run", "build"], {
  env: {
    ...process.env,
    PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ""}`,
    // The repository toolchain requests clippy and rustfmt for local quality
    // commands. The Cloudflare production build only compiles the generator,
    // so selecting the pinned toolchain explicitly avoids downloading those
    // unused components in every fresh build environment.
    RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.90.0",
  },
  stdio: "inherit",
});
process.exit(build.status ?? 1);

function commandExists(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}
