import { mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = "https://github.com/robeswang-ship-it/zhao_house/releases/latest/download/latest.json";
const publicKey = (await readFile(new URL("../src-tauri/keys/updater.pub", import.meta.url), "utf8")).trim();

if (!endpoint || !publicKey) {
  throw new Error("未找到更新公钥。详见 docs/UPDATES.md。");
}

const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.protocol !== "https:") {
  throw new Error("BAZAI_UPDATE_ENDPOINT 必须使用 HTTPS。");
}

const releaseConfig = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [endpoint],
      windows: { installMode: "passive" },
    },
  },
};

const output = new URL("../src-tauri/tauri.release.conf.json", import.meta.url);
await mkdir(new URL("../src-tauri/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(releaseConfig, null, 2)}\n`);
console.log(`已写入仅供本次构建使用的更新配置：${output.pathname}`);
