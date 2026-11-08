import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Slider, Tooltip } from "antd";
import { Box, Camera, Circle, Copy, Cylinder, Download, Eye, EyeOff, Focus, Grid2X2, LockKeyhole, LockOpen, Move3D, Redo2, Rotate3D, Scaling, Sun, Trash2, Undo2, Upload, UserRound } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { DirectorTimeline } from "./director-timeline";
import { DirectorAssistant } from "./director-assistant";
import { useDirectorPlayback } from "./use-director-playback";
import { exportDirectorBundle } from "@/lib/canvas/director-export";
import { directorMotionPrompt, recordDirectorFrame, shotDuration, shotListCsv, shotScene } from "@/lib/canvas/director-sequence";
import { createDirectorRuntime, type DirectorRuntime } from "./director-runtime";
import { directorHistory, directorJoints, directorLighting, directorNames, directorObject, directorOutputs, directorPoses, directorPreset, directorSceneFile, parseDirectorSceneFile } from "@/lib/canvas/director-scene";
import type { DirectorJoint, DirectorKind, DirectorObject, DirectorOutput, DirectorScene, DirectorVector } from "@/types/director";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const icons = { person: UserRound, box: Box, sphere: Circle, cylinder: Cylinder, cone: Cylinder, torus: Circle, plane: Box };
type Props = { scene: DirectorScene; ctx: CanvasNodeContext; onChange: (scene: DirectorScene) => void; onCapture: (blob: Blob, scene: DirectorScene,label?:string,workflow?:boolean|"video",note?:string,seconds?:number) => Promise<void> };
export default function DirectorEditor({ scene, ctx, onChange, onCapture }: Props) {
    const theme = ctx.theme;
    const container = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null), runtime = useRef<DirectorRuntime | null>(null);
    const current = useRef({ scene, onChange }); current.current = { scene, onChange };
    const [selected, setSelected] = useState<string | null>(scene.objects[0]?.id || null);
    const [mode, setMode] = useState<"camera" | "scene">("camera"), [transform, setTransform] = useState<"translate" | "rotate" | "scale">("translate");
    const [ready, setReady] = useState(false), [renderError, setRenderError] = useState(""), [error, setError] = useState(""), [working, setBusy] = useState(false), [saved, setSaved] = useState(false);
    const saving = useRef(false), mounted = useRef(true);
    const [history] = useState(() => directorHistory(scene));
    const [settings, setSettings] = useState<"object" | "camera" | "light">("object");
    const [shotId, setShotId] = useState<string | null>(scene.shots?.[0]?.id || null);
    const [output,setOutput]=useState<DirectorOutput>('color'), [joint, setJoint] = useState<DirectorJoint>("head");
    const [progress, setProgress] = useState("");
    const savedShot = scene.shots?.find(shot => shot.id === shotId);
    const [aiPreview,setAiPreview] = useState<DirectorScene|null>(null);
    const playback = useDirectorPlayback(aiPreview || scene);
    const busy = working || !!playback.preview || !!aiPreview;
    const display = playback.display;
    const [fps, setFps] = useState(24);
    const exportController = useRef<AbortController | null>(null);
    const previewing = !!playback.preview || !!aiPreview;
    useEffect(() => { if (aiPreview?.shots?.length) playback.play(); }, [aiPreview]);
    useEffect(() => { if (!scene.shots?.some(shot => shot.id === shotId)) setShotId(scene.shots?.[0]?.id || null); }, [scene.shots, shotId]);
    useEffect(() => { if (previewing) { setMode("camera"); runtime.current?.mode("camera"); } }, [previewing]);
    const commit = (next: DirectorScene, group?: string) => { if (!history.commit(next, group)) return; current.current.scene = next; current.current.onChange(next); setSaved(false); };
    const update = (patch: Partial<DirectorScene>, group?: string) => commit({ ...current.current.scene, ...patch }, group);
    const patchObject = (id: string, patch: Partial<DirectorObject>, group?: string) => { const latest = current.current.scene; if (latest.objects.find(item => item.id === id)?.locked && !Object.hasOwn(patch, "locked") && !Object.hasOwn(patch, "visible")) return; update({ objects: latest.objects.map(item => item.id === id ? { ...item, ...patch } : item) }, group); };
    const travel = (redo = false) => { const next = redo ? history.redo() : history.undo(); if (!next) return; current.current.scene = next; current.current.onChange(next); setSaved(false); setSelected(id => next.objects.some(item => item.id === id) ? id : next.objects[0]?.id || null); };
    useEffect(() => {
        mounted.current = true;
        try {
            runtime.current = createDirectorRuntime(container.current!, scene, {
                camera: camera => update({ camera }),
                object: patchObject, select: setSelected, error: message => { setRenderError(message); setReady(false); },
            });
            setReady(true);
        } catch { setRenderError("无法启动三维视窗。请开启系统或浏览器的硬件加速，并更新显卡驱动后重试；场景设置保持不变"); }
        return () => { mounted.current = false; exportController.current?.abort(); runtime.current?.dispose(); runtime.current = null; };
    }, []);
    useEffect(() => { runtime.current?.update(display, selected); runtime.current?.interactive(!busy); }, [display, selected, busy]);
    const object = scene.objects.find(item => item.id === selected);
    const editDisabled = busy || !!object?.locked;
    const duplicate = () => { if (!object || object.locked) return; const next = structuredClone(object); next.id = nanoid(); next.name += " 副本"; next.position[0] += 0.5; update({ objects: [...scene.objects, next] }); setSelected(next.id); };
    const remove = () => { if (!object || object.locked) return; update({ objects: scene.objects.filter(item => item.id !== object.id) }); setSelected(null); };
    const changeTransform = (value: typeof transform) => { setTransform(value); runtime.current?.transform(value); };
    const capture = async (all=false, workflow:boolean|"video"=false) => {
        if (!runtime.current || saving.current) return;
        saving.current = true; setBusy(true); setError(""); setSaved(false);
        try {
            const original=structuredClone(display),shots=all?scene.shots:undefined;
            if(all&&!shots?.length)throw Error('请先保存至少一个机位');
            let completed = 0;
            for(const shot of shots||[undefined]){
                if(!mounted.current)break;
                setProgress(`正在输出 ${completed + 1} / ${shots?.length || 1}`);
                const snapshot=shot?shotScene(original,shot):workflow === "video" && savedShot ? shotScene(original,savedShot) : original;
                const active = shot || (!all ? savedShot : undefined), channel = workflow === "video" ? "color" : output;
                const note = active ? [active.note, active.dialogue ? `台词：${active.dialogue}` : "", active.sound ? `声音：${active.sound}` : "", workflow === "video" ? directorMotionPrompt(original,active) : ""].filter(Boolean).join("\n") : undefined;
                runtime.current.update(snapshot,selected);const blob=await runtime.current.capture(channel,selected||undefined);
                if(mounted.current)await onCapture(blob,snapshot,`${shot?shot.name+' · ':''}${directorOutputs[channel]}`,workflow,note,active ? shotDuration(active) : undefined);
                completed++;
            }
            if(mounted.current){runtime.current.update(original,selected);setSaved(true);}
        }
        catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "保存取景图失败，请重试"); }
        finally { saving.current = false; if (mounted.current) {runtime.current?.update(current.current.scene,selected);setBusy(false);setProgress("");} }
    };
    const importScene = async (file?: File) => {
        if (!file || saving.current) return;
        saving.current = true; setBusy(true); setError("");
        try { const next = parseDirectorSceneFile(await file.text()); if (mounted.current) { commit(next); setSelected(next.objects[0]?.id || null); setShotId(null); setMode("camera"); runtime.current?.mode("camera"); } }
        catch (error) { if (mounted.current) setError(error instanceof SyntaxError ? "场景文件不是有效的 JSON，请重新导出后再导入；当前场景未被覆盖" : error instanceof Error ? error.message : "导入失败，当前场景未被覆盖"); }
        finally { saving.current = false; if (mounted.current) setBusy(false); }
    };
    const selectShot = (id: string) => {
        const latest = current.current.scene, shot = latest.shots?.find(shot => shot.id === id);
        if (!shot) return;
        const next = shotScene(latest, shot);
        playback.stop(true); setShotId(id); setMode("camera"); runtime.current?.mode("camera"); commit(next);
        setSelected(selected => next.objects.some(object => object.id === selected) ? selected : next.objects[0]?.id || null);
    };
    const record = (time: number) => {
        if (!savedShot) return;
        if (time > 0 && (scene.width !== savedShot.width || scene.height !== savedShot.height)) { setError("同一镜头的关键帧须使用相同画幅，请恢复机位画幅或先更新起始机位"); return; }
        update({ shots: scene.shots!.map(shot => shot.id === shotId ? recordDirectorFrame(shot,scene,time) : shot) });
    };
    const exportBundle = async (sequence: boolean) => {
        if (!runtime.current || saving.current) return;
        const source = structuredClone(scene), abort = new AbortController(); exportController.current = abort;
        saving.current = true; setBusy(true); playback.stop(true); setError(""); setMode("camera"); runtime.current.mode("camera");
        try {
            const blob = await exportDirectorBundle(source, { sequence, fps, signal: abort.signal,
                render: async frame => { if (!mounted.current || !runtime.current) throw new DOMException("已取消导出", "AbortError"); runtime.current.update(frame,null); return runtime.current.capture("color"); },
                progress: (done,total) => { if (mounted.current) setProgress(`正在输出 ${done} / ${total} 帧`); },
            });
            abort.signal.throwIfAborted(); if (mounted.current) saveAs(blob, `OneYes-${sequence ? "镜头序列" : "分镜包"}.zip`);
        } catch (error) { if (mounted.current) setError(abort.signal.aborted ? "导出已取消，场景和已保存分镜保持不变" : error instanceof Error ? error.message : "分镜导出失败"); }
        finally { saving.current = false; exportController.current = null; if (mounted.current) { runtime.current?.update(current.current.scene,selected); setBusy(false); setProgress(""); } }
    };

    const add = (kind: DirectorKind) => { const item = directorObject(kind); item.name += ` ${scene.objects.filter(item => item.kind === kind).length + 1}`; item.position[0] = (object?.position[0] || 0) + (scene.objects.length ? 0.8 : 0); update({ objects: [...scene.objects, item] }); setSelected(item.id); setSettings("object"); };
    const vector = (label: string, value: DirectorVector, change: (value: DirectorVector) => void, positive = false, disabled = busy) => <div className="space-y-1.5"><div className="text-xs" style={{ color: theme.node.muted }}>{label}</div><div className="grid grid-cols-3 gap-1.5">{value.map((number, i) => <InputNumber key={i} className="!w-full" size="small" aria-label={`${label} ${['X','Y','Z'][i]}`} prefix={<span style={{ color: theme.node.faint }}>{['X','Y','Z'][i]}</span>} step={label.includes("度") ? 5 : 0.1} min={positive ? 0.01 : undefined} value={number} disabled={disabled} onChange={v => { if (v !== null && Number.isFinite(v) && (!positive || v > 0)) { const next: DirectorVector = [...value]; next[i] = v; change(next); } }} />)}</div></div>;
    return <div className="flex flex-col gap-3" style={{ color: theme.node.text }} data-director-editor onFocusCapture={() => history.end()} onBlurCapture={() => history.end()} onPointerUpCapture={() => history.end()} onKeyDown={event => {
        if (busy || event.nativeEvent.isComposing || (event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],.ant-select,.ant-slider")) return;
        const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
        if (command && key === "z") travel(event.shiftKey);
        else if (command && key === "y") travel(true);
        else if (command && key === "d") duplicate();
        else if (!command && !event.altKey && key === "f") runtime.current?.focus(selected);
        else if (!command && !event.altKey && ["w","e","r"].includes(key)) changeTransform(key === "w" ? "translate" : key === "e" ? "rotate" : "scale");
        else if (!command && !event.altKey && (key === "delete" || key === "backspace")) remove();
        else return;
        event.preventDefault(); event.stopPropagation();
    }} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><Segmented aria-label="视窗模式" value={mode} options={[{ value: "camera", label: "镜头取景", icon: <Camera size={14} /> }, { value: "scene", label: "自由布景", icon: <Box size={14} /> }]} disabled={busy} onChange={value => { setMode(value as typeof mode); runtime.current?.mode(value as typeof mode); }} />
                {mode === "scene" && <Button type="text" size="small" disabled={!ready || busy} icon={<Focus size={14} />} onClick={() => { runtime.current?.adoptView(); setMode("camera"); runtime.current?.mode("camera"); }}>将此视角设为镜头</Button>}</div>
            <div className="flex flex-wrap items-center gap-1"><Tooltip title="撤销（⌘ / Ctrl Z）"><Button aria-label="撤销" type="text" size="small" disabled={busy || !history.canUndo} icon={<Undo2 size={15} />} onClick={() => travel()} /></Tooltip><Tooltip title="重做（⌘ / Ctrl Shift Z）"><Button aria-label="重做" type="text" size="small" disabled={busy || !history.canRedo} icon={<Redo2 size={15} />} onClick={() => travel(true)} /></Tooltip><span className="mx-1 h-3 border-l" style={{ borderColor: theme.toolbar.border }} />{([{ value: "translate", label: "移动", Icon: Move3D }, { value: "rotate", label: "旋转", Icon: Rotate3D }, { value: "scale", label: "缩放", Icon: Scaling }] as const).map(({ value, label, Icon }) => <Tooltip key={value} title={`${label}（${value === "translate" ? "W" : value === "rotate" ? "E" : "R"}）`}><Button type="text" size="small" disabled={editDisabled} aria-label={label} aria-pressed={transform === value} style={{ background: transform === value ? theme.toolbar.activeBg : undefined }} icon={<Icon size={16} />} onClick={() => changeTransform(value)} /></Tooltip>)}<Tooltip title="聚焦选中物体，未选中时显示全部（F）"><Button type="text" size="small" aria-label="聚焦物体" disabled={!ready || busy} icon={<Focus size={15} />} onClick={() => runtime.current?.focus(selected)} /></Tooltip></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}><span>布景 → 分镜 → 预演 → 交付 · 不会自动发起生成</span><div className="flex items-center gap-1"><input ref={fileInput} type="file" accept=".json,application/json" aria-label="导入导演台场景文件" className="hidden" onChange={event => { void importScene(event.target.files?.[0]); event.target.value = ""; }} /><Button type="text" size="small" disabled={busy} icon={<Upload size={13} />} onClick={() => fileInput.current?.click()}>导入场景</Button><Button type="text" size="small" disabled={busy} icon={<Download size={13} />} onClick={() => { try { saveAs(new Blob([directorSceneFile(scene)], { type: "application/json" }), "OneYes-导演台.json"); } catch (error) { setError(error instanceof Error ? error.message : "场景导出失败"); } }}>导出场景</Button></div></div>
        <DirectorAssistant ctx={ctx} scene={scene} disabled={working || !!playback.preview && !aiPreview} onPreview={setAiPreview} onApply={draft => { if (draft.source !== JSON.stringify(current.current.scene) || draft.source !== JSON.stringify(ctx.node.metadata?.directorScene)) { setError("场景已变化，AI 草稿未应用，请重新生成"); return false; } playback.stop(true); setAiPreview(null); commit(draft.scene); if(draft.added.length)setShotId(draft.added[0].id);setSelected(draft.scene.objects[0]?.id || null);return true; }} />
        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_264px]">
            <div className="relative min-h-[280px] overflow-hidden rounded-xl border md:h-[clamp(280px,34vh,480px)]" style={{ borderColor: theme.toolbar.border, background: scene.background }}>
                <div ref={container} className="absolute inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]" data-director-viewport tabIndex={0} aria-label="三维视窗，W 移动，E 旋转，R 缩放，F 聚焦" onPointerDown={() => container.current?.focus({ preventScroll: true })} />
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md px-2 py-1 text-xs" style={{ background: theme.toolbar.panel, color: theme.node.text }}><Camera size={13} />{display.camera.lens.toFixed(1).replace(/\.0$/, "")} mm<span style={{ color: theme.node.muted }}>{display.width} × {display.height}</span></div>
                {!ready && !renderError && <div className="absolute inset-0 grid place-items-center" role="status">正在准备三维视窗…</div>}
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="pointer-events-none rounded-md px-2 py-1" style={{ background: theme.toolbar.panel, color: theme.node.muted }}>左键环绕 · 右键平移 · 滚轮推进</span><Select<"front" | "back" | "left" | "right" | "top" | "perspective"> size="small" aria-label="常用视角" placeholder="切换视角" value={null} disabled={!ready || busy} onChange={value => runtime.current?.view(value)} options={[{ value: "perspective", label: "透视" }, { value: "front", label: "正面" }, { value: "back", label: "背面" }, { value: "left", label: "左侧" }, { value: "right", label: "右侧" }, { value: "top", label: "俯视" }]} /></div>
            </div>
            <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 md:max-h-[clamp(280px,34vh,480px)]" aria-label="导演台设置">
                <Segmented block size="small" aria-label="设置分类" value={settings} onChange={value => setSettings(value as typeof settings)} options={[{ value: "object", label: "物体" }, { value: "camera", label: "镜头" }, { value: "light", label: "环境" }]} />
                {settings === "object" && <><section className="space-y-2"><div className="flex items-center justify-between text-xs font-medium"><span>场景物体 · {scene.objects.length}</span><Select size="small" aria-label="添加物体" placeholder="添加" value={null} disabled={busy} onChange={add} options={(Object.keys(directorNames) as DirectorKind[]).map(value => ({ value, label: directorNames[value] }))} /></div>
                    <div className="max-h-40 space-y-0.5 overflow-auto">{scene.objects.map(item => { const Icon = icons[item.kind]; return <div key={item.id} className="flex items-center rounded-md" style={{ background: item.id === selected ? theme.toolbar.activeBg : undefined }}><button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline" aria-pressed={item.id === selected} disabled={busy} onClick={() => setSelected(item.id)} onDoubleClick={() => runtime.current?.focus(item.id)}><Icon size={14} className="shrink-0" /><span className="truncate" style={{ color: item.visible === false ? theme.node.faint : undefined }}>{item.name}</span></button><Tooltip title={item.visible === false ? "显示物体" : "隐藏物体"}><Button type="text" size="small" aria-label={`${item.visible === false ? "显示" : "隐藏"}${item.name}`} disabled={busy} icon={item.visible === false ? <EyeOff size={13} /> : <Eye size={13} />} onClick={() => patchObject(item.id, { visible: item.visible === false })} /></Tooltip><Tooltip title={item.locked ? "解锁物体" : "锁定物体"}><Button type="text" size="small" aria-label={`${item.locked ? "解锁" : "锁定"}${item.name}`} disabled={busy} icon={item.locked ? <LockKeyhole size={13} /> : <LockOpen size={13} />} onClick={() => patchObject(item.id, { locked: !item.locked })} /></Tooltip></div>; })}{!scene.objects.length && <p className="py-2 text-xs" style={{ color: theme.node.muted }}>添加人物或道具，开始布景</p>}</div>
                </section>
                {object && <section className="space-y-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><div className="flex items-center gap-1"><Input size="small" aria-label="物体名称" value={object.name} disabled={editDisabled} onChange={event => patchObject(object.id, { name: event.target.value }, `name:${object.id}`)} /><Tooltip title="复制物体（⌘ / Ctrl D）"><Button type="text" size="small" aria-label="复制物体" icon={<Copy size={14} />} disabled={editDisabled} onClick={duplicate} /></Tooltip><Tooltip title="移除物体（Delete）"><Button type="text" size="small" aria-label="移除物体" icon={<Trash2 size={14} />} disabled={editDisabled} onClick={remove} /></Tooltip></div>
                    {object.locked && <p className="text-xs" style={{ color: theme.node.muted }}>物体已锁定，点击列表中的锁图标解锁</p>}
                    <div className="flex items-center justify-between gap-2">{object.kind === "person" && <Select className="flex-1" aria-label="人物姿态" size="small" value={object.pose} options={directorPoses} disabled={editDisabled} onChange={pose => patchObject(object.id, { pose, joints: undefined })} />}<label className="inline-flex items-center gap-2 text-xs">颜色<input type="color" aria-label="物体颜色" className="h-6 w-8 cursor-pointer border-0 bg-transparent" value={object.color} disabled={editDisabled} onChange={event => patchObject(object.id, { color: event.target.value }, `color:${object.id}`)} /></label></div>
                    {object.kind === "person" && <details className="space-y-2 text-xs"><summary className="cursor-pointer py-1">精细调姿</summary><Select className="w-full" size="small" aria-label="人物关节" value={joint} disabled={editDisabled} onChange={setJoint} options={Object.entries(directorJoints).map(([value, label]) => ({ value, label }))} />{vector("关节旋转（度）", object.joints?.[joint] || [0,0,0], value => patchObject(object.id, { joints: { ...object.joints, [joint]: value } }, `joint:${object.id}:${joint}`), false, editDisabled)}<div className="flex flex-wrap gap-1"><Button type="text" size="small" disabled={editDisabled} onClick={() => { const joints = { ...object.joints }; delete joints[joint]; patchObject(object.id, { joints }); }}>重置此关节</Button><Button type="text" size="small" disabled={editDisabled} onClick={() => patchObject(object.id, { joints: undefined })}>恢复预设姿态</Button></div><p style={{ color: theme.node.muted }}>在预设姿态上调节关节，上臂与大腿会带动下级关节。</p></details>}
                    {vector("位置", object.position, position => patchObject(object.id, { position }, `position:${object.id}`), false, editDisabled)}{vector("旋转（度）", object.rotation, rotation => patchObject(object.id, { rotation }, `rotation:${object.id}`), false, editDisabled)}{vector("缩放", object.scale, scale => patchObject(object.id, { scale }, `scale:${object.id}`), true, editDisabled)}
                    <div className="flex flex-wrap gap-1"><Button type="text" size="small" disabled={!ready || editDisabled} onClick={() => runtime.current?.ground(object.id)}>贴地</Button><Button type="text" size="small" disabled={editDisabled} onClick={() => patchObject(object.id, { position: [0, object.position[1], 0] })}>水平居中</Button><Button type="text" size="small" disabled={editDisabled} onClick={() => patchObject(object.id, { rotation: [0,0,0], scale: [1,1,1] })}>重置变换</Button></div>
                    <details className="space-y-2 text-xs"><summary className="cursor-pointer py-1">表面材质</summary>{([['roughness','粗糙度',0.72],['metalness','金属感',0]] as const).map(([key,label,fallback]) => <div key={key} className="flex items-center justify-between"><span>{label}</span><InputNumber size="small" aria-label={label} min={0} max={1} step={0.1} value={object[key] ?? fallback} disabled={editDisabled} onChange={value => { if (value !== null && Number.isFinite(value) && value >= 0 && value <= 1) patchObject(object.id, { [key]: value }, `${key}:${object.id}`); }} /></div>)}</details>
                </section>}
                <Select<"portrait" | "dialogue" | "product"> className="w-full" aria-label="快速布景" placeholder="快速布景（可撤销）" size="small" value={null} disabled={busy} options={[{ value: "portrait", label: "单人肖像" }, { value: "dialogue", label: "双人对话" }, { value: "product", label: "产品展示" }]} onChange={value => { const preset = directorPreset(value); update({ objects: preset.objects, camera: preset.camera, light: preset.light }); setSelected(preset.objects[0]?.id || null); }} />
                </>}
                {settings === "camera" && <section className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium"><Camera size={14} />镜头</div>
                    <div className="flex flex-wrap gap-1">{[24,35,50,85].map(lens => <Button key={lens} type="text" size="small" className="!px-1" aria-pressed={scene.camera.lens === lens} disabled={busy} style={{ background: scene.camera.lens === lens ? theme.toolbar.activeBg : undefined }} onClick={() => update({ camera: { ...scene.camera, lens } })}>{lens} mm</Button>)}</div>
                    <div className="flex items-center justify-between text-xs"><span>焦距（mm）</span><InputNumber size="small" aria-label="镜头焦距" min={1} value={scene.camera.lens} disabled={busy} onChange={lens => { if (lens !== null && Number.isFinite(lens) && lens > 0) update({ camera: { ...scene.camera, lens } }, "lens"); }} /></div>
                    <div className="flex items-center justify-between text-xs"><span>镜头横滚（度）</span><InputNumber size="small" aria-label="镜头横滚" step={1} value={scene.camera.roll ?? 0} disabled={busy} onChange={roll => { if (roll !== null && Number.isFinite(roll)) update({ camera: { ...scene.camera, roll } }, "camera-roll"); }} /></div>
                    {vector("相机位置", scene.camera.position, position => { if (position.some((v,i) => v !== scene.camera.target[i])) update({ camera: { ...scene.camera, position } }, "camera-position"); })}{vector("取景目标", scene.camera.target, target => { if (target.some((v,i) => v !== scene.camera.position[i])) update({ camera: { ...scene.camera, target } }, "camera-target"); })}
                    <Button type="text" size="small" disabled={busy} onClick={() => update({ camera: directorPreset().camera })}>恢复默认机位</Button>
                    <Button type="text" size="small" disabled={busy || !ready || !selected} onClick={() => selected && runtime.current?.aim(selected)}>镜头对准所选物体</Button>
                    <div className="flex flex-wrap gap-2 text-xs"><Checkbox checked={!!scene.safeFrame} disabled={busy} onChange={event => update({safeFrame:event.target.checked})}>安全框</Checkbox><Checkbox checked={scene.motionPaths !== false} disabled={busy} onChange={event => update({motionPaths:event.target.checked})}>自由布景中显示运镜轨迹</Checkbox></div>
                    <div className="flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: theme.toolbar.border }}><Checkbox checked={scene.grid} disabled={busy} onChange={event => update({ grid: event.target.checked })}><span className="inline-flex items-center gap-1 text-xs"><Grid2X2 size={13} />网格</span></Checkbox><Select aria-label="构图参考线" size="small" value={scene.guide || "none"} disabled={busy} options={[{ value: "none", label: "无参考线" }, { value: "thirds", label: "三分构图" }, { value: "center", label: "中心十字" }]} onChange={guide => update({ guide })} /></div>

                </section>}

                {settings === "light" && <section className="space-y-2"><div className="flex items-center gap-2 text-xs font-medium"><Sun size={14} />灯光与环境</div>
                    <Select<keyof typeof directorLighting> className="w-full" size="small" aria-label="布光预设" placeholder="选择布光方案（可撤销）" value={null} disabled={busy} options={Object.entries(directorLighting).map(([value, preset]) => ({ value, label: preset.label }))} onChange={value => update({ light: structuredClone(directorLighting[value].light) })} />
                    <label className="block text-xs">光源方向<Slider aria-label="光源方向" min={-180} max={180} value={scene.light.azimuth} disabled={busy} onChange={azimuth => update({ light: { ...scene.light, azimuth } }, "light-azimuth")} /></label>
                    <label className="block text-xs">光源高度<Slider aria-label="光源高度" min={0} max={90} value={scene.light.elevation} disabled={busy} onChange={elevation => update({ light: { ...scene.light, elevation } }, "light-elevation")} /></label>
                    <div className="flex items-center justify-between text-xs"><span>光照强度</span><InputNumber size="small" aria-label="光照强度" min={0} step={0.1} value={scene.light.intensity} disabled={busy} onChange={intensity => { if (intensity !== null && Number.isFinite(intensity) && intensity >= 0) update({ light: { ...scene.light, intensity } }, "light-intensity"); }} /></div>
                    {([['ambient','环境光',2],['fill','补光',0],['rim','轮廓光',0]] as const).map(([key,label,fallback]) => <div key={key} className="flex items-center justify-between text-xs"><span>{label}</span><InputNumber size="small" aria-label={label} min={0} step={0.1} value={scene.light[key] ?? fallback} disabled={busy} onChange={value => { if (value !== null && Number.isFinite(value) && value >= 0) update({ light: { ...scene.light, [key]: value } }, `light:${key}`); }} /></div>)}
                    <label className="inline-flex items-center gap-2 text-xs">主光颜色<input type="color" aria-label="主光颜色" className="h-6 w-8 cursor-pointer border-0 bg-transparent" value={scene.light.color || "#ffffff"} disabled={busy} onChange={event => update({ light: { ...scene.light, color: event.target.value } }, "light-color")} /></label>
                    <div className="flex flex-wrap gap-2"><Checkbox checked={scene.light.shadows !== false} disabled={busy} onChange={event => update({ light: { ...scene.light, shadows: event.target.checked } })}>阴影</Checkbox><Checkbox checked={scene.floorVisible !== false} disabled={busy} onChange={event => update({ floorVisible: event.target.checked })}>地面</Checkbox></div>
                    <div className="flex items-center justify-between">{([['background','背景'],['floor','地面']] as const).map(([key,label]) => <label key={key} className="inline-flex items-center gap-2 text-xs">{label}<input type="color" aria-label={`${label}颜色`} className="h-6 w-8 cursor-pointer border-0 bg-transparent" value={scene[key]} disabled={busy} onChange={event => update({ [key]: event.target.value }, key)} /></label>)}</div>
                </section>}
            </aside>
        </div>
        <DirectorTimeline scene={aiPreview || scene} shotId={shotId} onSelect={selectShot} onChange={update} playback={playback} onEdit={() => { if (playback.preview) setShotId(playback.preview.shotId); const frame = display; playback.stop(true); commit(frame); }} onRecord={record} disabled={working || !!aiPreview} ready={ready} theme={theme} />
        <details className="text-xs"><summary className="cursor-pointer py-1" style={{ color: theme.node.muted }}>创作描述与分镜交付</summary><Input.TextArea className="mt-2" aria-label="导演台创作描述" autoSize={{ minRows: 2 }} placeholder="例如：雨夜霓虹街道，两人交谈，写实电影感。具体画面风格由生图模型完成。" value={scene.note || ""} disabled={busy} onChange={event => update({ note: event.target.value }, "scene-note")} /><div className="mt-2 flex flex-wrap items-center gap-2"><Button type="text" size="small" disabled={busy || !scene.shots?.length} onClick={() => saveAs(new Blob([shotListCsv(scene)], {type:"text/csv;charset=utf-8"}), "OneYes-分镜表.csv")}>导出镜头表 CSV</Button><Button type="text" size="small" disabled={busy || !ready || !scene.shots?.length} onClick={() => void exportBundle(false)}>导出分镜包</Button><label className="inline-flex items-center gap-1">序列帧率<InputNumber size="small" className="!w-20" aria-label="序列帧率" min={1} precision={0} value={fps} disabled={busy} onChange={value => { if (value !== null && Number.isSafeInteger(value) && value > 0) setFps(value); }} />fps</label><Button type="text" size="small" disabled={busy || !ready || !scene.shots?.length} onClick={() => void exportBundle(true)}>导出 PNG 序列</Button>{working && exportController.current && <Button type="text" size="small" onClick={() => exportController.current?.abort()}>取消导出</Button>}<Button type="text" size="small" disabled={busy || !ready || !savedShot} onClick={() => void capture(false,"video")}>创建视频工作流</Button><Button type="text" size="small" disabled={busy || !ready || !scene.shots?.length} onClick={() => void capture(true,true)}>创建全部生图工作流</Button></div><p className="mt-1" style={{ color: theme.node.muted }}>分镜包包含原尺寸首帧、可打印 HTML 分镜表、CSV 与场景；PNG 序列逐帧渲染运镜和走位，可取消。视频工作流使用参考帧和分镜时长，需手动检查模型能力后生成。</p></details>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-end justify-between gap-3 border-t pb-1 pt-3" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}><div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs">画幅<Select className="block w-24" size="small" aria-label="输出画幅" value={`${scene.width}:${scene.height}`} disabled={busy} onChange={value => { const [width,height] = value.split(':').map(Number); update({ width,height }); }} options={[{ value: '1536:864', label: '16:9' }, { value: '864:1536', label: '9:16' }, { value: '1024:1024', label: '1:1' }, { value: '1536:1024', label: '3:2' }, ...(!['1536:864','864:1536','1024:1024','1536:1024'].includes(`${scene.width}:${scene.height}`) ? [{ value: `${scene.width}:${scene.height}`, label: '自定义' }] : [])]} /></label><label className="space-y-1 text-xs">宽（px）<InputNumber className="!block !w-24" size="small" aria-label="输出宽度" min={1} precision={0} value={scene.width} disabled={busy} onChange={width => { if (width !== null && Number.isSafeInteger(width) && width > 0) update({ width }); }} /></label><label className="space-y-1 text-xs">高（px）<InputNumber className="!block !w-24" size="small" aria-label="输出高度" min={1} precision={0} value={scene.height} disabled={busy} onChange={height => { if (height !== null && Number.isSafeInteger(height) && height > 0) update({ height }); }} /></label></div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs" role="status" style={{ color: theme.node.muted }}>{working ? progress || "正在读取场景…" : aiPreview ? "AI 草稿预览 · 尚未应用" : previewing ? playback.playing ? "正在预演 · 场景未改动" : "预演已暂停 · 可编辑此帧" : saved ? "已保存到画布，可连接生图节点" : "场景自动保存 · 本机渲染"}</span><Select size="small" aria-label="导演台输出类型" value={output} disabled={busy} onChange={setOutput} options={Object.entries(directorOutputs).map(([value,label]) => ({ value, label: value === 'depth' ? `${label}（近白远黑）` : label }))}/><Button type="text" size="small" disabled={!ready||busy||!scene.shots?.length} onClick={()=>void capture(true)}>输出全部机位</Button><Button type="text" size="small" disabled={!ready||busy} onClick={() => void capture(false,true)}>创建生图工作流</Button><Button type="text" icon={<Camera size={16} />} loading={working} disabled={!ready || previewing} onClick={() => void capture()}>输出{directorOutputs[output]}</Button></div>
        </div>
        {renderError && <p className="text-xs leading-relaxed" role="alert">{renderError}</p>}
        {error && <div className="flex items-center justify-between gap-2 text-xs leading-relaxed" role="alert"><span>{error}</span><Button type="text" size="small" onClick={() => setError("")}>收起提示</Button></div>}
    </div>;
}
