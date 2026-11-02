# OneYes Canvas

本公开分支基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，上游版本 v0.20.0，MIT License。保留 LICENSE、原作者 basketikun、前端上游入口和原有画布标识。OneYes 是本分支的集成与桌面发布维护者，本分支不代表上游官方发布。

新增 Windows、macOS 和 Linux 桌面包装、OneYes 默认渠道、流式生图与本机加密配置。

3D 导演台使用 Three.js 0.180.0（MIT，Copyright © 2010–2025 Three.js authors，https://threejs.org/），引擎与 OrbitControls／TransformControls 随包提供。完整许可见 `licenses/three.txt`；内置人物与道具由本项目基础几何构成，无需下载外部模型。

本地创作工具使用 U²-Netp、ONNX Model Zoo ESPCN 3×（Apache-2.0）和 ONNX Runtime Web（MIT）；模型来源、固定哈希与许可文本随 `models/` 资源分发。抠图与超分在本机运行，不上传图像。FFmpeg/FFprobe 作为独立进程随六种平台／芯片安装包分发，采用 FFmpeg Static / BtbN 的 GPL 构建，保留对应 LICENSE、README 与 SOURCES.txt；精确发布资产、校验值和源代码构建入口见 `desktop/media-binaries.json`、https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 和 https://github.com/BtbN/FFmpeg-Builds 。不代表这些项目的官方产品。

中文字幕烧录随包提供 Noto Sans CJK SC（SIL Open Font License 1.1，https://github.com/notofonts/noto-cjk），固定来源与 SHA-256 见 `desktop/media-fonts.json`；字体和完整许可位于安装资源的 `media-bin/`，无需用户另行安装字体。

参考图无损编码使用 @jsquash/webp 1.5.0（Apache-2.0）及其 libwebp 编码器（BSD）。许可文本随网页／桌面资源放在 `licenses/image-codecs.txt`；不代表这些项目的官方产品。

桌面版同时分发 @basketikun/canvas-agent（MIT）和 OpenAI Codex CLI 0.146.0（Apache-2.0，https://github.com/openai/codex）。各依赖保留各自 package.json 与许可文件，运行时随桌面安装包提供；不代表 OpenAI 官方客户端。

智能剪辑直接迁移 open-ribbi/velocut（MIT，Copyright (c) 2026 willbean），固定提交 3e371c012b321d2bb3726fa340753609ddc9c88e；完整源码、MIT 和修改说明位于 vendor/velocut。保留其多轨编辑器与媒体／渲染 SDK，并接入 OneYes 模型和画布；不代表上游官方产品。编辑器三维素材的 CC0／CC-BY 来源与署名见随包 editor/scene-assets/LICENSES.md，依赖许可随包 editor/licenses/dependencies.txt。
