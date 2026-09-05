# BA仔架构总览

BA仔是一个本地优先的 Tauri 2 桌面应用：React 负责界面和动画，Rust 负责本地数据、原生窗口、系统凭据和与模型 API 的请求。

桌宠窗口和完整管家窗口使用两个独立的前端入口：`pet.html` / `src/main.tsx` 只渲染桌宠，`control.html` / `src/control.tsx` 只渲染完整面板。这样两个原生窗口都明确加载各自的真实打包页面，不依赖默认首页或 URL 查询参数来切换界面。

```text
src/                         React / TypeScript 界面
  PetOverlay.tsx             默认启动的圆角桌宠卡片
  App.tsx                    按需打开的控制面板、交互状态、皮肤选择
  components/PetAvatar.tsx   两个窗口共用的角色渲染
  assets/skins/              可替换的角色 PNG 皮肤
  lib/skins.ts               皮肤身份与本地选择的唯一入口
  lib/desktop.ts             前端调用原生能力的唯一入口
  lib/schedule.ts            纯前端文字日程解析
src-tauri/                   Rust / Tauri 原生层
  src/main.rs                SQLite、Excel、提醒、AI、系统凭据、双窗口与托盘
  tauri.conf.json            窗口与打包配置
  capabilities/              前端允许调用的原生能力白名单
docs/                        人和 Agent 都应先读的维护文档
.github/workflows/           Windows 安装包构建
scripts/                     版本校验、临时更新配置、签名清单生成
```

## 数据边界

| 数据 | 保存位置 | 规则 |
| --- | --- | --- |
| 日程、记忆、聊天、番茄钟 | 用户本机的 SQLite 数据库 | 升级不得删除或重建现有数据。 |
| API 密钥 | Windows 凭据管理器 / 系统凭据库 | 绝不写入源码、日志、SQLite、截图或安装包。 |
| 皮肤、文档、程序代码 | 项目目录 | 可以随版本更新；不要覆盖用户数据库。 |

## 一次用户操作的路径

```text
React 按钮 / 输入
  → src/lib/desktop.ts invoke()
  → src-tauri/src/main.rs 的 #[tauri::command]
  → SQLite、系统通知、系统凭据或 HTTPS API
  → 结构化结果返回 React
```

## 窗口生命周期

`main` 是 230×250 的 BA仔圆角悬浮卡片，默认置顶、不进任务栏；`control` 是通过原生命令创建的完整小管家面板。小猫点击、托盘左键和“打开小猫管家”菜单都会唤醒 `control`。控制面板的关闭按钮只隐藏面板，桌宠继续运行；托盘菜单中的“退出 BA仔”才结束程序。

桌宠窗口移动后，原生层把物理坐标写入 SQLite 的 `settings.pet-position`；下一次启动会尝试恢复。多显示器拔出后若位置不可见，用托盘的“放回屏幕中央”恢复。

聊天调用会读取有限的近期日程和记忆摘要作为上下文；它不会把 API 密钥返回给界面，也不应在没有用户确认时创建日程或改写记忆。

更新检查同样只会访问发布时写入的 HTTPS `latest.json` 地址。程序下载后会用内置公钥校验更新签名；GitHub Token、更新私钥和 OpenAI API 密钥都不进入已安装应用。

## 修改原则

1. 先定位应该改的单一层，不要为了一个 UI 文案去改 Rust。
2. 新增原生能力时，最小化地更新 `capabilities/default.json`；不要开放宽泛权限。
3. 新增会修改用户数据的 AI 工具时，必须先给用户预览和确认。
4. 任何数据结构迁移都要兼容旧库，或提供可恢复的备份路径。
5. Windows 是首要发布平台；透明窗、缩放、多显示器和全屏应用应手工验证。
