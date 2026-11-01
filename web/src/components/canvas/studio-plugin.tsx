import { useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select, Segmented, Slider } from "antd";
import { BookOpen, Users, Rows3, Columns2, Captions, ScanText, Download, Settings2, Play, X, ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { saveAs } from "file-saver";
import { studioTools, studioSources, studioAccepts, readShots, shotsToBatchText, batchPrompts, subtitleSrt } from "@/lib/canvas/studio";
import { SourceSummary } from "./source-summary";
import { creatorSourceBlob, processNativeVideo } from "@/services/creator-media";
import { exportStudioSources } from "@/services/studio-export";
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { uploadMediaFile, deleteStoredMedia } from "@/services/file-storage";
import { imageMetadata, videoMetadata, audioMetadata } from "@/lib/canvas/canvas-node-factory";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { StudioTool, StudioSettings } from "@/types/studio";
import type { CreatorArtifact } from "@/types/creator-tools";

const icons = { storyboard: BookOpen, reference: Users, batch: Rows3, compare: Columns2, subtitles: Captions, ocr: ScanText, export: Download };
const referenceText = (node: CanvasNodeData) => {
    const s = node.metadata?.studio;
    return [s?.role && `角色：${s.role}`, s?.outfit && `服装与场景：${s.outfit}`, s?.style && `风格：${s.style}`].filter(Boolean).join("\n");
};
const sourcesFor = (ctx: CanvasNodeContext) => studioSources(ctx.node, ctx.getNodes(), ctx.getConnections());
function Original({ node, zoom = 1 }: { node: CanvasNodeData; zoom?: number }) {
    const [url, setUrl] = useState(""),
        [error, setError] = useState("");
    useEffect(() => {
        const abort = new AbortController();
        let url = "";
        setUrl("");
        setError("");
        void creatorSourceBlob(node, abort.signal)
            .then((blob) => {
                abort.signal.throwIfAborted();
                url = URL.createObjectURL(blob);
                setUrl(url);
            })
            .catch((error) => {
                if (!abort.signal.aborted) setError(error.message);
            });
        return () => {
            abort.abort();
            if (url) URL.revokeObjectURL(url);
        };
    }, [node.id, node.metadata?.storageKey, node.metadata?.content, node.metadata?.primaryImageId]);
    return url ? (
        <img src={url} alt={node.title} className="h-full w-full object-contain" style={{ transform: `scale(${zoom})` }} draggable={false} />
    ) : (
        <span className="p-3 text-xs" role="status">
            {error || "正在读取原图…"}
        </span>
    );
}
function Content({ ctx }: { ctx: CanvasNodeContext }) {
    const tool = ctx.node.type.slice(7) as StudioTool,
        info = studioTools[tool],
        Icon = icons[tool];
    const s = ctx.node.metadata?.studio,
        busy = ctx.node.metadata?.status === "loading" || ctx.batch?.active(ctx.node.id);
    useEffect(() => {
        if (tool !== "batch" && ctx.node.metadata?.status === "loading") ctx.updateMetadata({ status: "error", errorDetails: "上次处理已中断，输入与已有结果已保留；请检查用量后手动运行" });
    }, [ctx.projectId, ctx.node.id]);
    return (
        <div className="flex h-full flex-col justify-between gap-2 p-4" style={{ color: ctx.theme.node.text }} data-studio-tool={tool}>
            <div className="flex gap-3">
                <Icon size={21} className="shrink-0" />
                <div>
                    <div className="text-sm font-medium">{info.title}</div>
                    <p className="mt-1 text-xs leading-5" style={{ color: ctx.theme.node.muted }}>
                        {info.description}
                    </p>
                </div>
            </div>
            <p className="m-0 line-clamp-2 text-xs" role="status" style={{ color: ctx.theme.node.muted }}>
                {busy
                    ? "正在处理…"
                    : ctx.node.metadata?.errorDetails ||
                      (s?.items ? `已完成 ${s.items.filter((i) => i.state === "done").length} / ${s.items.length} 项` : s?.shots ? `${s.shots.length} 个镜头` : s?.cues ? `${s.cues.length} 条字幕` : "连接素材，打开设置开始")}
            </p>
            <Button type="text" size="small" className="self-start" icon={<Settings2 size={14} />} onPointerDown={(e) => e.stopPropagation()} onClick={ctx.openPanel}>
                打开{tool === "compare" ? "对比" : "设置"}
            </Button>
        </div>
    );
}
function Panel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const tool = ctx.node.type.slice(7) as StudioTool,
        info = studioTools[tool],
        s = ctx.node.metadata?.studio || {},
        latest = useRef(ctx);
    latest.current = ctx;
    const active = useRef<AbortController | null>(null),
        [busy, setBusy] = useState(false),
        [zoom, setZoom] = useState(1);
    const { modal } = App.useApp();
    useEffect(
        () => () => {
            active.current?.abort();
        },
        [ctx.projectId, ctx.node.id],
    );
    const patch = (value: Partial<StudioSettings>) => ctx.updateMetadata({ studio: { ...s, ...value }, errorDetails: undefined });
    let sources: CanvasNodeData[] = [],
        sourceError = "";
    try {
        sources = sourcesFor(ctx);
    } catch (error) {
        sourceError = (error as Error).message;
    }
    const allowed = (node: CanvasNodeData) => node.id !== ctx.node.id && studioAccepts(tool, node.type);
    const options = ctx
        .getNodes()
        .filter(allowed)
        .map((node) => ({ value: node.id, label: node.title }));
    const single = tool === "ocr" || tool === "subtitles";
    const ids = s.sourceIds ?? ctx.getConnections().filter(link => link.toNodeId === ctx.node.id).map(link => link.fromNodeId);
    const add = (type: string, title: string, metadata: CanvasNodeMetadata, index = 0): CanvasAgentOp[] => {
        const id = nanoid();
        return [
            { type: "add_node", id, nodeType: type, title, position: { x: ctx.node.position.x + ctx.node.width + 100, y: ctx.node.position.y + index * 310 }, width: 340, height: 240, metadata },
            { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
        ];
    };
    const run = async (task: (signal: AbortSignal, check: () => void) => Promise<void>) => {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        ctx.updateMetadata({ status: "loading", errorDetails: undefined });
        const project = ctx.projectId,
            id = ctx.node.id;
        const fingerprint = (inputs: CanvasNodeData[]) => JSON.stringify(inputs.map((n) => [n.id, n.type, n.metadata?.content, n.metadata?.storageKey, n.metadata?.primaryImageId, n.metadata?.images]));
        const originalInputs = fingerprint(sources);
        const check = () => {
            controller.signal.throwIfAborted();
            if (latest.current.projectId !== project || !latest.current.getNode(id)) throw new DOMException("画布或节点已关闭", "AbortError");
            if (fingerprint(sourcesFor(latest.current)) !== originalInputs) throw Error("输入素材已更改，请重新确认后运行；已受理的模型请求请先检查用量");
        };
        try {
            await task(controller.signal, check);
            check();
            latest.current.updateMetadata({ status: "success", errorDetails: undefined });
        } catch (error) {
            if (latest.current.projectId === project && latest.current.getNode(id))
                latest.current.updateMetadata({ status: "error", errorDetails: controller.signal.aborted ? "已停止本机等待；已受理的模型请求可能仍在执行，请先确认用量" : error instanceof Error ? error.message : "处理失败，请检查输入后重试" });
        } finally {
            if (active.current === controller) {
                active.current = null;
                setBusy(false);
            }
        }
    };
    const saveArtifacts = async (artifacts: CreatorArtifact[], signal: AbortSignal, check: () => void) => {
        const images: string[] = [],
            media: string[] = [];
        let committed = false;
        const ops: CanvasAgentOp[] = [];
        try {
            for (const [index, item] of artifacts.entries()) {
                check();
                let metadata: CanvasNodeMetadata;
                if (item.kind === "image") {
                    const file = await uploadImage(item.blob, { signal });
                    if (file.storageKey) images.push(file.storageKey);
                    metadata = imageMetadata(file);
                } else if (item.kind === "text") metadata = { content: await item.blob.text(), status: "success" };
                else {
                    const file = await uploadMediaFile(item.blob, item.kind);
                    media.push(file.storageKey);
                    metadata = item.kind === "video" ? videoMetadata(file) : audioMetadata(file);
                }
                ops.push(...add(item.kind, item.name, metadata, index));
            }
            check();
            latest.current.applyOps(ops);
            committed = true;
        } finally {
            if (!committed) await Promise.allSettled([deleteStoredImages(images), deleteStoredMedia(media)]);
        }
    };
    const action = () =>
        void run(async (signal, check) => {
            if (sourceError) throw Error(sourceError);
            if (tool === "storyboard") {
                const story = [s.text, ...sources.filter((n) => n.type === "text").map((n) => n.metadata?.content || n.metadata?.prompt)].filter(Boolean).join("\n");
                if (!story.trim()) throw Error("请填写故事或连接文本节点");
                const result = await ctx.ai.generateText(story, {
                    signal,
                    model: s.model,
                    system: "你是分镜编剧。仅输出 JSON 数组，每项包含 title（镜头名）、picture（完整画面提示词）、dialogue（台词）、seconds（正数秒）、camera（运镜）。遵循用户故事，不在 JSON 外输出内容。",
                });
                check();
                patch({ shots: readShots(result.text) });
            } else if (tool === "reference") {
                if (!sources.length && !referenceText(ctx.node)) throw Error("请填写角色风格或选择参考图片");
                ctx.updateMetadata({ studio: { ...s, sourceIds: ids } });
                ctx.applyOps(add("text", "角色与风格说明", { content: referenceText(ctx.node), status: "success" }));
            } else if (tool === "compare") {
                const source = sources.find((n) => n.id === s.selectedId);
                if (!source) throw Error("请选择要输出的图片");
                const blob = await creatorSourceBlob(source, signal);
                check();
                await saveArtifacts([{ kind: "image", name: `精选 · ${source.title}`, blob }], signal, check);
            } else if (tool === "ocr") {
                if (sources.length !== 1) throw Error("请选择一张图片");
                const blob = await creatorSourceBlob(sources[0], signal);
                const data = await readFileAsDataUrl(new File([blob], "reference", { type: blob.type }));
                check();
                const result = await ctx.ai.generateText("提取图片中的全部可见文字，保持原文、顺序与段落；无法辨认的内容标记[无法辨认]，不要补写或解释。", { signal, model: s.model, references: [data] });
                check();
                patch({ text: result.text });
                ctx.applyOps(add("text", `文字 · ${sources[0].title}`, { content: result.text, status: "success" }));
            } else if (tool === "subtitles") {
                if (sources.length !== 1) throw Error("请选择一个音频或视频");
                if (!ctx.ai.transcribe) throw Error("当前版本未接入语音识别");
                const artifacts = await processNativeVideo("extract", sources, {}, signal, () => {});
                const cues = await ctx.ai.transcribe(artifacts[0].blob, s.model || "", signal);
                check();
                patch({ cues });
            } else if (tool === "export") {
                const blob = await exportStudioSources(sources, signal);
                check();
                saveAs(blob, "OneYes-创作素材.zip");
            }
        });
    const batchBusy = ctx.batch?.active(ctx.node.id);
    const disabled = busy || batchBusy || (tool === "batch" && Boolean(s.items?.length));
    const confirmBatch = () =>
        modal.confirm({
            title: "开始批量生成？",
            content: `本次最多提交 ${s.items ? s.items.filter(item=>item.state==='pending').length : batchPrompts(ctx.node, sources).length} 项新图片任务，每次执行 1 项；会调用已配置的模型并产生费用。单项失败暂停，已有任务只检查结果，重启后不自动重发。`,
            okText: s.items?.length ? "继续未完成任务" : "确认生成",
            cancelText: "取消",
            onOk: () => {
                void ctx.batch?.start(ctx.node.id).catch(() => {});
            },
        });
    const smallButton = "!px-2";
    const requestAction = () => {
        const replacing = tool === "storyboard" && s.shots?.length ? "分镜" : tool === "subtitles" && s.cues?.length ? "字幕" : "";
        if (replacing) modal.confirm({ title: `重新生成${replacing}？`, content: `这会调用模型并替换当前${replacing}，已输出的节点保持不变。`, okText: "重新生成", cancelText: "保留当前内容", onOk: action });
        else action();
    };
    return (
        <section className="w-full space-y-3 rounded-xl border p-4" style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.text }} onPointerDown={(e) => e.stopPropagation()} data-studio-panel={tool}>
            <header className="flex items-center justify-between">
                <span className="text-sm font-medium">{info.title}</span>
                <Button type="text" size="small" aria-label="关闭设置" icon={<X size={14} />} onClick={onClose} />
            </header>
            <label className="block space-y-1 text-xs">
                {single ? "选择素材" : "素材顺序"}
                <Select
                    className="w-full"
                    aria-label="创作素材"
                    mode={single ? undefined : "multiple"}
                    showSearch={{ optionFilterProp: "label" }}
                    options={options}
                    value={single ? ids[0] : ids}
                    disabled={disabled}
                    onChange={(value) => patch({ sourceIds: Array.isArray(value) ? value : [value] })}
                />
            </label>
            <Button type="text" size="small" disabled={disabled} onClick={() => patch({ sourceIds: undefined })}>
                使用上游连线
            </Button>
            {sourceError && (
                <p role="alert" className="text-xs">
                    {sourceError}
                </p>
            )}
            {sources.length > 0 && (
                <div className="max-h-40 space-y-1 overflow-auto">
                    {sources.map((node, index) => (
                        <div key={node.id} className="flex items-center gap-1 py-1 text-xs">
                            <span className="w-4 shrink-0 text-center opacity-60">{index + 1}</span>
                            <SourceSummary node={node} />
                            {!single && [-1, 1].map((offset) => (
                                <Button
                                    key={offset}
                                    type="text"
                                    size="small"
                                    aria-label={`${offset < 0 ? "上移" : "下移"} ${node.title}`}
                                    disabled={disabled || index + offset < 0 || index + offset >= ids.length}
                                    icon={offset < 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                    onClick={() => {
                                        const next = [...ids];
                                        [next[index], next[index + offset]] = [next[index + offset], next[index]];
                                        patch({ sourceIds: next });
                                    }}
                                />
                            ))}
                            <Button type="text" size="small" aria-label={`移除 ${node.title}`} disabled={disabled} icon={<X size={12} />} onClick={() => patch({ sourceIds: ids.filter(id => id !== node.id) })} />
                        </div>
                    ))}
                </div>
            )}
            {["storyboard", "batch", "ocr", "subtitles"].includes(tool) && (
                <label className="block space-y-1 text-xs">
                    {tool === "subtitles" ? "语音识别模型（需支持时间戳）" : "模型"}
                    <Select
                        className="w-full"
                        aria-label="创作模型"
                        showSearch={{ optionFilterProp: "label" }}
                        allowClear
                        value={s.model}
                        options={ctx.ai.listModels(tool === "batch" ? "image" : tool === "subtitles" ? "audio" : "text")}
                        placeholder={tool === "subtitles" ? "选择已开通的语音识别模型" : "使用当前默认模型"}
                        disabled={disabled || (tool === "batch" && Boolean(s.items?.length))}
                        onChange={(model) => patch({ model })}
                    />
                    {tool === "subtitles" && <Input size="small" aria-label="语音识别模型名称" placeholder="或填写准确的识别模型名称" value={s.model} disabled={disabled} onChange={(e) => patch({ model: e.target.value })} />}
                </label>
            )}
            {(tool === "storyboard" || tool === "batch") && (
                <Input.TextArea
                    aria-label={tool === "batch" ? "批量提示词" : "故事内容"}
                    rows={4}
                    placeholder={tool === "batch" ? "每行一条提示词；可同时连接参考图片" : "写下故事，也可以连接上游文本"}
                    value={s.text}
                    disabled={disabled || (tool === "batch" && Boolean(s.items?.length))}
                    onChange={(e) => patch({ text: e.target.value })}
                />
            )}
            {tool === "reference" && (
                <div className="space-y-2">
                    {(
                        [
                            ["role", "角色特征"],
                            ["outfit", "服装与场景"],
                            ["style", "视觉风格"],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key} className="block space-y-1 text-xs">
                            {label}
                            <Input.TextArea aria-label={label} rows={2} value={s[key]} disabled={disabled} onChange={(e) => patch({ [key]: e.target.value })} />
                        </label>
                    ))}
                    <p className="text-xs" style={{ color: ctx.theme.node.muted }}>
                        将此节点连到生成节点，可传递说明和已选择的参考图；角色一致性取决于所用模型。
                    </p>
                </div>
            )}
            {tool === "storyboard" && (
                <div className="max-h-80 space-y-3 overflow-auto">
                    {(s.shots || []).map((shot, index) => (
                        <div key={index} className="space-y-2 border-t pt-2" style={{ borderColor: ctx.theme.toolbar.border }}>
                            <div className="flex items-center gap-1 text-xs"><span className="flex-1">镜头 {index + 1}</span>
                                {[-1, 1].map(offset => <Button key={offset} type="text" size="small" aria-label={`镜头${index + 1}${offset < 0 ? "上移" : "下移"}`} disabled={disabled || index + offset < 0 || index + offset >= (s.shots?.length || 0)} icon={offset < 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />} onClick={() => { const shots = [...s.shots!]; [shots[index], shots[index + offset]] = [shots[index + offset], shots[index]]; patch({ shots }); }} />)}
                                <Button type="text" size="small" aria-label={`删除镜头${index + 1}`} icon={<Trash2 size={12} />} disabled={disabled} onClick={() => patch({ shots: s.shots!.filter((_, i) => i !== index) })} />
                            </div>
                            {(["title", "picture", "dialogue", "camera"] as const).map((key) => (
                                <label key={key} className="block space-y-1 text-xs">
                                    <span>{{ title: "镜头标题", picture: "画面提示词", dialogue: "台词", camera: "运镜" }[key]}</span>
                                    <Input.TextArea
                                        key={key}
                                        aria-label={`镜头${index + 1}-${key}`}
                                        autoSize
                                        value={shot[key]}
                                        disabled={disabled}
                                        onChange={(e) => patch({ shots: s.shots!.map((item, i) => (i === index ? { ...item, [key]: e.target.value } : item)) })}
                                    />
                                </label>
                            ))}
                            <InputNumber aria-label={`镜头${index + 1}秒数`} min={0} value={shot.seconds} disabled={disabled} onChange={(seconds) => patch({ shots: s.shots!.map((item, i) => (i === index ? { ...item, seconds: seconds || 0 } : item)) })} />
                            <span className="ml-2 text-xs">秒</span>
                        </div>
                    ))}
                    <Button type="text" size="small" disabled={disabled} icon={<Plus size={13} />} onClick={() => patch({ shots: [...(s.shots || []), { title: `镜头 ${(s.shots?.length || 0) + 1}`, picture: "", dialogue: "", camera: "", seconds: 5 }] })}>添加镜头</Button>
                    <Button
                        type="text"
                        disabled={disabled || !s.shots?.length}
                        onClick={() => {
                            try {
                                readShots(JSON.stringify(s.shots));
                                const ops: CanvasAgentOp[] = [];
                                s.shots!.forEach((shot, index) => {
                                    const textId = nanoid(),
                                        imageId = nanoid(),
                                        videoId = nanoid(),
                                        x = ctx.node.position.x + ctx.node.width + 100,
                                        y = ctx.node.position.y + index * 310,
                                        prompt = `${shot.picture}\n运镜：${shot.camera}\n台词：${shot.dialogue}\n参考时长：${shot.seconds} 秒`;
                                    ops.push(
                                        { type: "add_node", id: textId, nodeType: "text", title: shot.title, position: { x, y }, metadata: { content: prompt, status: "success" } },
                                        { type: "add_node", id: imageId, nodeType: "image", title: `${shot.title} · 画面`, position: { x: x + 420, y }, metadata: { prompt: shot.picture } },
                                        { type: "add_node", id: videoId, nodeType: "video", title: `${shot.title} · 视频`, position: { x: x + 840, y }, metadata: { prompt } },
                                        { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: textId },
                                        { type: "connect_nodes", fromNodeId: textId, toNodeId: imageId },
                                        { type: "connect_nodes", fromNodeId: textId, toNodeId: videoId },
                                        { type: "connect_nodes", fromNodeId: imageId, toNodeId: videoId },
                                    );
                                });
                                ctx.applyOps(ops);
                            } catch (error) {
                                ctx.updateMetadata({ errorDetails: (error as Error).message });
                            }
                        }}
                    >
                        输出镜头节点（不自动生成）
                    </Button>
                    <Button type="text" size="small" icon={<Rows3 size={13} />} disabled={disabled || !s.shots?.length} onClick={() => {
                        try {
                            const text = shotsToBatchText(s.shots!);
                            const id = nanoid();
                            ctx.applyOps([{ type: "add_node", id, nodeType: "studio:batch", title: "分镜批量任务", position: { x: ctx.node.position.x + ctx.node.width + 100, y: ctx.node.position.y }, metadata: { studio: { text, sourceIds: [] }, status: "idle" } }, { type: "select_nodes", ids: [id] }]);
                        } catch (error) { ctx.updateMetadata({ errorDetails: (error as Error).message }); }
                    }}>转为批量任务</Button>
                    <p className="text-xs" style={{ color: ctx.theme.node.muted }}>可手动编排，也可用模型拆分。转为批量后需检查提示词并确认生成。</p>
                </div>
            )}
            {tool === "compare" && (
                <div className="space-y-2">
                    <label className="block text-xs">
                        同步放大 · {Math.round(zoom * 100)}%<Slider aria-label="同步放大" min={1} max={4} step={0.1} value={zoom} onChange={setZoom} />
                    </label>
                    <Segmented
                        size="small"
                        value={s.comparison || "side"}
                        options={[
                            { value: "side", label: "并排对比" },
                            { value: "wipe", label: "滑动对比" },
                        ]}
                        onChange={(comparison) => patch({ comparison: comparison as "side" | "wipe" })}
                    />
                    <div className={s.comparison === "wipe" ? "relative h-64" : "grid grid-cols-2 gap-2"}>
                        {sources
                            .filter((n) => n.type === "image")
                            .map((node, index) => (
                                <button
                                    type="button"
                                    key={node.id}
                                    aria-label={`精选 ${node.title}`}
                                    aria-pressed={s.selectedId === node.id}
                                    onClick={() => patch({ selectedId: node.id })}
                                    className={`overflow-hidden rounded border ${s.comparison === "wipe" ? "absolute inset-0" : "h-48"}`}
                                    style={{
                                        borderColor: s.selectedId === node.id ? ctx.theme.node.text : ctx.theme.toolbar.border,
                                        ...(s.comparison === "wipe" ? { display: index > 1 ? "none" : undefined, clipPath: index === 1 ? `inset(0 ${100 - (s.wipe ?? 50)}% 0 0)` : undefined } : {}),
                                    }}
                                >
                                    <Original node={node} zoom={zoom} />
                                </button>
                            ))}
                    </div>
                    {s.comparison === "wipe" && (
                        <>
                            <Slider aria-label="对比滑块" value={s.wipe ?? 50} onChange={(wipe) => patch({ wipe })} />
                            <Select className="w-full" aria-label="精选结果" placeholder="选择要输出的原图" options={sources.map((n) => ({ value: n.id, label: n.title }))} value={s.selectedId} onChange={(selectedId) => patch({ selectedId })} />
                            <p className="text-xs">滑动对比使用前两张图片，按各自比例完整显示。</p>
                        </>
                    )}
                </div>
            )}
            {tool === "ocr" && s.text && <Input.TextArea aria-label="识别文字" rows={5} disabled={disabled} value={s.text} onChange={(e) => patch({ text: e.target.value })} />}
            {tool === "subtitles" && (
                <div className="space-y-2">
                    <p className="text-xs">识别会上传所选素材的音轨并调用识别模型；需接口支持时间戳。已有字幕可手动编辑后导出，无需重复识别。</p>
                    {s.cues && (
                        <>
                            <div className="max-h-72 space-y-2 overflow-auto">
                                {s.cues.map((cue, index) => (
                                    <div key={index} className="space-y-1 border-t pt-2" style={{ borderColor: ctx.theme.toolbar.border }}>
                                        <div className="flex items-center justify-between text-xs"><span>字幕 {index + 1}</span><Button type="text" size="small" aria-label={`删除字幕${index + 1}`} disabled={disabled} icon={<Trash2 size={12} />} onClick={() => patch({ cues: s.cues!.filter((_, i) => i !== index) })} /></div>
                                        <div className="flex gap-2">
                                            {(["start", "end"] as const).map((key) => (
                                                <InputNumber
                                                    key={key}
                                                    aria-label={`字幕${index + 1}${key === "start" ? "开始" : "结束"}秒`}
                                                    size="small"
                                                    min={0}
                                                    step={0.1}
                                                    value={cue[key]}
                                                    disabled={disabled}
                                                    onChange={(v) => patch({ cues: s.cues!.map((c, i) => (i === index ? { ...c, [key]: v ?? 0 } : c)) })}
                                                />
                                            ))}
                                        </div>
                                        <Input.TextArea aria-label={`字幕${index + 1}内容`} autoSize value={cue.text} disabled={disabled} onChange={(e) => patch({ cues: s.cues!.map((c, i) => (i === index ? { ...c, text: e.target.value } : c)) })} />
                                    </div>
                                ))}
                            </div>
                            <Button
                                type="text"
                                size="small"
                                disabled={disabled || !s.cues.length}
                                onClick={() =>
                                    void run(async (_, check) => {
                                        const text = subtitleSrt(s.cues!);
                                        check();
                                        saveAs(new Blob([text], { type: "text/plain;charset=utf-8" }), "字幕.srt");
                                    })
                                }
                            >
                                导出 SRT
                            </Button>
                            <Button
                                type="text"
                                size="small"
                                disabled={disabled || sources.length !== 1 || sources[0]?.type !== "video" || !s.cues.length}
                                onClick={() =>
                                    void run(async (signal, check) => {
                                        const artifacts = await processNativeVideo("subtitles", sources, { srt: subtitleSrt(s.cues!) }, signal, () => {});
                                        await saveArtifacts(artifacts, signal, check);
                                    })
                                }
                            >
                                输出字幕视频
                            </Button>
                        </>
                    )}
                    <Button type="text" size="small" disabled={disabled} onClick={() => patch({ cues: [...(s.cues || []), { start: s.cues?.at(-1)?.end || 0, end: (s.cues?.at(-1)?.end || 0) + 1, text: "新字幕" }] })}>
                        添加字幕
                    </Button>
                </div>
            )}
            {tool === "export" && <p className="text-xs">导出所选节点的原始素材；多图节点导出当前主图，不包含 API Key。需要全部图片时，请分别选择对应图片节点。</p>}
            {tool === "batch" && s.items && (
                <div className="max-h-48 space-y-1 overflow-auto text-xs">
                    {s.items.map((item, index) => (
                        <div key={item.id} className="flex gap-2">
                            <span>{index + 1}.</span>
                            <span className="min-w-0 flex-1 truncate">{item.prompt}</span>
                            <span>{item.state === "done" ? "已完成" : item.state === "started" ? "已提交／待确认" : "待执行"}</span>
                        </div>
                    ))}
                    <p>需要新的一批任务时，新建批量节点。已提交任务不会自动重发。</p>
                </div>
            )}
            {ctx.node.metadata?.errorDetails && (
                <p role="alert" className="text-xs leading-5">
                    {ctx.node.metadata.errorDetails}
                </p>
            )}
            <footer className="flex items-center justify-between border-t pt-2" style={{ borderColor: ctx.theme.toolbar.border }}>
                <span className="text-[11px]" style={{ color: ctx.theme.node.muted }}>
                    {["storyboard", "ocr", "subtitles", "batch"].includes(tool) ? "模型调用按站点计费" : "本机处理 · 保留原素材"}
                </span>
                {batchBusy ? (
                    <Button type="text" size="small" onClick={() => ctx.batch?.pause(ctx.node.id)}>
                        本项结束后暂停
                    </Button>
                ) : busy ? (
                    <Button type="text" size="small" onClick={() => active.current?.abort()}>
                        停止等待
                    </Button>
                ) : (
                    <Button className={smallButton} type="text" size="small" icon={<Play size={14} />} disabled={Boolean(sourceError) || (tool === "batch" && !ctx.batch)} onClick={tool === "batch" ? () => confirmBatch() : requestAction}>
                        {tool === "batch" && s.items ? "继续批量任务" : info.action}
                    </Button>
                )}
            </footer>
        </section>
    );
}
export const studioPlugin: CanvasPlugin = {
    id: "studio",
    name: "创作工作流",
    version: "1.0.0",
    description: "分镜、角色参考、批量生成、对比精选、字幕、OCR 和原始素材导出",
    nodes: (Object.keys(studioTools) as StudioTool[]).map((tool) => {
        const Icon = icons[tool];
        return {
            type: `studio:${tool}`,
            title: studioTools[tool].title,
            description: studioTools[tool].description,
            icon: <Icon size={18} />,
            defaultSize: { width: 320, height: 190 },
            defaultMetadata: { studio: {}, status: "idle" },
            autoOpenPanel: true,
            renderOwnStatus: true,
            Content,
            Panel,
            resource: tool === "reference" ? (node) => ({ kind: "text", text: referenceText(node) }) : undefined,
            toolbar: (ctx) => [{ id: "studio-settings", title: "打开创作设置", label: "设置", icon: <Settings2 size={14} />, onClick: ctx.openPanel }],
        };
    }),
};
