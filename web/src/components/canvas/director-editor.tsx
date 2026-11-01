import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Slider, Tooltip } from "antd";
import { Box, Camera, Circle, Copy, Cylinder, Focus, Grid2X2, Move3D, Rotate3D, Scaling, Sun, Trash2, UserRound } from "lucide-react";
import { createDirectorRuntime, type DirectorRuntime } from "./director-runtime";
import { directorNames, directorObject, directorPoses, directorPreset } from "@/lib/canvas/director-scene";
import type { DirectorKind, DirectorObject, DirectorScene, DirectorVector } from "@/types/director";
import type { CanvasTheme } from "@/lib/canvas-theme";

const icons = { person: UserRound, box: Box, sphere: Circle, cylinder: Cylinder };
type Props = { scene: DirectorScene; theme: CanvasTheme; onChange: (scene: DirectorScene) => void; onCapture: (blob: Blob, scene: DirectorScene) => Promise<void> };
export default function DirectorEditor({ scene, theme, onChange, onCapture }: Props) {
    const container = useRef<HTMLDivElement>(null), runtime = useRef<DirectorRuntime | null>(null);
    const current = useRef({ scene, onChange }); current.current = { scene, onChange };
    const [selected, setSelected] = useState<string | null>(scene.objects[0]?.id || null);
    const [mode, setMode] = useState<"camera" | "scene">("camera"), [transform, setTransform] = useState<"translate" | "rotate" | "scale">("translate");
    const [ready, setReady] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
    const saving = useRef(false), mounted = useRef(true);
    const update = (patch: Partial<DirectorScene>) => { setSaved(false); onChange({ ...scene, ...patch }); };
    const patchObject = (id: string, patch: Partial<DirectorObject>) => { const latest = current.current; latest.onChange({ ...latest.scene, objects: latest.scene.objects.map(item => item.id === id ? { ...item, ...patch } : item) }); setSaved(false); };
    useEffect(() => {
        mounted.current = true;
        try {
            runtime.current = createDirectorRuntime(container.current!, scene, {
                camera: camera => { const latest = current.current; latest.onChange({ ...latest.scene, camera }); setSaved(false); },
                object: patchObject, select: setSelected, error: message => { setError(message); setReady(false); },
            });
            setReady(true);
        } catch { setError("无法启动三维视窗。请开启系统或浏览器的硬件加速，并更新显卡驱动后重试；场景设置保持不变"); }
        return () => { mounted.current = false; runtime.current?.dispose(); runtime.current = null; };
    }, []);
    useEffect(() => { runtime.current?.update(scene, selected); }, [scene, selected]);
    const object = scene.objects.find(item => item.id === selected);
    const capture = async () => {
        if (!runtime.current || saving.current) return;
        saving.current = true; setBusy(true); setError(""); setSaved(false);
        try { const snapshot = structuredClone(scene); const blob = await runtime.current.capture(); if (mounted.current) { await onCapture(blob, snapshot); if (mounted.current) setSaved(true); } }
        catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "保存取景图失败，请重试"); }
        finally { saving.current = false; if (mounted.current) setBusy(false); }
    };
    const add = (kind: DirectorKind) => { const item = directorObject(kind); item.name += ` ${scene.objects.filter(item => item.kind === kind).length + 1}`; item.position[0] = scene.objects.length * 0.6; update({ objects: [...scene.objects, item] }); setSelected(item.id); };
    const vector = (label: string, value: DirectorVector, change: (value: DirectorVector) => void, positive = false) => <div className="space-y-1.5"><div className="text-xs" style={{ color: theme.node.muted }}>{label}</div><div className="grid grid-cols-3 gap-1.5">{value.map((number, i) => <InputNumber key={i} className="!w-full" size="small" aria-label={`${label} ${['X','Y','Z'][i]}`} prefix={<span style={{ color: theme.node.faint }}>{['X','Y','Z'][i]}</span>} step={0.1} min={positive ? 0.01 : undefined} value={number} disabled={busy} onChange={v => { if (v !== null && Number.isFinite(v)) { const next: DirectorVector = [...value]; next[i] = v; change(next); } }} />)}</div></div>;
    return <div className="flex flex-col gap-3" style={{ color: theme.node.text }} data-director-editor onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><Segmented aria-label="视窗模式" value={mode} options={[{ value: "camera", label: "镜头取景", icon: <Camera size={14} /> }, { value: "scene", label: "自由布景", icon: <Box size={14} /> }]} disabled={busy} onChange={value => { setMode(value as typeof mode); runtime.current?.mode(value as typeof mode); }} />
                {mode === "scene" && <Button type="text" size="small" disabled={!ready || busy} icon={<Focus size={14} />} onClick={() => { runtime.current?.adoptView(); setMode("camera"); runtime.current?.mode("camera"); }}>将此视角设为镜头</Button>}</div>
            <div className="flex items-center gap-1">{([{ value: "translate", label: "移动", Icon: Move3D }, { value: "rotate", label: "旋转", Icon: Rotate3D }, { value: "scale", label: "缩放", Icon: Scaling }] as const).map(({ value, label, Icon }) => <Tooltip key={value} title={label}><Button type="text" size="small" disabled={busy} aria-label={label} aria-pressed={transform === value} style={{ background: transform === value ? theme.toolbar.activeBg : undefined }} icon={<Icon size={16} />} onClick={() => { setTransform(value); runtime.current?.transform(value); }} /></Tooltip>)}<Checkbox className="!ml-2" checked={scene.grid} disabled={busy} onChange={event => update({ grid: event.target.checked })}><span className="text-xs inline-flex items-center gap-1"><Grid2X2 size={13} />网格</span></Checkbox></div>
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_264px]">
            <div className="relative min-h-[300px] overflow-hidden rounded-xl border md:h-[min(64vh,660px)]" style={{ borderColor: theme.toolbar.border, background: scene.background }}>
                <div ref={container} className="absolute inset-0" data-director-viewport />
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md px-2 py-1 text-xs" style={{ background: theme.toolbar.panel, color: theme.node.text }}><Camera size={13} />{scene.camera.lens} mm<span style={{ color: theme.node.muted }}>{scene.width} × {scene.height}</span></div>
                {!ready && !error && <div className="absolute inset-0 grid place-items-center" role="status">正在准备三维视窗…</div>}
                <div className="pointer-events-none absolute bottom-3 left-3 rounded-md px-2 py-1 text-xs" style={{ background: theme.toolbar.panel, color: theme.node.muted }}>左键环绕 · 右键平移 · 滚轮推进 · 点击物体调整</div>
            </div>
            <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 md:max-h-[min(64vh,660px)]" aria-label="导演台设置">
                <section className="space-y-2"><div className="flex items-center justify-between text-xs font-medium"><span>场景物体</span><Select size="small" aria-label="添加物体" placeholder="添加" value={null} disabled={busy} onChange={add} options={(Object.keys(directorNames) as DirectorKind[]).map(value => ({ value, label: directorNames[value] }))} /></div>
                    <div className="max-h-32 space-y-0.5 overflow-auto">{scene.objects.map(item => { const Icon = icons[item.kind]; return <button key={item.id} type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10" aria-pressed={item.id === selected} disabled={busy} style={{ background: item.id === selected ? theme.toolbar.activeBg : undefined }} onClick={() => setSelected(item.id)}><Icon size={14} /><span className="truncate">{item.name}</span></button>; })}{!scene.objects.length && <p className="py-2 text-xs" style={{ color: theme.node.muted }}>添加人物或道具，开始布景</p>}</div>
                </section>
                {object && <section className="space-y-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><div className="flex items-center gap-1"><Input size="small" aria-label="物体名称" value={object.name} disabled={busy} onChange={event => patchObject(object.id, { name: event.target.value })} /><Tooltip title="复制物体"><Button type="text" size="small" aria-label="复制物体" icon={<Copy size={14} />} disabled={busy} onClick={() => { const next = structuredClone(object); next.id = directorObject(object.kind).id; next.name += " 副本"; next.position[0] += 0.5; update({ objects: [...scene.objects, next] }); setSelected(next.id); }} /></Tooltip><Tooltip title="移除物体"><Button type="text" size="small" aria-label="移除物体" icon={<Trash2 size={14} />} disabled={busy} onClick={() => { update({ objects: scene.objects.filter(item => item.id !== object.id) }); setSelected(null); }} /></Tooltip></div>
                    <div className="flex items-center justify-between gap-2">{object.kind === "person" && <Select className="flex-1" aria-label="人物姿态" size="small" value={object.pose} options={directorPoses} disabled={busy} onChange={pose => patchObject(object.id, { pose })} />}<label className="inline-flex items-center gap-2 text-xs">颜色<input type="color" aria-label="物体颜色" className="h-6 w-8 cursor-pointer border-0 bg-transparent" value={object.color} disabled={busy} onChange={event => patchObject(object.id, { color: event.target.value })} /></label></div>
                    {vector("位置", object.position, position => patchObject(object.id, { position }))}{vector("旋转（度）", object.rotation, rotation => patchObject(object.id, { rotation }))}{vector("缩放", object.scale, scale => patchObject(object.id, { scale }), true)}
                </section>}
                <section className="space-y-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><div className="flex items-center gap-2 text-xs font-medium"><Camera size={14} />镜头</div>
                    <div className="flex flex-wrap gap-1">{[24,35,50,85].map(lens => <Button key={lens} type="text" size="small" aria-pressed={scene.camera.lens === lens} disabled={busy} style={{ background: scene.camera.lens === lens ? theme.toolbar.activeBg : undefined }} onClick={() => update({ camera: { ...scene.camera, lens } })}>{lens} mm</Button>)}</div>
                    <div className="flex items-center justify-between text-xs"><span>焦距（mm）</span><InputNumber size="small" aria-label="镜头焦距" min={1} value={scene.camera.lens} disabled={busy} onChange={lens => { if (lens) update({ camera: { ...scene.camera, lens } }); }} /></div>
                    {vector("相机位置", scene.camera.position, position => { if (position.some((v,i) => v !== scene.camera.target[i])) update({ camera: { ...scene.camera, position } }); })}{vector("取景目标", scene.camera.target, target => { if (target.some((v,i) => v !== scene.camera.position[i])) update({ camera: { ...scene.camera, target } }); })}
                    <Button type="text" size="small" disabled={busy} onClick={() => update({ camera: directorPreset().camera })}>恢复默认机位</Button>
                </section>
                <section className="space-y-2 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><div className="flex items-center gap-2 text-xs font-medium"><Sun size={14} />灯光与环境</div>
                    <label className="block text-xs">光源方向<Slider aria-label="光源方向" min={-180} max={180} value={scene.light.azimuth} disabled={busy} onChange={azimuth => update({ light: { ...scene.light, azimuth } })} /></label>
                    <label className="block text-xs">光源高度<Slider aria-label="光源高度" min={0} max={90} value={scene.light.elevation} disabled={busy} onChange={elevation => update({ light: { ...scene.light, elevation } })} /></label>
                    <div className="flex items-center justify-between text-xs"><span>光照强度</span><InputNumber size="small" aria-label="光照强度" min={0} step={0.1} value={scene.light.intensity} disabled={busy} onChange={intensity => { if (intensity !== null) update({ light: { ...scene.light, intensity } }); }} /></div>
                    <div className="flex items-center justify-between">{([['background','背景'],['floor','地面']] as const).map(([key,label]) => <label key={key} className="inline-flex items-center gap-2 text-xs">{label}<input type="color" aria-label={`${label}颜色`} className="h-6 w-8 cursor-pointer border-0 bg-transparent" value={scene[key]} disabled={busy} onChange={event => update({ [key]: event.target.value })} /></label>)}</div>
                </section>
            </aside>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs">画幅<Select className="block w-24" size="small" aria-label="输出画幅" value={`${scene.width}:${scene.height}`} disabled={busy} onChange={value => { const [width,height] = value.split(':').map(Number); update({ width,height }); }} options={[{ value: '1536:864', label: '16:9' }, { value: '864:1536', label: '9:16' }, { value: '1024:1024', label: '1:1' }, { value: '1536:1024', label: '3:2' }, ...(!['1536:864','864:1536','1024:1024','1536:1024'].includes(`${scene.width}:${scene.height}`) ? [{ value: `${scene.width}:${scene.height}`, label: '自定义' }] : [])]} /></label><label className="space-y-1 text-xs">宽（px）<InputNumber className="!block !w-24" size="small" aria-label="输出宽度" min={1} precision={0} value={scene.width} disabled={busy} onChange={width => { if (width) update({ width }); }} /></label><label className="space-y-1 text-xs">高（px）<InputNumber className="!block !w-24" size="small" aria-label="输出高度" min={1} precision={0} value={scene.height} disabled={busy} onChange={height => { if (height) update({ height }); }} /></label></div>
            <div className="flex items-center gap-3"><span className="text-xs" role="status" style={{ color: theme.node.muted }}>{busy ? "正在渲染并保存…" : saved ? "已保存到画布，可连接生图节点" : "场景自动保存 · 本机渲染"}</span><Button type="text" icon={<Camera size={16} />} loading={busy} disabled={!ready} onClick={() => void capture()}>输出取景图</Button></div>
        </div>
        {error && <p className="text-xs leading-relaxed" role="alert">{error}</p>}
    </div>;
}
