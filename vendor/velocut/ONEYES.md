# OneYes 剪辑器源码来源

本目录直接迁移 Velocut 的编辑器、项目运行时、协议、媒体及渲染 SDK，并非界面仿制。

- 上游：https://github.com/open-ribbi/velocut
- 固定提交：`3e371c012b321d2bb3726fa340753609ddc9c88e`
- 许可：MIT，Copyright (c) 2026 willbean；原文见 LICENSE。
- 保留：多轨剪辑、分割／修剪、关键帧、文字、效果、转场、历史、媒体、项目格式和 WebGPU／WebCodecs 导出。
- OneYes 修改：独立窗口、画布素材／成片桥接、节点项目隔离、中文主题，以及使用现有模型的可审阅 AI 编辑命令。
- 不启动上游 CLI、Codex 配对、云转发或默认外部 AI 服务。模型调用由 Canvas 原有渠道处理，不把密钥复制到编辑器。

`web/apps/editor/src/oneyes-main.tsx` 是本地集成入口；`oneYes.ts` 和 `ui/AgentConsole.tsx` 是桥接与 AI 草稿入口。上游其余 SDK 保留原始版权，后续更新应按此固定提交比较。OneYes 不启用上游历史记录裁剪，不新增本地媒体大小／数量限制。
