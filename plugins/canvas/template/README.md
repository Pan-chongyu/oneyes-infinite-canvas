# 插件模板(TypeScript + SDK)

复制本目录即可开始写一个新的画布节点插件。

## 上手

```bash
cp -r plugins/canvas/template plugins/canvas/my-plugin
cd plugins/canvas/my-plugin
# 改 package.json 的 name;改 src/index.tsx 里的 id / name / type
npm install
npm run dev      # watch 构建,产物同步到 web/public/plugins/my-plugin.js
npm run typecheck
```

然后启动画布 `web`,在「节点插件」管理器里启用(自动发现)即可看到你的节点。发布时将 `dist/<name>.js` 发给用户，拖入画布或「节点插件 → 第三方插件」即可安装；重新拖入同 ID 的新版文件即可更新。也可以托管到可信 HTTPS 地址，通过链接安装。

完整说明和无需构建的示例见 [节点插件开发文档](../../../docs/content/docs/development/canvas-node-plugins.zh-CN.mdx)，客户端也内置该文档与「下载示例插件」入口。

> 产物名取**目录名**(`my-plugin/` → `my-plugin.js`),所以复制后记得把目录改成你的插件名。

## 你只需要关心

- `src/index.tsx` 里 `Content({ ctx })` 的节点 UI 与逻辑;
- `definePlugin({...})` 里的 `id` / `nodes[].type` / `defaultSize` 等元信息。

类型、JSX、宿主 React、构建都由 `@infinite-canvas/plugin-sdk` 提供,写 TSX 全程有补全。`ctx` 的完整能力见 `plugins/canvas/README.md` 与 SDK 的类型定义。
