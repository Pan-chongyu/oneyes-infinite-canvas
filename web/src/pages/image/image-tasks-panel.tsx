import { LoaderCircle, RotateCw } from "lucide-react";
import { imageTasks, useImageTaskStore } from "@/stores/use-image-task-store";

const labels = { submitting: "正在提交", processing: "云端生成中", waiting: "等待联网取图", saving: "正在保存图片", credentials: "需要原 API Key", paused: "已暂停取图", uncertain: "需要确认用量", failed: "生成失败", completed: "已保存" };

export function ImageTasksPanel() {
    const tasks = useImageTaskStore(state => state.tasks);
    const error = useImageTaskStore(state => state.error);
    const pending = tasks.filter(task => task.status !== "completed");
    if (!pending.length && !error) return null;
    return <details className="mb-4 rounded-lg border border-current/10 px-3 py-2 text-sm" open={pending.some(task => ["uncertain", "credentials", "failed"].includes(task.status)) || undefined}>
        <summary className="cursor-pointer select-none font-medium">生成任务 · {pending.length}<span className="ml-2 text-xs opacity-60">断网后自动取回图片</span></summary>
        {error && <p role="alert" className="mt-2">{error}</p>}
        <div className="mt-2 max-h-56 space-y-2 overflow-auto">
            {pending.map(task => <div key={task.id} className="flex items-start gap-2 border-t border-current/5 pt-2">
                {["submitting", "processing", "saving"].includes(task.status) && <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
                <div className="min-w-0 flex-1"><div className="truncate" title={task.prompt}>{task.prompt}</div><p className="mt-0.5 text-xs opacity-60">{labels[task.status]}{task.error ? ` · ${task.error}` : ""}</p></div>
                {task.remoteId && !["failed", "submitting", "saving"].includes(task.status) && <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-current/5" onClick={() => void imageTasks.resume(task.id)}><RotateCw className="size-3" />继续取图</button>}
                {["uncertain", "failed", "paused"].includes(task.status) && <button type="button" className="shrink-0 px-1 py-0.5 text-xs opacity-50 hover:opacity-100" onClick={() => void imageTasks.remove(task.id)}>移除记录</button>}
            </div>)}
        </div>
        <p className="mt-2 text-xs opacity-50">取回后保存到本机和生成记录。任务以服务端保留期为准；继续取图不会重新生成或重复扣费。</p>
    </details>;
}
