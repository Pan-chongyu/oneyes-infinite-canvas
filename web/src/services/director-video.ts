import { processNativeVideo } from "./creator-media";

export type DirectorVideoFrames = {duration:number;width:number;height:number;frames:{time:number;blob:Blob}[]};
export async function sampleDirectorVideo(blob: Blob, count: number, signal: AbortSignal, progress: (text:string)=>void): Promise<DirectorVideoFrames> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(count) || count < 1) throw Error("参考帧数量必须为正整数");
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video"); video.muted=true;video.playsInline=true;video.preload="auto";
    try {
        if (window.oneYesDesktop?.media) {
            const artifacts = await processNativeVideo("sample",[{id:"director-video",type:"video",title:"参考视频",position:{x:0,y:0},width:1,height:1,metadata:{content:url}}],{samples:count},signal,state=>progress(state.stage));
            const metadata = artifacts.find(item=>item.name==="video-info.json");
            if (!metadata) throw Error("未能读取视频信息，请重新提取参考帧");
            const info = JSON.parse(await metadata.blob.text());
            if (![info.duration,info.width,info.height].every(value=>typeof value==="number"&&Number.isFinite(value)&&value>0)) throw Error("视频时长或尺寸无效");
            const frames = artifacts.filter(item=>item.kind==="image").map(item=>({time:item.time!,blob:item.blob}));
            if (frames.length!==count || frames.some(frame=>!Number.isFinite(frame.time)||frame.time<0||frame.time>=info.duration)) throw Error("视频采样时间表无效，请重新提取");
            return {...info,frames};
        }
        const wait = (event: string) => new Promise<void>((resolve,reject)=>{
            const stop = () => {video.removeEventListener(event,done);video.removeEventListener("error",fail);signal.removeEventListener("abort",abort);};
            const done = () => {stop();resolve();}, fail = () => {stop();reject(Error("浏览器无法解码此视频，请使用桌面版内置媒体组件或换用支持的视频编码"));}, abort = () => {stop();reject(new DOMException("已取消视频采样","AbortError"));};
            video.addEventListener(event,done,{once:true});video.addEventListener("error",fail,{once:true});signal.addEventListener("abort",abort,{once:true});
            if (signal.aborted) abort(); else if (video.error) fail();
        });
        const loaded=wait("loadedmetadata");video.src=url;video.load();await loaded;
        if (!Number.isFinite(video.duration)||video.duration<=0||!video.videoWidth||!video.videoHeight) throw Error("无法读取完整视频的时长与尺寸");
        const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const context=canvas.getContext("2d");if(!context)throw Error("无法启动视频取帧组件");
        const frames:DirectorVideoFrames["frames"]=[];
        for(let index=0;index<count;index++) {
            signal.throwIfAborted();progress(`正在提取参考帧 ${index+1} / ${count}`);
            const time=video.duration*index/count;
            if(time!==video.currentTime){const seeked=wait("seeked");video.currentTime=time;await seeked;}
            else if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)await wait("loadeddata");
            context.drawImage(video,0,0);
            const frame=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error("无法保存视频参考帧")),"image/png"));
            signal.throwIfAborted();frames.push({time,blob:frame});
        }
        return {duration:video.duration,width:video.videoWidth,height:video.videoHeight,frames};
    } finally {video.removeAttribute("src");video.load();URL.revokeObjectURL(url);}
}
