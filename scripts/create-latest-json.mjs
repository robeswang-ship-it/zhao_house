import { readdir, readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const releaseRepository = "robeswang-ship-it/zhao_house";

if (!/^[^/\s]+\/[^/\s]+$/.test(releaseRepository)) {
  throw new Error("更新仓库地址格式不正确。");
}

const bundleDirectory = new URL("../src-tauri/target/release/bundle/nsis/", import.meta.url);
const files = await readdir(bundleDirectory);
const installer = files.find((file) => file.endsWith(".exe"));
if (!installer) throw new Error("未找到 NSIS 安装包。");

const signatureFile = `${installer}.sig`;
if (!files.includes(signatureFile)) throw new Error(`未找到更新签名：${signatureFile}`);

const signature = (await readFile(new URL(signatureFile, bundleDirectory), "utf8")).trim();
const tag = `v${packageJson.version}`;
const assetBase = `https://github.com/${releaseRepository}/releases/download/${tag}`;
const latest = {
  version: packageJson.version,
  notes: `BA仔 v${packageJson.version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url: `${assetBase}/${encodeURIComponent(installer)}`,
      signature,
    },
  },
};

await writeFile(new URL("latest.json", bundleDirectory), `${JSON.stringify(latest, null, 2)}\n`);
console.log("已生成签名更新清单 latest.json。");
