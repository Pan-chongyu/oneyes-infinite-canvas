<p align="center">
  <img src="https://raw.githubusercontent.com/Pan-chongyu/oneyes-infinite-canvas/v0.20.177/desktop/resources/icon.png" width="88" alt="OneYes Canvas">
</p>

<h1 align="center">OneYes Canvas · 无限画布</h1>

<p align="center">把灵感、素材、AI 生成、三维预演和视频剪辑连接在同一张画布上。</p>

<p align="center">
  <a href="https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest">下载桌面版</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#开始创作">开始创作</a> ·
  <a href="#使用文档">使用文档</a> ·
  <a href="https://github.com/Pan-chongyu/oneyes-infinite-canvas/issues">反馈问题</a>
</p>

OneYes Canvas 是面向视觉创作者的开源桌面工作台，支持 Windows、macOS 和 Linux。从提示词、参考图片到视频分镜，你可以通过节点和连线组织创作流程，让 AI 生成与手动编辑衔接起来，也可以和同一局域网的伙伴共同创作。

## 核心功能

| 工作区 | 可以做什么 |
| --- | --- |
| 无限画布 | 多项目管理、拖拽素材、缩放与小地图、分组、批量复制、连线、撤销重做，以及项目导入导出。 |
| 图片创作 | 文生图、参考图编辑、多图引用、流式预览和异步任务取回；在画布中继续修改提示词、比较结果并迭代。 |
| 视频创作 | 文生视频、图片与多素材参考，按模型显示支持的时长、画幅和分辨率；已取得回执的任务可在重启后继续查询和取回。 |
| 生成配置 | 将文本、图片、视频和音频连入配置节点，用 @ 引用素材；分别管理模型、参数及逐视频模型偏好，复用工作流。 |
| 3D 导演台 | 用提示词或连接的参考生成布景与动态预演，再手动调整人物、道具、姿态、灯光和机位；编辑分镜与关键帧，导出取景图、分镜包或 PNG 序列。 |
| 智能剪辑 | 从节点打开独立多轨剪辑窗口，修剪、分割、变速、添加文字、转场与关键帧；AI 生成剪辑草稿，经确认后应用，导出成片回到画布。 |
| 视频反推 | 提取视频参考帧，选择视觉模型分析场景、动作、镜头和时间段，生成可编辑的详细提示词，继续创建生成配置或分镜。 |
| 本地创作工具 | 智能抠图、图层合成、拼图与分镜板、调色与色彩匹配、图片 AI 超分、视频 AI 超采样、拉片、拼接、配乐与混音。 |
| 剧本与漫剧 | 用扩展节点整理故事、角色和分镜，将文本、参考素材与生成配置连接成创作流程。 |
| Agent 助手 | 接入 Codex 与 Claude Code，在侧栏对话、查看执行状态和审批操作；通过 MCP 读取与操作当前画布，支持一键永久接入 Codex。 |
| 局域网协作 | 共享同一画布，实时显示成员、光标、选中节点及操作状态；同步编辑与原始素材，断线自动重连，各人视角独立。 |
| 素材与扩展 | 管理可复用的图片、视频、音频和提示词；配置 WebDAV 同步，拖入节点插件安装，使用 SDK 开发自己的节点。 |

模型列表根据当前 Key 的实际权限同步；不同模型支持的素材、尺寸和参数各不相同，界面会显示相应能力。3D 导演台的动画预演用于构图与镜头设计，实际 AI 视频由所选模型生成。

## 开始创作

1. **安装并连接**：下载适合本机系统与芯片的安装包。打开“配置与用户偏好”，登录 OneYes 后一键配置模型，或手动填写 Key；已登录 OneYes Desktop 时可复用登录态。Canvas 也能独立安装、登录和使用。
2. **准备内容**：新建画布，拖入图片、视频或音频，添加文本与生成配置，用连线或 @ 引用选择参考素材。
3. **生成与微调**：选择模型并确认参数后生成；需要设计镜头时进入 3D 导演台，需要精修成片时打开智能剪辑。生成结果可继续作为下游节点的参考。
4. **保存与分享**：项目与素材保存在本机，可导出项目与作品、配置 WebDAV，或邀请同一局域网的伙伴共同编辑。

断网或软件重启后，已有可靠回执的生成任务继续按原任务查询，不会自动重新提交付费生成。没有取得回执的提交会保留核实入口，避免重复调用。

## 下载与更新

前往 [最新版本](https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases/latest)，按系统和原生芯片选择安装包：

| 系统 | 芯片 | 安装包 |
| --- | --- | --- |
| Windows | x64 / ARM64 | EXE 安装程序 |
| macOS | Intel / Apple Silicon | DMG / ZIP |
| Linux | x64 / ARM64 | AppImage / DEB / RPM |

桌面版内置 OTA：后台检查与准备更新，画布顶部显示版本和下载状态，准备完成后点击安装并重新打开。更新包含签名与完整文件校验、下载进度和断点续传；Windows 支持块级增量与独立更新进度窗口。发布同时提供安装包校验清单。

## 数据与同步

画布与素材默认保存在当前设备，WebDAV 为可选同步方式；局域网协作直接在加入房间的设备间同步内容。独立剪辑窗口的时间线项目保存在本机，导出回画布的成片可参与画布共享。

桌面版的 Key 和连接配置使用本机加密存储；浏览器开发版使用浏览器本地存储。调用 AI 时，所选提示词与参考素材会发送到配置的接口；局域网共享不会把账号与 Key 共享给协作者。

## 使用文档

- [OneYes 接入、数据存储与桌面构建](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/ONEYES_DESKTOP.md)
- [模型自动同步与配置](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/MODEL_SYNC.zh-CN.md)
- [3D 导演台：布景、动画、分镜与导出](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/DIRECTOR.zh-CN.md)
- [视频反推与生成配置](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/VIDEO_WORKFLOW.zh-CN.md)
- [视频请求与任务恢复](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/VIDEO_BRIDGE.zh-CN.md)
- [智能剪辑](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/SMART_EDIT.zh-CN.md)
- [局域网协作](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/COLLABORATION.zh-CN.md)
- [节点插件开发](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/content/docs/development/canvas-node-plugins.zh-CN.mdx)
- [画布快捷键](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/content/docs/canvas/canvas-shortcuts.mdx)
- [OTA 更新说明](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/OTA_POLICY.zh-CN.md) · [更新记录](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/CHANGELOG.md)

## 本地开发

桌面版维护代码位于 `codex/smart-video-edit` 分支：

```bash
git clone --branch codex/smart-video-edit https://github.com/Pan-chongyu/oneyes-infinite-canvas.git
cd oneyes-infinite-canvas
npm ci
npm ci --prefix web
npm ci --prefix canvas-agent
npm ci --prefix vendor/velocut/web --ignore-scripts
```

浏览器开发运行 `npm --prefix web run dev`。桌面打包需准备本机媒体工具并构建应用，完整步骤见 [桌面构建说明](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/docs/ONEYES_DESKTOP.md)。

许可证与第三方组件署名见 [LICENSE](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/LICENSE) 和 [NOTICE](https://github.com/Pan-chongyu/oneyes-infinite-canvas/blob/codex/smart-video-edit/NOTICE.md)。
