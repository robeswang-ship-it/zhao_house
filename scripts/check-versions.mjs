import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)));
const cargoToml = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!cargoVersion || packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
  throw new Error(`版本必须一致：package=${packageJson.version}，tauri=${tauriConfig.version}，cargo=${cargoVersion ?? "未找到"}`);
}

console.log(`版本一致：v${packageJson.version}`);
