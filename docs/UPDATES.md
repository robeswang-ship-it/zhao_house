# BA仔远程更新与发布

BA仔目前使用公开仓库 [`robeswang-ship-it/zhao_house`](https://github.com/robeswang-ship-it/zhao_house) 同时保存源码和已签名的安装包。已安装的 BA仔不会保存 GitHub 密码、Token 或 API 密钥。

## 第一次配置（项目拥有者做一次）

1. 确认 `zhao_house` 保持为公开仓库；这让她的电脑能直接取得发布更新。
2. 在仓库的 **Settings → Secrets and variables → Actions → New repository secret** 新建唯一一项：`TAURI_SIGNING_PRIVATE_KEY`。它的值是本机 `.tauri/ba-zai-updater.key` 文件的完整内容；复制时不要贴进聊天、代码或任何公开位置。
3. 将该私钥离线备份。丢失它后，已经安装的旧版无法信任新的自动更新。项目内置的 `src-tauri/keys/updater.pub` 只是公开验证钥，不需要设置为 GitHub Secret。

## 以后发布一个更新

1. 修改代码并通过 `npm run verify`。
2. 同时提高 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号；`npm run check:versions` 会阻止三处不一致的发布。
3. 推送对应标签，例如 `v0.4.1`。Windows 工作流会构建、使用私钥生成签名、创建 `latest.json`，再发布到这个仓库的 GitHub Releases。
4. 她的 BA仔下次启动时静默检查；设置页会显示新版本。只有她点击“更新至 vX”后才下载、安装并重启。

## 两种签名不要混淆

- **更新签名**：本项目已经配置，保证自动下载的更新确实由你的私钥签发；这是自动更新的必要条件。
- **Windows 代码签名**：可选，用于减少 SmartScreen 警告。给女朋友本人安装时可以暂不购买证书；若以后公开传播，再考虑添加。

## 交付前检查

- 首次安装包也必须由 `npm run tauri:build:release` 生成，才能内置更新公钥与 HTTPS 更新地址。
- 首次交付 v0.4.1 后，再发布一个 v0.4.2 做真实更新测试。
- Windows 安装文件名使用 ASCII；应用界面、窗口和托盘仍显示“BA仔”。这是为了避免 GitHub 改写中文文件名导致更新下载失败。
- 保留一次旧版数据库和最新安装包，以便人工恢复。
