import { Button, Checkbox, InputNumber, Progress, Select, Slider, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Clapperboard, Layers, LoaderCircle, Play, ScanLine, Scissors, Settings2, Sparkles, X } from "lucide-react";
import { creatorSources, creatorTool, creatorTools } from "@/lib/canvas/creator-tools";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { CreatorLayer, CreatorSettings, CreatorTool } from "@/types/creator-tools";
import { SourceSummary } from "./source-summary";

const icons = { analyze: Clapperboard, concat: Scissors, cutout: ScanLine, compose: Layers, superResolution: Sparkles, board: Layers, color: Sparkles, mix: Scissors };
function selected(ctx: CanvasNodeContext) {
    try { return { sources: creatorSources(ctx.node, ctx.getNodes(), ctx.getConnections()), error: "" }; } catch (error) { return { sources: [], error: (error as Error).message }; }
}
const start = (ctx: CanvasNodeContext) => { void ctx.processing?.start(ctx.node.id).catch(() => {}); };

function CreatorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const tool = creatorTool(ctx.node.type)!;
    const info = creatorTools[tool], Icon = icons[tool];
    const state = ctx.processing?.state(ctx.node.id), { sources, error } = selected(ctx);
    const settings = ctx.node.metadata?.creatorSettings;
    return <div className="flex h-full flex-col justify-between gap-3 p-4" style={{ color: ctx.theme.node.text }} data-creator-tool={tool}>
        <div className="flex items-start gap-3">
            {state ? <LoaderCircle size={22} className="shrink-0 animate-spin motion-reduce:animate-none" /> : <Icon size={22} className="shrink-0" />}
            <div className="min-w-0"><div className="text-sm font-medium">{info.title}{tool === "superResolution" ? " · 3×" : ""}</div><p className="mt-1 text-xs leading-relaxed" style={{ color: ctx.theme.node.muted }}>{info.description}</p></div>
        </div>
        {state ? <div role="status" aria-live="polite"><p className="text-xs">{state.stage}</p>{state.progress !== undefined && <Progress percent={Math.round(state.progress)} size="small" showInfo={false} />}</div>
            : ctx.node.metadata?.errorDetails ? <p className="max-h-20 overflow-auto text-xs leading-relaxed" role="alert">{ctx.node.metadata.errorDetails}</p>
            : <p className="text-xs" style={{ color: ctx.theme.node.muted }}>{error || `已选 ${sources.length} 份素材`}{settings?.resultCount ? ` · 已生成 ${settings.resultCount} 个结果` : ""}</p>}
        <div className="flex items-center justify-between gap-2" onPointerDown={event => event.stopPropagation()}>
            <Button type="text" size="small" icon={<Settings2 size={14} />} onClick={() => ctx.openPanel()}>设置</Button>
            {state ? <Button type="text" size="small" icon={<X size={14} />} onClick={() => ctx.processing?.cancel(ctx.node.id)}>取消</Button>
                : <Button type="text" size="small" icon={<Play size={14} />} disabled={!ctx.processing || !sources.length} onClick={() => start(ctx)}>{ctx.node.metadata?.status === "error" ? "重新运行" : info.action}</Button>}
        </div>
    </div>;
}

function CreatorPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const tool = creatorTool(ctx.node.type)!, info = creatorTools[tool];
    const settings = ctx.node.metadata?.creatorSettings || {};
    const { sources, error } = selected(ctx), ids = settings.sourceIds ?? ctx.getConnections().filter(link => link.toNodeId === ctx.node.id).map(link => link.fromNodeId);
    const busy = Boolean(ctx.processing?.state(ctx.node.id));
    const patch = (value: Partial<CreatorSettings>) => ctx.updateMetadata({ creatorSettings: { ...settings, ...value, resultCount: undefined } });
    const patchLayer = (id: string, value: Partial<CreatorLayer>) => patch({ layers: { ...settings.layers, [id]: { ...settings.layers?.[id], ...value } } });
    const options = ctx.getNodes().filter(node => node.id !== ctx.node.id && (node.type === info.input || tool==='mix'&&node.type==='audio')).map(node => ({ value: node.id, label: `${node.type==='audio'?'音频 · ':''}${node.title}` }));
    const move = (index: number, offset: number) => { const next = [...ids]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; patch({ sourceIds: next }); };
    const multi = tool === "compose" || tool === "concat" || tool==='board' || tool==='mix';
    return <section className="space-y-4 rounded-2xl border p-4" style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.text }} onPointerDown={event => event.stopPropagation()} data-creator-panel={tool}>
        <header className="flex items-center justify-between"><div className="text-sm font-medium">{info.title}</div><Button type="text" size="small" icon={<X size={16} />} aria-label="关闭设置" onClick={onClose} /></header>
        <div className="space-y-2"><div className="flex items-center justify-between text-xs"><span>{multi ? "选择素材 · 可调整顺序" : "选择素材"}</span><Button type="text" size="small" disabled={busy} onClick={() => patch({ sourceIds: undefined })}>使用上游连线</Button></div>
            {multi ? <Select mode="multiple" className="w-full" placeholder="选择画布中的素材" options={options} value={ids} disabled={busy} onChange={(sourceIds: string[]) => patch({ sourceIds })} optionFilterProp="label" />
                : <Select className="w-full" placeholder="选择画布中的素材" options={options} value={ids[0]} disabled={busy} showSearch={{ optionFilterProp: "label" }} onChange={(id: string) => patch({ sourceIds: [id] })} />}
        </div>
        {error && <p role="alert" className="text-xs leading-5">{error}</p>}
        {!multi && sources[0] && <SourceSummary node={sources[0]} />}
        {tool === "analyze" && <div className="space-y-3"><label className="block text-xs">切镜阈值 · 越低越敏感<Slider min={0} max={1} step={0.01} value={settings.threshold ?? 0.3} disabled={busy} onChange={(threshold: number) => patch({ threshold })} /></label><div className="flex flex-wrap gap-4 text-xs"><Checkbox checked={settings.clips} disabled={busy} onChange={event => patch({ clips: event.target.checked })}>导出每个镜头视频</Checkbox><Checkbox checked={settings.audio} disabled={busy} onChange={event => patch({ audio: event.target.checked })}>提取原音轨</Checkbox></div><p className="text-xs leading-relaxed" style={{ color: ctx.theme.node.muted }}>自动生成镜头时间表和原尺寸关键帧。这是画面切镜检测，不会提交 AI 生成请求。</p></div>}
        {tool==='board'&&<div className="flex flex-wrap items-center gap-3 text-xs"><label>列数 <InputNumber aria-label="分镜板列数" size="small" min={1} precision={0} value={settings.columns??Math.ceil(Math.sqrt(sources.length||1))} disabled={busy} onChange={v=>patch({columns:v??undefined})}/></label><label>间距 <InputNumber aria-label="分镜板间距" size="small" min={0} precision={0} value={settings.gap??24} disabled={busy} onChange={v=>patch({gap:v??undefined})}/></label><Checkbox checked={settings.labels!==false} disabled={busy} onChange={e=>patch({labels:e.target.checked})}>编号与标题</Checkbox><p>按原始像素排列，不缩小素材。输出尺寸随图片与列数计算。</p></div>}
        {tool==='color'&&<div className="space-y-3 text-xs">{([['exposure','曝光（档）',0],['contrast','对比度',1],['temperature','色温偏移',0]] as const).map(([key,label,value])=><label key={key} className="flex items-center justify-between">{label}<InputNumber aria-label={label} size="small" step={0.1} value={settings[key]??value} disabled={busy} onChange={v=>patch({[key]:v??value})}/></label>)}<Select allowClear className="w-full" aria-label="色彩参考图" placeholder="可选：匹配参考图色调" options={ctx.getNodes().filter(n=>n.type==='image'&&!ids.includes(n.id)).map(n=>({value:n.id,label:n.title}))} value={settings.matchId} disabled={busy} onChange={matchId=>patch({matchId})}/><p>按透明度加权的 RGB 均值匹配色调，保留原尺寸与透明度。</p></div>}
        {tool==='mix'&&<div className="space-y-3 text-xs"><p>第一个素材为视频，后续为旁白或配乐。音频从开头播放，到视频结束为止；短音频结束后保持静音。</p>{([['volume','配乐／旁白音量',1],['originalVolume','视频原音量',1],['fadeIn','配乐淡入（秒）',0],['fadeOut','配乐淡出（秒）',0]] as const).map(([key,label,value])=><label key={key} className="flex items-center justify-between">{label}<InputNumber aria-label={label} size="small" min={0} step={0.1} value={settings[key]??value} disabled={busy} onChange={v=>patch({[key]:v??value})}/></label>)}</div>}
        {multi && <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
            {sources.map((source, index) => <div key={source.id} className="space-y-2 border-t pt-3" style={{ borderColor: ctx.theme.toolbar.border }}>
                <div className="flex items-center gap-2"><span className="text-xs opacity-60">{index + 1}</span><SourceSummary node={source} /><Tooltip title="上移"><Button size="small" type="text" icon={<ArrowUp size={14} />} aria-label={`上移 ${source.title}`} disabled={busy || index === 0} onClick={() => move(index, -1)} /></Tooltip><Tooltip title="下移"><Button size="small" type="text" icon={<ArrowDown size={14} />} aria-label={`下移 ${source.title}`} disabled={busy || index === sources.length - 1} onClick={() => move(index, 1)} /></Tooltip><Button type="text" size="small" aria-label={`移除 ${source.title}`} disabled={busy} icon={<X size={12} />} onClick={() => patch({ sourceIds: ids.filter(id => id !== source.id) })} /></div>
                {tool === "concat" ? <div className="flex flex-wrap items-center gap-2 text-xs"><span>截取（秒）</span><InputNumber size="small" min={0} step={0.1} placeholder="从头" aria-label={`${source.title} 起点`} value={settings.trims?.[source.id]?.start} disabled={busy} onChange={value => patch({ trims: { ...settings.trims, [source.id]: { ...settings.trims?.[source.id], start: value ?? undefined } } })} /><span>至</span><InputNumber size="small" min={0} step={0.1} placeholder="结尾" aria-label={`${source.title} 终点`} value={settings.trims?.[source.id]?.end} disabled={busy} onChange={value => patch({ trims: { ...settings.trims, [source.id]: { ...settings.trims?.[source.id], end: value ?? undefined } } })} /></div>
                    : tool==='compose' ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {([['x', 'X 位置', 0], ['y', 'Y 位置', 0], ['scale', '缩放倍率', 1], ['opacity', '透明度', 1]] as const).map(([key, label, fallback]) => <label key={key} className="space-y-1 text-[11px]" style={{ color: ctx.theme.node.muted }}>{label}<InputNumber className="!w-full" size="small" aria-label={`${source.title} ${label}`} step={key === "opacity" || key === "scale" ? 0.1 : 1} min={key === "opacity" || key === "scale" ? 0 : undefined} max={key === "opacity" ? 1 : undefined} value={settings.layers?.[source.id]?.[key] ?? fallback} disabled={busy} onChange={value => patchLayer(source.id, { [key]: value ?? fallback })} /></label>)}
                        <label className="space-y-1 text-[11px]" style={{ color: ctx.theme.node.muted }}>混合<Select className="w-full" size="small" aria-label={`${source.title} 混合模式`} value={settings.layers?.[source.id]?.blend ?? "source-over"} disabled={busy} onChange={blend => patchLayer(source.id, { blend })} options={[{ value: "source-over", label: "正常" }, { value: "multiply", label: "正片叠底" }, { value: "screen", label: "滤色" }]} /></label>
                    </div> : null}
            </div>)}
        </div>}
        <p className="text-xs leading-relaxed" style={{ color: ctx.theme.node.muted }}>{tool === "compose" ? "从上到下依次叠放，第一张图决定输出画布的原始尺寸；超出画布的部分不输出。源图不变。"
            : tool === "concat" ? "保持原始尺寸；素材需具有相同尺寸、帧率和音轨结构。结果保存为新视频。"
            : tool === "cutout" || tool === "superResolution" ? `${info.description}。模型已内置，离线运行，图片不上传。` : "全部在本机处理，保留原始素材。"}</p>
        <footer className="flex items-center justify-between border-t pt-3" style={{ borderColor: ctx.theme.toolbar.border }}><span className="text-xs" style={{ color: ctx.theme.node.muted }}>结果作为新节点保存</span>{busy ? <Button type="text" onClick={() => ctx.processing?.cancel(ctx.node.id)}>取消处理</Button> : <Button type="text" icon={<Play size={14} />} disabled={!ctx.processing || !sources.length} onClick={() => start(ctx)}>{info.action}</Button>}</footer>
    </section>;
}

export const creatorToolsPlugin: CanvasPlugin = {
    id: "creator-tools", name: "本地创作工具", version: "1.0.0", description: "视频拉片与拼接、智能抠图、图层合成和 AI 超分；本地处理，保留源素材。",
    nodes: (Object.keys(creatorTools) as CreatorTool[]).map(tool => {
        const Icon = icons[tool];
        return { type: `creator-tools:${tool}`, title: creatorTools[tool].title, description: creatorTools[tool].description, icon: <Icon size={18} />, defaultSize: { width: 320, height: 190 }, defaultMetadata: { creatorSettings: {}, status: "idle" }, autoOpenPanel: true, renderOwnStatus: true, Content: CreatorContent, Panel: CreatorPanel,
            toolbar: ctx => [{ id: "creator-settings", title: "调整处理参数", label: "设置", icon: <Settings2 size={14} />, onClick: ctx.openPanel }] };
    }),
};
