import { strToU8, Zip, ZipPassThrough } from "fflate";
import { directorSceneFile } from "./director-scene";
import { shotDuration, shotListCsv, shotScene } from "./director-sequence";
import type { DirectorScene } from "@/types/director";

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function storyboardHtml(scene: DirectorScene) {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OneYes 分镜表</title><style>body{font:14px/1.6 system-ui,sans-serif;margin:32px;color:#202020}h1{font-size:24px}article{display:grid;grid-template-columns:42% 1fr;gap:24px;break-inside:avoid;border-top:1px solid #bbb;padding:24px 0}img{width:100%;height:auto}h2{margin:0;font-size:18px}p{white-space:pre-wrap;margin:6px 0}@media print{body{margin:0}article{gap:16px}img{max-height:50vh;object-fit:contain}}</style><h1>OneYes 分镜表</h1><p>${escape(scene.note || "")}</p>${(scene.shots || []).map((shot, index) => `<article><div><img src="shots/${String(index + 1).padStart(4, "0")}/frame-000001.png" alt="${escape(shot.name)}"></div><div><h2>${index + 1}. ${escape(shot.name)}</h2><p>${shotDuration(shot)} 秒 · ${shot.camera.lens} mm · ${shot.width} × ${shot.height}</p><p>${escape(shot.note || "")}</p><p>台词：${escape(shot.dialogue || "—")}</p><p>声音：${escape(shot.sound || "—")}</p></div></article>`).join("")}</html>`;
}
/** Exact-size PNGs are stored without a second lossy codec. Render sequentially and cancel without downloading a partial ZIP. */
export async function exportDirectorBundle(scene: DirectorScene, options: {
    sequence: boolean; fps: number; signal: AbortSignal;
    render: (scene: DirectorScene) => Promise<Blob>;
    progress: (done: number, total: number) => void;
}) {
    if (!scene.shots?.length) throw Error("请先保存分镜机位");
    if (!Number.isSafeInteger(options.fps) || options.fps <= 0) throw Error("帧率必须为正整数");
    const counts = scene.shots.map(shot => options.sequence ? Math.ceil(shotDuration(shot) * options.fps) : 1);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(total) || total <= 0) throw Error("序列帧数无法准确表示，请检查分镜时长与帧率");
    const chunks: BlobPart[] = [];
    let failure: Error | null = null, finished = false, done = 0;
    const archive = new Zip((error, data, final) => { if (error) failure = error; else chunks.push(new Uint8Array(data)); if (final) finished = true; });
    const check = () => { options.signal.throwIfAborted(); if (failure) throw failure; };
    const add = (name: string, bytes: Uint8Array) => { check(); const file = new ZipPassThrough(name); archive.add(file); file.push(bytes, true); };
    try {
        add("scene.json", strToU8(directorSceneFile(scene)));
        add("shotlist.csv", strToU8(shotListCsv(scene)));
        add("storyboard.html", strToU8(storyboardHtml(scene)));
        add("README.txt", strToU8(`OneYes 导演台\n解压后打开 storyboard.html 查看或打印分镜表。\nshotlist.csv 可用表格软件打开，scene.json 可重新导入导演台。\n${options.sequence ? `PNG 序列帧：${options.fps} fps，各镜头独立文件夹；每镜持续时长见 shotlist.csv，最后一帧不足一帧时按原时长裁切。` : "每个镜头包含原始尺寸的首帧参考图。"}\n未自动调用模型或生成配音。`));
        for (let index = 0; index < scene.shots.length; index++) {
            const shot = scene.shots[index];
            for (let frame = 0; frame < counts[index]; frame++) {
                check();
                const blob = await options.render(shotScene(scene, shot, frame / options.fps));
                check(); add(`shots/${String(index + 1).padStart(4, "0")}/frame-${String(frame + 1).padStart(6, "0")}.png`, new Uint8Array(await blob.arrayBuffer()));
                options.progress(++done, total);
            }
        }
        archive.end(); check(); if (!finished) throw Error("分镜文件尚未完成，请重试导出");
        return new Blob(chunks, { type: "application/zip" });
    } finally { archive.terminate(); }
}
