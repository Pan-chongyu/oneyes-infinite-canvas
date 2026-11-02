import { useEffect, useRef, useState, type CSSProperties } from "react";
import { App, Button, Checkbox, Input, InputNumber, Select, Progress, Modal } from "antd";
import { Scissors, X, Play, ArrowUp, ArrowDown, ScanLine, WandSparkles, Captions, Download, Plus, Copy, Undo2, Redo2, Settings2 } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import type { EditClip, SmartEditSettings } from "@/types/smart-edit";
import {
    smartEditAccepts,
    editSources,
    editFingerprint,
    editInputSignature,
    localEditPlan,
    smartEditDefaults,
    editDuration,
    editSubtitles,
    validateEditClips,
    splitEditClip,
    resolveEditTextModel,
    editTimeline,
    editAtTime,
    applyEditDraft,
} from "@/lib/canvas/smart-edit";
import { validateCues } from "@/lib/canvas/studio";
import { analyzeEdit, proposeEdit, renderEdit } from "@/services/smart-edit";
import { processNativeVideo } from "@/services/creator-media";
import { uploadMediaFile, deleteStoredMedia } from "@/services/file-storage";
import { videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { SourceSummary } from "./source-summary";
import { SmartEditPreview, type EditPreviewHandle } from "./smart-edit-preview";
import { SmartEditTimeline, editTimecode } from "./smart-edit-timeline";
import { SmartEditTranscript } from "./smart-edit-transcript";
import styles from "./smart-edit-workbench.module.css";
import { useConfigStore } from "@/stores/use-config-store";

const running = new Set<string>();
const taskKey = (ctx: CanvasNodeContext) => `${ctx.projectId}:${ctx.node.id}`;
const readSources = (ctx: CanvasNodeContext) => editSources(ctx.getNode(ctx.node.id) || ctx.node, ctx.getNodes(), ctx.getConnections());
const modes = [
    { label: "手动剪辑", value: "manual", hint: "整段导入，自由修剪" },
    { label: "口播精剪", value: "silence", hint: "本机去停顿，保留语气" },
    { label: "分镜选片", value: "scenes", hint: "按镜头拆开，再挑选" },
    { label: "文字剪辑", value: "text", hint: "勾选字幕，按句剪辑" },
    { label: "AI 编排", value: "ai", hint: "说出要求，先审稿再应用" },
];
function Content({ ctx }: { ctx: CanvasNodeContext }) {
    const settings = ctx.node.metadata?.smartEdit,
        loading = ctx.node.metadata?.status === "loading";
    useEffect(() => {
        if (loading && !running.has(taskKey(ctx))) ctx.updateMetadata({ status: "error", loadingMessage: undefined, errorDetails: "上次剪辑已中断，已保存的分析与片段保留；请手动继续，模型请求不会自动重发" });
    }, [ctx.projectId, ctx.node.id]);
    return (
        <div className="flex h-full flex-col justify-between gap-2 p-4" style={{ color: ctx.theme.node.text }} data-smart-edit-node>
            <div className="flex items-start gap-3">
                <Scissors size={22} className="shrink-0" />
                <div>
                    <div className="text-sm font-medium">智能剪辑</div>
                    <p className="mb-0 mt-1 text-xs leading-5" style={{ color: ctx.theme.node.muted }}>
                        选片、去停顿、字幕与配乐，一处完成。
                    </p>
                </div>
            </div>
            <div role="status" className="line-clamp-2 text-xs" style={{ color: ctx.theme.node.muted }}>
                {loading
                    ? ctx.node.metadata?.loadingMessage || "正在准备剪辑…"
                    : ctx.node.metadata?.errorDetails ||
                      (settings?.clips?.length ? `${settings.clips.filter((c) => c.enabled).length} 个保留片段 · ${modes.find((m) => m.value === (settings.mode || "silence"))?.label}` : "连接素材，先生成可编辑的剪辑清单")}
            </div>
            <Button type="text" size="small" className="self-start" icon={<Scissors size={14} />} onPointerDown={(e) => e.stopPropagation()} onClick={ctx.openPanel}>
                打开剪辑
            </Button>
        </div>
    );
}
export function SmartEditPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const latest = useRef(ctx);
    latest.current = ctx;
    const guard = useRef<{ expected: string; check: () => void; controller: AbortController } | null>(null);
    const active = useRef<AbortController | null>(null),
        [busy, setBusy] = useState(false),
        [progress, setProgress] = useState<number>(),
        [previewId, setPreviewId] = useState(""),
        [search, setSearch] = useState("");
    const { modal } = App.useApp();
    const alive = useRef(false),
        previewControl = useRef<EditPreviewHandle>(null),
        program = useRef<HTMLVideoElement>(null);
    const [cursor, setCursor] = useState(0),
        [seekTarget, setSeekTarget] = useState<{ id: string; time: number; serial: number }>();
    const [audition, setAudition] = useState<EditClip>(),
        [libraryTab, setLibraryTab] = useState("clips");
    const [rendered, setRendered] = useState<{ url: string; blob: Blob; signature: string }>(),
        [showRendered, setShowRendered] = useState(false);
    const renderedRef = useRef(rendered);
    renderedRef.current = rendered;
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const [history, setHistory] = useState<{ past: EditClip[][]; future: EditClip[][] }>({ past: [], future: [] });
    const s = ctx.node.metadata?.smartEdit || {},
        mode = s.mode || "silence";
    useEffect(() => {
        setLibraryTab(mode === "text" ? "transcript" : "clips");
    }, [mode]);
    useEffect(() => {
        setAudition(undefined);
    }, [ctx.projectId, ctx.node.id, s.analysis, s.clips]);
    let sources: CanvasNodeData[] = [],
        sourceError = "";
    try {
        sources = readSources(ctx);
    } catch (error) {
        sourceError = (error as Error).message;
    }
    const fingerprint = editFingerprint(sources, s, ctx.getConnections()),
        current = s.analysis?.fingerprint === fingerprint,
        disabled = busy || Boolean(sourceError);
    const outputSignature = JSON.stringify([editInputSignature(sources, ctx.getConnections()), s]);
    useEffect(() => {
        if (rendered && rendered.signature !== outputSignature) {
            URL.revokeObjectURL(rendered.url);
            setRendered(undefined);
            setShowRendered(false);
        }
    }, [outputSignature, rendered]);
    const patch = (value: Partial<SmartEditSettings>) => {
        const smartEdit = { ...latest.current.getNode(ctx.node.id)?.metadata?.smartEdit, ...value };
        if (guard.current) guard.current.expected = JSON.stringify(smartEdit);
        latest.current.updateMetadata({ smartEdit, errorDetails: undefined });
    };
    const editClips = (clips: EditClip[], settings: Partial<SmartEditSettings> = {}) => {
        if (JSON.stringify(clips) === JSON.stringify(s.clips || []) && !Object.keys(settings).length) return;
        setHistory((h) => ({ past: [...h.past, s.clips || []], future: [] }));
        patch({ ...settings, clips });
    };
    // Undo is local to this editing session; the current plan remains persisted on the node.
    useEffect(() => {
        setHistory({ past: [], future: [] });
    }, [ctx.projectId, ctx.node.id, s.analysis]);
    const undo = () => {
        const clips = history.past.at(-1);
        if (!clips) return;
        setHistory({ past: history.past.slice(0, -1), future: [s.clips || [], ...history.future] });
        patch({ clips });
    };
    const redo = () => {
        const clips = history.future[0];
        if (!clips) return;
        setHistory({ past: [...history.past, s.clips || []], future: history.future.slice(1) });
        patch({ clips });
    };
    const ids =
        s.sourceIds ??
        ctx
            .getConnections()
            .filter((c) => c.toNodeId === ctx.node.id)
            .map((c) => c.fromNodeId);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            active.current?.abort();
            if (renderedRef.current) URL.revokeObjectURL(renderedRef.current.url);
        };
    }, [ctx.projectId, ctx.node.id]);
    useEffect(() => {
        try {
            guard.current?.check();
        } catch (error) {
            guard.current?.controller.abort(error);
        }
    });
    const run = async (task: (signal: AbortSignal, check: () => void, stage: (text: string, progress?: number) => void) => Promise<void>) => {
        if (!alive.current || taskKey(latest.current) !== taskKey(ctx) || !latest.current.getNode(ctx.node.id) || active.current || running.has(taskKey(ctx))) return;
        const controller = new AbortController(),
            key = taskKey(ctx),
            original = editInputSignature(sources, ctx.getConnections());
        active.current = controller;
        running.add(key);
        setBusy(true);
        setProgress(undefined);
        const check = () => {
            controller.signal.throwIfAborted();
            if (taskKey(latest.current) !== key || !latest.current.getNode(ctx.node.id)) throw new DOMException("画布或节点已关闭", "AbortError");
            if (editInputSignature(readSources(latest.current), latest.current.getConnections()) !== original || JSON.stringify(latest.current.getNode(ctx.node.id)?.metadata?.smartEdit || {}) !== guard.current?.expected)
                throw Error("素材或设置已改变，请重新确认后继续；已受理的模型请求请先检查用量");
        };
        guard.current = { expected: JSON.stringify(s), check, controller };
        ctx.updateMetadata({ status: "loading", loadingMessage: "正在准备剪辑…", errorDetails: undefined });
        // Native progress callbacks must not throw outside the awaited task.
        const stage = (text: string, value?: number) => {
            try {
                check();
                latest.current.updateMetadata({ loadingMessage: text });
                setProgress(value);
            } catch (error) {
                controller.abort(error);
            }
        };
        try {
            check();
            if (sourceError) throw Error(sourceError);
            await task(controller.signal, check, stage);
            check();
            latest.current.updateMetadata({ status: "success", loadingMessage: undefined });
        } catch (error) {
            const reason = controller.signal.reason;
            if (taskKey(latest.current) === key && latest.current.getNode(ctx.node.id))
                latest.current.updateMetadata({
                    status: "error",
                    loadingMessage: undefined,
                    errorDetails: controller.signal.aborted ? (reason instanceof Error && reason.name !== "AbortError" ? reason.message : "已停止处理，原素材与已保存清单保留；已受理的模型请求不会自动重发，请先核对用量") : (error as Error).message,
                });
        } finally {
            running.delete(key);
            if (active.current === controller) {
                active.current = null;
                guard.current = null;
                setBusy(false);
                setProgress(undefined);
            }
        }
    };
    const analyze = () =>
        void run(async (signal, check, stage) => {
            const analysis = await analyzeEdit(sources, s, ctx.getConnections(), signal, (p) => stage(p.stage, p.progress));
            check();
            const next: Partial<SmartEditSettings> = { analysis, clips: undefined, rationale: undefined, draft: undefined, planMode: undefined, planPadding: undefined };
            // Save successful analysis even when text editing still needs subtitles.
            try {
                if (mode !== "ai") Object.assign(next, { clips: localEditPlan(analysis, mode, s.padding ?? smartEditDefaults.padding), planMode: mode, planPadding: s.padding ?? smartEditDefaults.padding });
            } finally {
                patch(next);
            }
        });
    const rebuild = () => {
        if (!alive.current || taskKey(latest.current) !== taskKey(ctx) || !latest.current.getNode(ctx.node.id)) return;
        try {
            if (!current || !s.analysis) throw Error("请先分析当前素材");
            editClips(localEditPlan(s.analysis, mode, s.padding ?? smartEditDefaults.padding), { rationale: undefined, planMode: mode, planPadding: s.padding ?? smartEditDefaults.padding });
        } catch (error) {
            ctx.updateMetadata({ errorDetails: (error as Error).message });
        }
    };
    const transcribe = () => {
        if (!s.analysis || !current) return;
        const missing = s.analysis.sources.filter((source) => source.kind === "video" && source.audioTracks && !source.cues?.length);
        if (!missing.length) return;
        modal.confirm({
            title: `识别 ${missing.length} 份素材的字幕？`,
            content: "将提取并上传音轨到所选语音识别模型，按站点计费。已识别的素材直接复用；失败或取消后不会自动重发。",
            okText: "开始识别",
            cancelText: "取消",
            onOk: () => {
                void run(async (signal, check, stage) => {
                    if (!s.speechModel?.trim() || !ctx.ai.transcribe) throw Error("请先选择支持时间戳的语音识别模型");
                    let analysis = s.analysis!;
                    for (const [index, item] of missing.entries()) {
                        check();
                        stage(`正在提取音轨 ${index + 1} / ${missing.length}`);
                        const source = sources.find((n) => n.id === item.id)!;
                        const audio = await processNativeVideo("extract", [source], {}, signal, (p) => stage(p.stage, p.progress));
                        check();
                        stage(`正在识别「${item.title}」`);
                        const cues = validateCues(await ctx.ai.transcribe!(audio[0].blob, s.speechModel!, signal));
                        check();
                        if (cues.some((c) => c.end > item.duration)) throw Error("识别字幕超出素材时长，请检查模型时间戳");
                        analysis = { ...analysis, sources: analysis.sources.map((a) => (a.id === item.id ? { ...a, cues } : a)) };
                        patch({ analysis, draft: undefined });
                    }
                });
            },
        });
    };
    const propose = () => {
        let model;
        try {
            model = resolveEditTextModel(ctx.ai, s.model);
        } catch (error) {
            ctx.updateMetadata({ errorDetails: (error as Error).message });
            return;
        }
        modal.confirm({
            title: "生成 AI 草稿？",
            content: `使用「${model.label}」，将素材名称、镜头时间、字幕、当前清单和剪辑要求发送到模型并按站点计费。此步骤不上传视频和图片；没有字幕时只能依据镜头边界编排。先生成待审阅草稿，确认应用后才替换时间线，也可撤销。`,
            okText: "生成草稿",
            cancelText: "取消",
            onOk: () => {
                void run(async (signal, check, stage) => {
                    if (!s.analysis || !current) throw Error("请先分析当前素材");
                    stage("正在编排剪辑清单…");
                    const plan = await proposeEdit(latest.current.ai, sources, { ...s, model: model.value }, s.analysis, signal);
                    check();
                    patch({ draft: { ...plan, model: model.value, fingerprint, baseClips: JSON.stringify(s.clips || []) } });
                });
            },
        });
    };
    const preview = () => {
        if (rendered?.signature === outputSignature) {
            setShowRendered(true);
            return;
        }
        void run(async (signal, check, stage) => {
            const result = await renderEdit(sources, s, signal, (p) => stage(p.stage, p.progress), ctx.getConnections());
            check();
            if (renderedRef.current) URL.revokeObjectURL(renderedRef.current.url);
            setRendered({ blob: result.video.blob, url: URL.createObjectURL(result.video.blob), signature: outputSignature });
            setShowRendered(true);
        });
    };
    const render = () =>
        void run(async (signal, check, stage) => {
            const blob = rendered?.signature === outputSignature ? rendered.blob : (await renderEdit(sources, s, signal, (p) => stage(p.stage, p.progress), ctx.getConnections())).video.blob;
            check();
            stage("正在保存成片到画布…");
            let key: string | undefined,
                committed = false;
            try {
                const file = await uploadMediaFile(blob, "video");
                key = file.storageKey;
                check();
                const id = nanoid();
                latest.current.applyOps([
                    { type: "add_node", id, nodeType: "video", title: `${ctx.node.title} · 成片`, position: { x: ctx.node.position.x + ctx.node.width + 100, y: ctx.node.position.y }, width: 340, height: 240, metadata: videoMetadata(file) },
                    { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
                ]);
                committed = true;
            } finally {
                if (!committed && key) await deleteStoredMedia([key]);
            }
        });
    const changeClip = (id: string, value: Partial<EditClip>) => editClips((s.clips || []).map((c) => (c.id === id ? { ...c, ...value } : c)));
    const clips = s.clips || [],
        enabled = clips.filter((c) => c.enabled);
    let duration = "",
        planError = "";
    if (clips.length && current)
        try {
            validateEditClips(clips, s.analysis!);
            duration = `${editDuration(clips, s.transition ?? 0).toFixed(1)} 秒`;
        } catch (error) {
            planError = (error as Error).message;
        }
    const chosen = clips.find((c) => c.id === previewId) || clips[0];
    const monitored = audition || chosen;
    const visuals = sources.filter((n) => ["video", "image"].includes(n.type)),
        needsTranscript = current && mode === "text" && s.analysis?.sources.some((source) => source.kind === "video" && !source.cues?.length),
        step = !current ? 0 : needsTranscript ? 1 : enabled.length ? 2 : 1,
        nextHint = !visuals.length
            ? "先在左侧选择视频或图片，也可从画布连线导入素材。"
            : !current
              ? "素材已选好，点击分析；这一步在本机完成，不调用模型。"
              : needsTranscript
                ? "还缺字幕：连接字幕节点，或选择语音模型后识别。"
                : s.draft
                  ? "AI 草稿已就绪。先对比，再应用到时间线；应用后仍可手调。"
                  : enabled.length
                    ? "在时间线修剪，或切到文字选句。满意后先预览成片，再输出。"
                    : mode === "ai"
                      ? "填写剪辑要求，生成草稿后审阅应用；也可切到手动整段导入。"
                      : "按当前方式生成清单，再进入精修。";
    let textModel,
        modelError = "";
    try {
        textModel = resolveEditTextModel(ctx.ai, s.model);
    } catch (error) {
        modelError = (error as Error).message;
    }
    const number = (key: keyof typeof smartEditDefaults, label: string, props: { min?: number; max?: number; step?: number } = {}) => (
        <label className="flex items-center justify-between gap-2 text-xs" key={key}>
            {label}
            <InputNumber size="small" aria-label={label} disabled={busy} value={s[key] ?? smartEditDefaults[key]} {...props} onChange={(value) => patch({ [key]: value ?? smartEditDefaults[key] })} />
        </label>
    );
    const saveManifest = () => {
        try {
            if (!current) throw Error("请先重新分析当前素材");
            validateEditClips(clips, s.analysis!);
            saveAs(
                new Blob(
                    [
                        JSON.stringify(
                            {
                                version: 1,
                                sources: s.analysis!.sources.map(({ id, title, kind, duration, width, height }) => ({ id, title, kind, duration, width, height })),
                                clips,
                                effects: { color: s.color || "original", title: s.title || "", transition: s.transition ?? 0, audioFade: s.audioFade ?? 0, originalVolume: s.originalVolume ?? 1, musicVolume: s.musicVolume ?? 0.25 },
                                rationale: s.rationale || "",
                            },
                            null,
                            2,
                        ),
                    ],
                    { type: "application/json" },
                ),
                "OneYes-剪辑清单.json",
            );
        } catch (error) {
            ctx.updateMetadata({ errorDetails: (error as Error).message });
        }
    };
    const choose = (id: string) => {
        setAudition(undefined);
        setPreviewId(id);
        setShowRendered(false);
    };
    const split = (time: number) => {
        if (!chosen) return;
        try {
            const pair = splitEditClip(chosen, time);
            editClips(clips.flatMap((c) => (c.id === chosen.id ? pair : [c])));
            choose(pair[1].id);
        } catch (error) {
            ctx.updateMetadata({ errorDetails: (error as Error).message });
        }
    };
    const seekSequence = (time: number) => {
        if (showRendered && program.current) {
            program.current.pause();
            program.current.currentTime = time;
            setCursor(time);
            return;
        }
        const point = editAtTime(clips, s.transition ?? 0, time);
        if (point) {
            choose(point.clip.id);
            setSeekTarget((previous) => ({ id: point.clip.id, time: point.time, serial: (previous?.serial || 0) + 1 }));
            setCursor(time);
        }
    };
    let draftError = "";
    if (s.draft)
        try {
            applyEditDraft(s, fingerprint);
        } catch (error) {
            draftError = (error as Error).message;
        }
    const applyDraft = () => {
        try {
            const next = applyEditDraft(s, fingerprint);
            editClips(next.clips, next);
            choose(next.clips[0].id);
        } catch (error) {
            ctx.updateMetadata({ errorDetails: (error as Error).message });
        }
    };
    const keyboard = (event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
        }
        if (busy || (event.target as HTMLElement).closest("input,textarea,select,button,[role='combobox'],[contenteditable='true']")) return;
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === "z") {
            event.preventDefault();
            event.shiftKey ? redo() : undo();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && key === "y") {
            event.preventDefault();
            redo();
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.code === "Space") {
            event.preventDefault();
            if (showRendered && program.current) {
                if (program.current.paused) void program.current.play().catch(() => {});
                else program.current.pause();
            } else previewControl.current?.play();
        } else if (!showRendered && key === "s") {
            event.preventDefault();
            previewControl.current?.split();
        } else if (!showRendered && key === "i") {
            event.preventDefault();
            previewControl.current?.markIn();
        } else if (!showRendered && key === "o") {
            event.preventDefault();
            previewControl.current?.markOut();
        } else if (!showRendered && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            previewControl.current?.step(event.key === "ArrowLeft" ? -1 : 1);
        } else if (!audition && ["Delete", "Backspace"].includes(event.key) && chosen) {
            event.preventDefault();
            editClips(clips.filter((c) => c.id !== chosen.id));
        }
    };
    return (
        <Modal
            open
            centered
            footer={null}
            title={null}
            closable={false}
            width="calc(100vw - 32px)"
            onCancel={onClose}
            destroyOnHidden
            data-canvas-shortcuts-ignore
            data-canvas-no-zoom
            styles={{ container: { padding: 0, background: ctx.theme.node.panel }, body: { padding: 0 } }}
        >
            <section
                className={styles.workbench}
                data-smart-edit-panel
                tabIndex={-1}
                aria-label="智能剪辑工作台"
                style={{ "--edit-surface": ctx.theme.node.panel, "--edit-canvas": ctx.theme.canvas.background, "--edit-border": ctx.theme.toolbar.border, "--edit-text": ctx.theme.node.text, "--edit-selected": ctx.theme.toolbar.activeBg } as CSSProperties}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onKeyDown={keyboard}
            >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: ctx.theme.toolbar.border }}>
                    <div className="flex min-w-0 items-center gap-3">
                        <Scissors size={18} />
                        <span className="text-sm font-medium">智能剪辑</span>
                        <span className="truncate text-xs opacity-60">{ctx.node.title === "智能剪辑" ? "从初剪到精剪" : ctx.node.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="mr-3 hidden text-[11px] opacity-60 md:block">
                            {enabled.length} 个保留片段{duration && " · " + duration} · 随画布保存
                        </span>
                        <Button type="text" size="small" aria-label="撤销片段编辑" icon={<Undo2 size={14} />} disabled={busy || !history.past.length} onClick={undo} />
                        <Button type="text" size="small" aria-label="重做片段编辑" icon={<Redo2 size={14} />} disabled={busy || !history.future.length} onClick={redo} />
                        <Button type="text" size="small" aria-label="关闭剪辑" icon={<X size={16} />} onClick={onClose} />
                    </div>
                </header>
                <div className={styles.guide} aria-label="剪辑流程">
                    <ol className={styles.steps}>
                        {["准备素材", "生成初剪", "精修与输出"].map((label, index) => (
                            <li key={label} aria-current={step === index ? "step" : undefined}>
                                <span>{index + 1}</span>
                                {label}
                            </li>
                        ))}
                    </ol>
                    <p className="m-0 min-w-0 text-xs leading-5 opacity-65" role="status">
                        {nextHint}
                    </p>
                </div>
                <div className={styles.layout}>
                    <aside className={styles.library + " thin-scrollbar space-y-3"} aria-label="素材与智能助手">
                        <h3 className="m-0 text-xs font-medium">素材与智能助手</h3>
                        <details open={!current} className="space-y-2 text-xs">
                            <summary className="cursor-pointer py-1">
                                素材与脚本<span className="ml-2 opacity-60">{sources.length} 份</span>
                            </summary>
                            <Select
                                aria-label="剪辑素材"
                                className="w-full"
                                mode="multiple"
                                showSearch={{ optionFilterProp: "label" }}
                                disabled={busy}
                                value={ids}
                                options={ctx
                                    .getNodes()
                                    .filter((n) => n.id !== ctx.node.id && smartEditAccepts(n.type))
                                    .map((n) => ({ label: n.title, value: n.id }))}
                                onChange={(sourceIds) => patch({ sourceIds })}
                                placeholder="视频、图片、配乐、字幕或脚本"
                            />
                            <div className="max-h-28 space-y-1 overflow-auto">
                                {sources.map((source, index) => (
                                    <div key={source.id} className="flex items-center gap-1">
                                        <SourceSummary node={source} />
                                        {[-1, 1].map((offset) => (
                                            <Button
                                                type="text"
                                                size="small"
                                                key={offset}
                                                aria-label={`${offset < 0 ? "上移" : "下移"}${source.title}`}
                                                disabled={busy || index + offset < 0 || index + offset >= ids.length}
                                                icon={offset < 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                                onClick={() => {
                                                    const next = [...ids];
                                                    [next[index], next[index + offset]] = [next[index + offset], next[index]];
                                                    patch({ sourceIds: next });
                                                }}
                                            />
                                        ))}
                                        <Button type="text" size="small" aria-label={`移除${source.title}`} disabled={busy} icon={<X size={12} />} onClick={() => patch({ sourceIds: ids.filter((id) => id !== source.id) })} />
                                    </div>
                                ))}
                            </div>
                            <Button type="text" size="small" disabled={busy} onClick={() => patch({ sourceIds: undefined })}>
                                使用上游连线
                            </Button>
                        </details>

                        <details open={!current} className="text-xs">
                            <summary className="cursor-pointer py-1">剪辑方式 · {modes.find((item) => item.value === mode)?.label}</summary>
                            <div className={styles.modes} role="group" aria-label="剪辑方式">
                                {modes.map((item) => (
                                    <button type="button" key={item.value} aria-pressed={mode === item.value} disabled={busy} onClick={() => patch({ mode: item.value as SmartEditSettings["mode"] })}>
                                        <span>{item.label}</span>
                                        <small>{item.hint}</small>
                                    </button>
                                ))}
                            </div>
                        </details>
                        <p className="m-0 text-[11px] leading-5 opacity-65">切换方式保留清单，重新生成前会确认。</p>
                        <div className="flex flex-wrap items-center gap-1">
                            <Button
                                type="text"
                                size="small"
                                icon={<ScanLine size={14} />}
                                disabled={disabled || !sources.some((n) => ["video", "image"].includes(n.type))}
                                onClick={() => (clips.length ? modal.confirm({ title: "重新分析素材？", content: "将重建当前剪辑清单，原素材和已输出视频保留。", okText: "重新分析", cancelText: "保留清单", onOk: analyze }) : analyze())}
                            >
                                {current ? "重新分析" : mode === "manual" ? "读取素材" : "分析素材"}
                            </Button>
                            {current && mode !== "ai" && (
                                <Button
                                    type="text"
                                    size="small"
                                    disabled={disabled}
                                    onClick={() => (clips.length ? modal.confirm({ title: "重建片段清单？", content: "将按当前剪辑方式重建片段，替换手动调整。", okText: "重建清单", cancelText: "取消", onOk: rebuild }) : rebuild())}
                                >
                                    {mode === "manual" ? "整段导入清单" : "按当前方式生成清单"}
                                </Button>
                            )}
                        </div>
                        {s.analysis && !current && (
                            <p className="m-0 text-xs" role="alert">
                                素材或分析参数已改变，请重新分析后输出。
                            </p>
                        )}
                        {(mode === "ai" || mode === "text" || libraryTab === "transcript") && (
                            <details className="space-y-2 text-xs" open={mode === "text" && Boolean(needsTranscript)}>
                                <summary className="cursor-pointer py-1">
                                    语音识别与字幕<span className="ml-2 opacity-60">{needsTranscript ? "待准备" : "可选"}</span>
                                </summary>
                                <label className="block space-y-1 text-xs">
                                    语音识别模型
                                    <Select
                                        className="w-full"
                                        size="small"
                                        aria-label="剪辑语音模型"
                                        disabled={busy}
                                        allowClear
                                        showSearch={{ optionFilterProp: "label" }}
                                        options={ctx.ai.listModels("audio")}
                                        value={s.speechModel}
                                        onChange={(speechModel) => patch({ speechModel })}
                                        placeholder="已开通且支持时间戳的模型"
                                    />
                                </label>
                                <Input size="small" aria-label="剪辑语音模型名称" disabled={busy} value={s.speechModel} onChange={(e) => patch({ speechModel: e.target.value })} placeholder="也可填写准确的语音模型名称" />
                                <Button type="text" size="small" icon={<Captions size={14} />} disabled={disabled || !current || !s.analysis?.sources.some((a) => a.kind === "video" && a.audioTracks && !a.cues?.length)} onClick={transcribe}>
                                    识别缺失字幕
                                </Button>
                                <p className="m-0 text-[11px]" style={{ color: ctx.theme.node.muted }}>
                                    连接已有「语音转字幕」节点可复用对应字幕；识别会上传音轨并计费。按字幕搜索、保留或删除整段，不猜测词级时间。
                                </p>
                            </details>
                        )}
                        {mode === "ai" && (
                            <div className="space-y-2">
                                <Input.TextArea
                                    rows={3}
                                    aria-label="剪辑要求"
                                    disabled={busy}
                                    value={s.instruction}
                                    placeholder="例如：做一段产品介绍，保留核心卖点，删掉寒暄和重复内容。也可连接分镜脚本。"
                                    onChange={(e) => patch({ instruction: e.target.value })}
                                />
                                <Select
                                    aria-label="剪辑文本模型"
                                    className="w-full"
                                    size="small"
                                    allowClear
                                    showSearch={{ optionFilterProp: "label" }}
                                    disabled={busy}
                                    options={ctx.ai.listModels("text")}
                                    value={s.model}
                                    onChange={(model) => patch({ model })}
                                    placeholder={textModel ? `默认：${textModel.label}` : "请选择已接入的文本模型"}
                                />
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                    <Button type="text" size="small" icon={<WandSparkles size={14} />} disabled={disabled || !current || Boolean(modelError)} onClick={propose}>
                                        生成 AI 草稿
                                    </Button>
                                    <Button type="text" size="small" icon={<Settings2 size={13} />} disabled={busy} onClick={() => openConfig(false, "channels")}>
                                        模型设置
                                    </Button>
                                </div>
                                <p className="m-0 text-[11px] leading-5" role={modelError ? "alert" : "status"} style={{ color: ctx.theme.node.muted }}>
                                    {modelError || `当前：${textModel?.label}。沿用已接入的渠道和 Key，生成后可手动修改。`}
                                </p>
                            </div>
                        )}

                        {mode === "ai" && (
                            <div className="flex flex-wrap gap-1">
                                {[
                                    ["口播精剪", "保留核心观点与结论，删除寒暄、重复和无信息停顿；依据段级字幕整句剪辑，保持原意与前后逻辑。"],
                                    ["产品成片", "按问题、产品卖点、使用价值和行动建议组织素材，优先选择具体信息，避免重复与夸大；开场直接进入重点。"],
                                    ["叙事短片", "从现有脚本与字幕寻找引入、发展、转折和结尾；保持事件因果，镜头按叙事重排，不编造不存在的画面或台词。"],
                                ].map(([label, instruction]) => (
                                    <Button key={label} type="text" size="small" disabled={busy} onClick={() => patch({ instruction })}>
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        )}
                        {s.draft && (
                            <div className={styles.draft + " space-y-2 text-xs"} data-edit-draft>
                                <div className="font-medium">AI 草稿 · 待审阅</div>
                                <p className="m-0 leading-5 opacity-70">
                                    当前 {enabled.length} 段 → 建议 {s.draft.clips.length} 段，净素材 {editTimecode(editDuration(s.draft.clips, 0))}。应用后才会改变时间线。
                                </p>
                                <div className={styles.comparison} aria-label="AI 草稿时长对比">
                                    <span>
                                        当前素材 <strong>{editTimecode(editDuration(clips, 0))}</strong>
                                    </span>
                                    <span>
                                        草稿素材 <strong>{editTimecode(editDuration(s.draft.clips, 0))}</strong>
                                    </span>
                                    <span className="col-span-2 opacity-65">
                                        {(() => {
                                            const delta = editDuration(s.draft.clips, 0) - editDuration(clips, 0);
                                            return `${delta > 0 ? "增加" : "减少"} ${editTimecode(Math.abs(delta))} · 均为转场前时长`;
                                        })()}
                                    </span>
                                </div>
                                <p className="m-0 leading-5">{s.draft.rationale}</p>
                                <ol className="m-0 max-h-48 space-y-2 overflow-auto pl-4">
                                    {s.draft.clips.map((c) => (
                                        <li key={c.id}>
                                            <div className="truncate">{s.analysis?.sources.find((a) => a.id === c.sourceId)?.title}</div>
                                            <span className="tabular-nums opacity-60">
                                                {editTimecode(c.start)}–{editTimecode(c.end)}
                                            </span>
                                            <p className="m-0 leading-5 opacity-75">{c.label}</p>
                                            <Button
                                                type="text"
                                                size="small"
                                                disabled={busy || Boolean(draftError)}
                                                onClick={() => {
                                                    setAudition(c);
                                                    setShowRendered(false);
                                                    setSeekTarget((previous) => ({ id: c.id, time: c.start, serial: (previous?.serial || 0) + 1 }));
                                                }}
                                            >
                                                预览这段
                                            </Button>
                                        </li>
                                    ))}
                                </ol>
                                {draftError && (
                                    <p className="m-0 leading-5" role="alert">
                                        {draftError}
                                    </p>
                                )}
                                <div className="flex gap-1">
                                    <Button type="text" size="small" disabled={busy || Boolean(draftError)} onClick={applyDraft}>
                                        应用 AI 草稿
                                    </Button>
                                    <Button type="text" size="small" disabled={busy} onClick={() => patch({ draft: undefined })}>
                                        放弃草稿
                                    </Button>
                                </div>
                            </div>
                        )}
                        {s.rationale && <p className="m-0 text-xs leading-5 opacity-60">{s.rationale}</p>}
                        {current && s.analysis && (
                            <>
                                <div className={styles.tabs} role="group" aria-label="浏览剪辑内容">
                                    <button type="button" aria-pressed={libraryTab === "clips"} onClick={() => setLibraryTab("clips")}>
                                        片段清单 · {clips.length}
                                    </button>
                                    <button type="button" aria-pressed={libraryTab === "transcript"} onClick={() => setLibraryTab("transcript")}>
                                        文字精剪
                                    </button>
                                </div>
                                {libraryTab === "clips" ? (
                                    <>
                                        <Input size="small" aria-label="搜索剪辑片段" allowClear value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索当前片段" />
                                        <div className="space-y-1" aria-label="片段列表">
                                            {clips
                                                .filter((c) => !search || c.label.includes(search))
                                                .map((c) => (
                                                    <button
                                                        key={c.id}
                                                        type="button"
                                                        disabled={busy}
                                                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:opacity-70"
                                                        style={{ background: c.id === chosen?.id ? ctx.theme.toolbar.activeBg : undefined, opacity: c.enabled ? 1 : 0.5 }}
                                                        onClick={() => choose(c.id)}
                                                    >
                                                        <span className="w-5 shrink-0 tabular-nums opacity-50">{clips.indexOf(c) + 1}</span>
                                                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                                        <span className="text-[10px] tabular-nums opacity-60">{(c.end - c.start).toFixed(2)}s</span>
                                                    </button>
                                                ))}
                                        </div>
                                        {!clips.length && <p className="m-0 text-xs leading-5 opacity-65">还没有片段。按当前方式生成清单，或切到文字精剪勾选字幕。</p>}
                                    </>
                                ) : (
                                    <SmartEditTranscript
                                        analysis={s.analysis}
                                        clips={clips}
                                        disabled={busy}
                                        onEdit={(next) => {
                                            const settings = latest.current.getNode(ctx.node.id)?.metadata?.smartEdit;
                                            if (
                                                !alive.current ||
                                                taskKey(latest.current) !== taskKey(ctx) ||
                                                running.has(taskKey(ctx)) ||
                                                !settings ||
                                                JSON.stringify(settings.analysis) !== JSON.stringify(s.analysis) ||
                                                JSON.stringify(settings.clips || []) !== JSON.stringify(clips)
                                            )
                                                throw Error("素材或清单已改变，请重新确认字幕选择");
                                            editClips(next);
                                            if (next[0]) choose(next[0].id);
                                        }}
                                        onPreview={(value) => {
                                            setAudition(value);
                                            setShowRendered(false);
                                            setSeekTarget((previous) => ({ id: value.id, time: value.start, serial: (previous?.serial || 0) + 1 }));
                                        }}
                                    />
                                )}
                            </>
                        )}
                    </aside>
                    <main className={styles.monitor + " thin-scrollbar"} aria-label="剪辑监视器">
                        <div className="mb-3 flex items-center justify-between text-xs">
                            <span>{showRendered && rendered ? "成片预览" : audition ? "选段预览 · 不改变时间线" : "源素材预览"}</span>
                            {audition && !showRendered && (
                                <Button type="text" size="small" onClick={() => setAudition(undefined)}>
                                    返回时间线
                                </Button>
                            )}
                            {showRendered && (
                                <Button type="text" size="small" onClick={() => setShowRendered(false)}>
                                    返回源素材
                                </Button>
                            )}
                            <span className="opacity-55">
                                {s.analysis?.sources.find((a) => a.id === chosen?.sourceId)?.width || "—"} × {s.analysis?.sources.find((a) => a.id === chosen?.sourceId)?.height || "—"} · 原始尺寸
                            </span>
                        </div>
                        {showRendered && rendered ? (
                            <div className="space-y-3" data-edit-program>
                                <video ref={program} src={rendered.url} controls playsInline className="w-full object-contain" style={{ height: "clamp(180px, calc(100dvh - 450px), 620px)" }} onTimeUpdate={(e) => setCursor(e.currentTarget.currentTime)} />
                                <p className="m-0 text-xs opacity-65">已在本机合成实际转场、字幕、标题和声音；未修改时，输出成片会直接复用该结果。</p>
                            </div>
                        ) : (
                            <SmartEditPreview
                                controls={previewControl}
                                seekTarget={seekTarget}
                                source={sources.find((n) => n.id === monitored?.sourceId)}
                                detail={s.analysis?.sources.find((a) => a.id === monitored?.sourceId)}
                                clip={monitored}
                                readOnly={Boolean(audition)}
                                disabled={busy || !current}
                                onChange={(value) => changeClip(value.id, value)}
                                onSplit={split}
                                onCursor={(time) => {
                                    if (audition || !chosen?.enabled) return;
                                    try {
                                        const item = editTimeline(clips, s.transition ?? 0).find((t) => t.clip.id === chosen.id);
                                        if (item) setCursor(item.start + Math.max(0, Math.min(chosen.end - chosen.start, time - chosen.start)));
                                    } catch {
                                        /* Invalid ranges are repaired in the inspector. */
                                    }
                                }}
                            />
                        )}
                        {s.analysis && !current && (
                            <p className="mt-3 text-xs" role="alert">
                                素材或分析参数已改变，请重新分析后输出。
                            </p>
                        )}
                        <p className="mt-3 text-[10px] leading-5 opacity-55">空格播放 / 暂停 · ← → 逐帧 · I / O 入出点 · S 切分 · Delete 删除 · Ctrl / ⌘ Z 撤销。点击空白处后使用快捷键。</p>
                    </main>
                    <aside className={styles.inspector + " thin-scrollbar space-y-4"} aria-label="片段检查器" inert={Boolean(audition)}>
                        <div className="flex items-center justify-between">
                            <h3 className="m-0 text-xs font-medium">{chosen ? "片段 " + (clips.indexOf(chosen) + 1) : "片段检查器"}</h3>
                            <Button
                                type="text"
                                size="small"
                                icon={<Plus size={12} />}
                                disabled={busy || !current || !s.analysis?.sources.length}
                                onClick={() => {
                                    const a = s.analysis!.sources[0],
                                        next = { id: nanoid(), sourceId: a.id, start: 0, end: a.duration, enabled: true, label: a.title };
                                    editClips([...clips, next]);
                                    choose(next.id);
                                }}
                            >
                                添加片段
                            </Button>
                        </div>
                        <div className="space-y-2" data-edit-clips>
                            {clips
                                .filter((c) => c.id === chosen?.id)
                                .map((c) => {
                                    const index = clips.indexOf(c);
                                    return (
                                        <div key={c.id} className="space-y-1 border-t pt-2" data-edit-clip={c.id} style={{ borderColor: ctx.theme.toolbar.border }}>
                                            <div className="flex items-center gap-1">
                                                <Checkbox aria-label={`保留片段${index + 1}`} checked={c.enabled} disabled={busy} onChange={(e) => changeClip(c.id, { enabled: e.target.checked })} />
                                                <Button type="text" size="small" className="min-w-0 flex-1 !justify-start truncate" onClick={() => choose(c.id)}>
                                                    {index + 1}. {s.analysis!.sources.find((a) => a.id === c.sourceId)?.title}
                                                </Button>
                                                {[-1, 1].map((offset) => (
                                                    <Button
                                                        key={offset}
                                                        type="text"
                                                        size="small"
                                                        disabled={busy || index + offset < 0 || index + offset >= clips.length}
                                                        aria-label={`片段${index + 1}${offset < 0 ? "上移" : "下移"}`}
                                                        icon={offset < 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                                        onClick={() => {
                                                            const next = [...clips];
                                                            [next[index], next[index + offset]] = [next[index + offset], next[index]];
                                                            editClips(next);
                                                        }}
                                                    />
                                                ))}
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    aria-label={`复制片段${index + 1}`}
                                                    disabled={busy}
                                                    icon={<Copy size={12} />}
                                                    onClick={() => {
                                                        const next = { ...c, id: nanoid() };
                                                        editClips([...clips.slice(0, index + 1), next, ...clips.slice(index + 1)]);
                                                        choose(next.id);
                                                    }}
                                                />
                                                <Button type="text" size="small" aria-label={`删除片段${index + 1}`} disabled={busy} icon={<X size={12} />} onClick={() => editClips(clips.filter((item) => item.id !== c.id))} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                {(["start", "end"] as const).map((key) => (
                                                    <label key={key} className="min-w-0 space-y-1">
                                                        <span className="block opacity-60">{key === "start" ? "入点（秒）" : "出点（秒）"}</span>
                                                        <InputNumber
                                                            className="!w-full"
                                                            size="small"
                                                            aria-label={`片段${index + 1}${key === "start" ? "开始" : "结束"}秒`}
                                                            value={c[key]}
                                                            min={0}
                                                            step={0.1}
                                                            disabled={busy}
                                                            onChange={(value) => changeClip(c.id, { [key]: value ?? 0 })}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                            <Select
                                                size="small"
                                                className="w-full"
                                                aria-label={`片段${index + 1}素材`}
                                                disabled={busy}
                                                value={c.sourceId}
                                                options={s.analysis!.sources.map((a) => ({ value: a.id, label: a.title }))}
                                                onChange={(sourceId) => {
                                                    const source = s.analysis!.sources.find((a) => a.id === sourceId)!;
                                                    changeClip(c.id, { sourceId, start: 0, end: source.duration, label: source.title });
                                                }}
                                            />
                                            <Input.TextArea aria-label={`片段${index + 1}说明`} autoSize value={c.label} disabled={busy} onChange={(e) => changeClip(c.id, { label: e.target.value })} />
                                        </div>
                                    );
                                })}
                        </div>
                        {!chosen && <p className="m-0 text-xs opacity-60">选择时间线片段，精确调整时间、素材和保留状态。</p>}
                        <details className="space-y-2 text-xs">
                            <summary className="cursor-pointer py-1">分析与成片设置</summary>
                            <div className="space-y-2 pt-1">
                                {number("silenceDb", "静音阈值（dB）", { max: 0, step: 1 })}
                                {number("silenceSeconds", "最短静音（秒）", { min: 0.001, step: 0.1 })}
                                {number("padding", "语句留白（秒）", { min: 0, step: 0.05 })}
                                {number("sceneThreshold", "切镜阈值", { min: 0, max: 1, step: 0.05 })}
                                {number("imageSeconds", "图片展示（秒）", { min: 0.001, step: 1 })}
                                {number("transition", "叠化转场（秒）", { min: 0, step: 0.1 })}
                                {number("audioFade", "切口声音淡化（秒）", { min: 0, step: 0.01 })}
                                {number("originalVolume", "原声音量（倍）", { min: 0, step: 0.1 })}
                                {number("musicVolume", "旁白／配乐音量（倍）", { min: 0, step: 0.05 })}
                                <label className="flex items-center justify-between gap-2">
                                    画面风格
                                    <Select
                                        size="small"
                                        aria-label="剪辑画面风格"
                                        disabled={busy}
                                        value={s.color || "original"}
                                        options={[
                                            { value: "original", label: "保留原色" },
                                            { value: "warm", label: "暖色" },
                                            { value: "vivid", label: "鲜明" },
                                        ]}
                                        onChange={(color) => patch({ color })}
                                    />
                                </label>
                                <Input size="small" aria-label="成片标题" disabled={busy} value={s.title} placeholder="可选：成片顶部标题" onChange={(e) => patch({ title: e.target.value })} />
                                <Checkbox disabled={busy} checked={s.burnSubtitles} onChange={(e) => patch({ burnSubtitles: e.target.checked })}>
                                    烧录已识别的字幕
                                </Checkbox>
                                <p className="m-0 text-[11px] leading-5" style={{ color: ctx.theme.node.muted }}>
                                    本机分析与渲染无需额外下载运行环境。画面尺寸保持一致，原始视频帧率与全部音轨保留；图片成片使用 30 fps。尺寸或视频帧率不一致会提示先统一素材。
                                </p>
                            </div>
                        </details>
                    </aside>
                </div>
                {s.analysis && current && (
                    <SmartEditTimeline
                        clips={clips}
                        analysis={s.analysis}
                        transition={s.transition ?? 0}
                        selected={chosen?.id}
                        cursor={cursor}
                        music={sources.filter((n) => n.type === "audio").map((n) => n.title)}
                        subtitles={Boolean(s.burnSubtitles)}
                        disabled={busy}
                        onSelect={choose}
                        onSeek={seekSequence}
                        onEdit={editClips}
                    />
                )}
                <div className="max-h-16 shrink-0 overflow-auto px-4">
                    {" "}
                    {(sourceError || planError || ctx.node.metadata?.errorDetails) && (
                        <p role="alert" className="m-0 text-xs leading-5">
                            {sourceError || planError || ctx.node.metadata?.errorDetails}
                        </p>
                    )}
                </div>
                <footer className="shrink-0 space-y-2 border-t px-4 py-2" style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border }}>
                    {!busy && clips.length === 0 && history.past.length > 0 && (
                        <Button type="text" size="small" icon={<Undo2 size={13} />} onClick={undo}>
                            撤销片段编辑
                        </Button>
                    )}
                    {busy ? (
                        <>
                            <div className="flex items-center justify-between gap-2 text-xs" role="status">
                                <span className="flex items-center gap-2">
                                    <Scissors size={13} className="motion-safe:animate-pulse" />
                                    {ctx.node.metadata?.loadingMessage}
                                </span>
                                <Button type="text" size="small" onClick={() => active.current?.abort()}>
                                    停止
                                </Button>
                            </div>
                            {progress !== undefined && <Progress percent={Math.round(progress)} size="small" strokeColor={ctx.theme.node.text} trailColor={ctx.theme.toolbar.border} />}
                        </>
                    ) : (
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex flex-wrap gap-1">
                                <Button type="text" size="small" icon={<Download size={13} />} disabled={disabled || !current || !enabled.length} onClick={saveManifest}>
                                    剪辑清单
                                </Button>
                                <Button
                                    type="text"
                                    size="small"
                                    disabled={disabled || !current || !enabled.length}
                                    onClick={() => {
                                        try {
                                            const srt = editSubtitles(clips, s.analysis!, s.transition ?? 0);
                                            if (!srt) throw Error("没有对应字幕，请先识别");
                                            saveAs(new Blob([srt], { type: "text/plain;charset=utf-8" }), "OneYes-剪辑字幕.srt");
                                        } catch (error) {
                                            ctx.updateMetadata({ errorDetails: (error as Error).message });
                                        }
                                    }}
                                >
                                    导出 SRT
                                </Button>
                            </div>
                            <div className="flex gap-2">
                                <Button type="text" size="small" disabled={disabled || !current || !enabled.length || Boolean(planError)} onClick={preview}>
                                    预览成片
                                </Button>
                                <Button type="text" size="small" icon={<Play size={14} />} disabled={disabled || !current || !enabled.length || Boolean(planError)} onClick={render}>
                                    输出成片
                                </Button>
                            </div>
                        </div>
                    )}
                </footer>
            </section>
        </Modal>
    );
}

export const smartEditPlugin: CanvasPlugin = {
    id: "smart-edit",
    name: "智能剪辑",
    version: "1.2.0",
    description: "AI 草稿审阅、时间线精剪、字幕编辑与原尺寸成片",
    nodes: [
        {
            type: "smart-edit:editor",
            title: "智能剪辑",
            description: "视频／图片／脚本 → 可编辑片段、字幕与配乐成片",
            icon: <Scissors size={18} />,
            defaultSize: { width: 320, height: 180 },
            defaultMetadata: { smartEdit: { mode: "ai" }, status: "idle" },
            autoOpenPanel: true,
            renderOwnStatus: true,
            Content,
            Panel: SmartEditPanel,
            toolbar: (ctx) => [{ id: "smart-edit-settings", title: "打开智能剪辑", label: "剪辑", icon: <Scissors size={14} />, onClick: ctx.openPanel }],
        },
    ],
};
