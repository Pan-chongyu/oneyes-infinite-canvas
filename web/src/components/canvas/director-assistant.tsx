import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { Copy, Eye, Film, Sparkles, Upload, X } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { formatVideoPrompt, readVideoPrompt, videoPromptSystem, type DirectorAiMode, type DirectorDraft } from "@/lib/canvas/director-assistant";
import { directorInputSnapshot } from "@/lib/canvas/director-inputs";
import { DirectorSetup } from "./director-setup";
import type { DirectorDraftController } from "./use-director-draft";
import { sequenceDuration } from "@/lib/canvas/director-sequence";
import { studioModelChoice } from "@/lib/canvas/studio-assistant";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { creatorSourceBlob } from "@/services/creator-media";
import { DEFAULT_VIDEO_FRAME_COUNT, sampleDirectorVideo, type DirectorVideoFrames } from "@/services/director-video";
import { reportError } from "@/services/diagnostics";
import type { DirectorAssistantSettings, DirectorScene } from "@/types/director";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function DirectorAssistant({ctx,scene,disabled,onApply,onPreview,creation}:{ctx:CanvasNodeContext;scene:DirectorScene;disabled:boolean;onApply:(draft:DirectorDraft)=>boolean;onPreview:(scene:DirectorScene|null)=>void;creation:DirectorDraftController}) {
    const settings=ctx.node.metadata?.directorAssistant || {}, mode=settings.mode || "scene", prompt=settings.prompt || "", choice=studioModelChoice(ctx.ai,settings.model,"text");
    const [videoBusy,setBusy]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState("");
    const {draft}=creation, busy=videoBusy||creation.busy;
    const [expanded,setExpanded]=useState(creation.autoPreview);
    const latest=useRef({ctx,scene});latest.current={ctx,scene};
    const controller=useRef<AbortController|null>(null),mounted=useRef(true),input=useRef<HTMLInputElement>(null);
    const videos=ctx.getNodes().filter(node=>node.type==="video"&&(node.metadata?.content||node.metadata?.storageKey));
    const [videoId,setVideoId]=useState(ctx.getUpstream().find(node=>node.type==="video")?.id || videos[0]?.id || ""),[file,setFile]=useState<File|null>(null),[count,setCount]=useState(DEFAULT_VIDEO_FRAME_COUNT);
    const [samples,setSamples]=useState<DirectorVideoFrames|null>(null),[selected,setSelected]=useState<number[]>([]),[thumbnails,setThumbnails]=useState<string[]>([]);
    const video=videos.find(node=>node.id===videoId),source=JSON.stringify([video?.id,video?.metadata?.content,video?.metadata?.storageKey,file?.name,file?.size,file?.lastModified]);
    const copy=useCopyText(),{message}=App.useApp();
    const patch=(patch:Partial<DirectorAssistantSettings>)=>latest.current.ctx.updateMetadata({directorAssistant:{...latest.current.ctx.node.metadata?.directorAssistant,...patch}});
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
    useEffect(()=>{if(!file&&!video&&videos[0])setVideoId(videos[0].id);},[file,video?.id,videos[0]?.id]);
    useEffect(()=>{controller.current?.abort();setSamples(null);setSelected([]);},[source]);
    useEffect(()=>{const urls=samples?.frames.map(frame=>URL.createObjectURL(frame.blob)) || [];setThumbnails(urls);return()=>urls.forEach(url=>URL.revokeObjectURL(url));},[samples]);
    useEffect(()=>{onPreview(null);},[scene,onPreview]);
    useEffect(()=>{if(draft||creation.busy)setExpanded(true);},[draft,creation.busy]);
    useEffect(()=>{if(draft&&creation.autoPreview)onPreview(draft.preview);},[draft,creation.autoPreview,onPreview]);
    const run=async(task:(signal:AbortSignal,check:()=>void)=>Promise<void>)=>{
        if(controller.current)return;
        const abort=new AbortController(),origin={projectId:ctx.projectId,nodeId:ctx.node.id};controller.current=abort;setBusy(true);setError("");
        const check=()=>{abort.signal.throwIfAborted();const next=latest.current.ctx;if(!mounted.current||next.projectId!==origin.projectId||next.node.id!==origin.nodeId||!next.getNode(origin.nodeId))throw new DOMException("操作已结束","AbortError");};
        try{await task(abort.signal,check);}
        catch(error){if(!abort.signal.aborted&&mounted.current){setError(error instanceof Error?error.message:"AI 处理失败，请检查模型配置后重试");reportError("agent","request",error);}}
        finally{if(controller.current===abort)controller.current=null;if(mounted.current){setBusy(false);setProgress("");}}
    };
    const generate=(target:DirectorAiMode)=>{setError("");onPreview(null);void creation.generate(target,scene);};
    const extract=()=>void run(async(signal,check)=>{
        if(!file&&!video)throw Error("请选择画布视频或导入本机视频");
        const original=file || await creatorSourceBlob(video!,signal);check();
        const result=await sampleDirectorVideo(original,count,signal,setProgress);check();setSamples(result);setSelected(result.frames.map((_,index)=>index));
    });
    const analyze=()=>void run(async(signal,check)=>{
        if(!choice.ready)throw Error("请先选择可用且支持看图的文本模型");
        if(!samples||!selected.length)throw Error("请先提取并选择参考帧");
        setProgress("正在详细分析主体、构图、光影、动作与运镜…");
        const frames=samples.frames.filter((_,index)=>selected.includes(index)),references:string[]=[];
        for(const frame of frames){references.push(await readFileAsDataUrl(new File([frame.blob],"reference.png",{type:"image/png"})));check();}
        const result=await ctx.ai.generateText(JSON.stringify({要求:prompt || "详细反推完整视频及每个可判断镜头的生成提示词，写明主体一致性、场景空间、光影材质、动作起止和运镜依据",完整视频时长:samples.duration,原尺寸:[samples.width,samples.height],按顺序传入的帧时间:frames.map(frame=>frame.time)}),{system:videoPromptSystem,model:choice.value,references,signal});check();
        const reverse=readVideoPrompt(result.text,samples.duration);check();patch({reverse,reverseSource:{name:file?.name||video?.title||"参考视频",duration:samples.duration,times:frames.map(frame=>frame.time)}});
    });
    const reverse=settings.reverse,stale=!!draft&&(draft.source!==JSON.stringify(scene)||draft.source!==JSON.stringify(ctx.node.metadata?.directorScene));
    const text=reverse?formatVideoPrompt(reverse):"";
    const useReverse=(mode:DirectorAiMode)=>{controller.current?.abort();onPreview(null);patch({mode,prompt:text});setError("");};
    const addText=()=>{
        const node=createCanvasNode("text",{x:0,y:0},{content:text,status:"success"});node.position={x:ctx.node.position.x+ctx.node.width+100,y:ctx.node.position.y};
        for(const neighbor of [...ctx.getNodes()].sort((a,b)=>a.position.y-b.position.y))if(node.position.x<neighbor.position.x+neighbor.width&&node.position.x+node.width>neighbor.position.x&&node.position.y<neighbor.position.y+neighbor.height&&node.position.y+node.height>neighbor.position.y)node.position.y=neighbor.position.y+neighbor.height+32;
        ctx.applyOps([{type:"add_node",id:node.id,nodeType:"text",title:"视频反推 · 提示词",position:node.position,width:node.width,height:node.height,metadata:node.metadata},{type:"connect_nodes",fromNodeId:ctx.node.id,toNodeId:node.id}]);void message.success("提示词已加入画布");
    };
    return <details className="border-t pt-2 text-xs" style={{borderColor:ctx.theme.toolbar.border}} data-director-assistant open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer py-1 font-medium"><Sparkles size={13} className="mr-1 inline"/>AI 调台、动画与视频反推</summary>
        <div className="mt-2 space-y-2">
            <DirectorSetup ctx={ctx} disabled={busy||disabled}/>
            {mode==="video"?<>
                <div className="flex flex-wrap items-center gap-2"><Select size="small" className="min-w-48 flex-1" aria-label="反推参考视频" placeholder="选择画布视频" value={file?undefined:videoId||undefined} disabled={busy||disabled} options={videos.map(node=>({value:node.id,label:node.title}))} onChange={id=>{setFile(null);setVideoId(id);}}/><input ref={input} type="file" accept="video/*,.mkv,.avi" className="hidden" aria-label="导入反推视频" onChange={event=>{if(event.target.files?.[0])setFile(event.target.files[0]);event.target.value="";}}/><Button type="text" size="small" icon={<Upload size={13}/>} disabled={busy||disabled} onClick={()=>input.current?.click()}>导入视频</Button>{file&&<span className="max-w-48 truncate">{file.name}</span>}<label className="inline-flex items-center gap-1">采样<InputNumber size="small" className="!w-20" aria-label="视频参考帧数量" min={1} precision={0} value={count} disabled={busy||disabled} onChange={value=>{if(value!==null&&Number.isSafeInteger(value)&&value>0)setCount(value);}}/>帧</label><Button type="text" size="small" icon={<Film size={13}/>} disabled={busy||disabled||!file&&!video} onClick={extract}>提取参考帧</Button></div>
                {samples&&<><div className="flex flex-wrap items-center gap-2" style={{color:ctx.theme.node.muted}}><span>{samples.duration.toFixed(2)} 秒 · {samples.width} × {samples.height} · 已选 {selected.length} / {samples.frames.length} 帧</span><Button type="text" size="small" disabled={busy||disabled} onClick={()=>setSelected(selected.length===samples.frames.length?[]:samples.frames.map((_,i)=>i))}>{selected.length===samples.frames.length?"取消全选":"全选帧"}</Button></div><div className="flex gap-2 overflow-x-auto pb-1">{samples.frames.map((frame,index)=><label key={index} className="w-28 shrink-0 cursor-pointer space-y-1"><img src={thumbnails[index]} alt={`参考帧 ${index+1}`} className="h-16 w-full rounded object-contain"/><Checkbox disabled={busy||disabled} checked={selected.includes(index)} onChange={event=>setSelected(old=>event.target.checked?[...old,index].sort((a,b)=>a-b):old.filter(i=>i!==index))}>{frame.time.toFixed(2)}s</Checkbox></label>)}</div></>}
                <p style={{color:ctx.theme.node.muted}}>抽帧在本机完成；确认后仅将所选原尺寸帧和描述发送给模型，不上传音轨。需选择支持看图的模型，抽样不能精确还原完整动作或声音。</p>
                <Button type="text" size="small" icon={<Sparkles size={13}/>} disabled={busy||disabled||!choice.ready||!selected.length} onClick={analyze}>反推视频提示词</Button>
                {reverse&&<section aria-label="视频反推结果" className="space-y-2">
                    <p className="font-medium">{reverse.summary}</p>
                    {settings.reverseSource&&<p style={{color:ctx.theme.node.muted}}>分析来源：{settings.reverseSource.name} · {settings.reverseSource.duration.toFixed(2)}s · {settings.reverseSource.times.length} 帧（不含音轨）</p>}
                    <label className="block space-y-1"><span className="font-medium">完整视频生成提示词</span><Input.TextArea aria-label="反推视频提示词" autoSize={{minRows:3,maxRows:8}} value={reverse.prompt} disabled={busy||disabled} onChange={event=>patch({reverse:{...reverse,prompt:event.target.value}})}/></label>
                    <label className="block space-y-1"><span style={{color:ctx.theme.node.muted}}>一致性与避免项</span><Input.TextArea aria-label="反推需要避免的画面" autoSize={{minRows:1,maxRows:3}} placeholder="需要保持的连续性与避免的画面问题" value={reverse.negativePrompt || ""} disabled={busy||disabled} onChange={event=>patch({reverse:{...reverse,negativePrompt:event.target.value}})}/></label>
                    <div className="space-y-1" aria-label="逐镜头详细反推">{reverse.shots.map((shot,index)=><details key={index} className="border-t pt-1" style={{borderColor:ctx.theme.toolbar.border}}>
                        <summary className="cursor-pointer py-1">镜头 {index+1} · {shot.start}–{shot.end}s · 详细描述与提示词</summary>
                        <div className="space-y-2 pb-2 pt-1 leading-relaxed">
                            <p className="whitespace-pre-wrap break-words"><span style={{color:ctx.theme.node.muted}}>画面与构图：</span>{shot.description}</p>
                            <p className="whitespace-pre-wrap break-words"><span style={{color:ctx.theme.node.muted}}>镜头与运镜：</span>{shot.camera}</p>
                            <p className="whitespace-pre-wrap break-words"><span style={{color:ctx.theme.node.muted}}>动作与时间：</span>{shot.action}</p>
                            <label className="block space-y-1"><span className="font-medium">本镜生成提示词</span><Input.TextArea aria-label={`镜头 ${index+1} 生成提示词`} autoSize={{minRows:2,maxRows:6}} value={shot.prompt} disabled={busy||disabled} onChange={event=>patch({reverse:{...reverse,shots:reverse.shots.map((item,i)=>i===index?{...item,prompt:event.target.value}:item)}})}/></label>
                        </div>
                    </details>)}</div>
                    {!!reverse.uncertainties?.length&&<details className="space-y-1" open><summary className="cursor-pointer py-1" style={{color:ctx.theme.node.muted}}>待确认 · 抽样不能证明的内容</summary><ul className="list-disc space-y-1 pl-4" style={{color:ctx.theme.node.muted}}>{reverse.uncertainties.map((item,index)=><li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul></details>}
                    <div className="flex flex-wrap gap-1"><Button type="text" size="small" icon={<Copy size={13}/>} onClick={()=>void copy(text)}>复制完整提示词</Button><Button type="text" size="small" disabled={busy||disabled} onClick={addText}>加入画布文本</Button><Button type="text" size="small" disabled={busy||disabled} onClick={()=>useReverse("scene")}>用于调整场景</Button><Button type="text" size="small" disabled={busy||disabled} onClick={()=>useReverse("animation")}>用于制作动画</Button></div>
                </section>}
            </>:<>
                <div className="flex flex-wrap items-center gap-2"><Button type="text" size="small" icon={<Sparkles size={13}/>} disabled={busy||disabled||!choice.ready||(!prompt.trim()&&!directorInputSnapshot(ctx).inputs.length)} onClick={()=>generate(mode)}>生成{mode==="animation"?"动画":"场景"}草稿</Button><span style={{color:ctx.theme.node.muted}}>{mode==="animation"?"新增动画分镜，保留已有镜头。":"调整当前场景，保存机位保持不变。"}锁定物体保留；应用可撤销。</span></div>
                {draft&&<section aria-label="导演台 AI 草稿" className="space-y-2"><p role="status" className="font-medium">AI 草稿已就绪：{draft.summary}</p><p style={{color:ctx.theme.node.muted}}>{draft.scene.objects.length} 个物体{draft.added.length?` · 新增 ${draft.added.length} 镜 · ${sequenceDuration(draft.added)} 秒`:""}</p>{draft.added.map(shot=><p key={shot.id}>{shot.name} · {shot.duration}s · {shot.keyframes?.length || 0} 个运动关键帧</p>)}{stale&&<p role="alert">场景已变化，此草稿不能覆盖新修改，请重新生成。</p>}<div className="flex flex-wrap gap-1"><Button type="text" size="small" icon={<Eye size={13}/>} disabled={busy||disabled||stale} onClick={()=>onPreview(draft.preview)}>预览 AI 草稿</Button><Button type="text" size="small" disabled={busy} onClick={()=>onPreview(null)}>退出草稿预览</Button><Button type="text" size="small" disabled={busy||disabled||stale} onClick={()=>{if(onApply(draft))creation.clear();}}>{creation.autoPreview?"应用并微调":"应用 AI 草稿"}</Button><Button type="text" size="small" icon={<X size={13}/>} disabled={busy} onClick={()=>{creation.clear();onPreview(null);}}>丢弃草稿</Button></div></section>}
            </>}
            {busy&&<div className="flex items-center gap-2" role="status"><Sparkles size={13} className="animate-pulse motion-reduce:animate-none"/>{creation.progress||progress}<Button type="text" size="small" onClick={()=>{controller.current?.abort();creation.cancel();}}>取消 AI 操作</Button></div>}
            <p style={{color:ctx.theme.node.muted}}>点击生成或反推会调用所选模型，按站点计费；未应用的草稿不改动场景，不会自动重发调用。</p>
            {(error||creation.error)&&<p role="alert">{error||creation.error}</p>}
        </div>
    </details>;
}
