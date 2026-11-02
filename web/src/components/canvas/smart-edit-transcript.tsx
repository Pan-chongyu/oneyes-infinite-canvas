import { useEffect, useState } from "react";
import { App, Button, Checkbox, Input, Select } from "antd";
import { Play } from "lucide-react";
import type { EditAnalysis, EditClip } from "@/types/smart-edit";
import { editTranscript, editTranscriptPlan } from "@/lib/canvas/smart-edit";
import { editTimecode } from "./smart-edit-timeline";
import styles from "./smart-edit-workbench.module.css";

export function SmartEditTranscript({ analysis, clips, disabled, onEdit, onPreview }: { analysis: EditAnalysis; clips: EditClip[]; disabled: boolean; onEdit: (clips: EditClip[]) => void; onPreview: (clip: EditClip) => void }) {
    const { modal, message } = App.useApp();
    const [selected, setSelected] = useState<string[]>([]),
        [search, setSearch] = useState(""),
        [speaker, setSpeaker] = useState<string>();
    useEffect(() => {
        setSelected([]);
        setSpeaker(undefined);
    }, [analysis]);
    const entries = editTranscript(analysis),
        speakers = [...new Set(entries.flatMap((cue) => (cue.speaker ? [cue.speaker] : [])))],
        visible = entries.filter((cue) => (!speaker || cue.speaker === speaker) && cue.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
        hidden = selected.filter((id) => !visible.some((cue) => cue.id === id)).length;
    const apply = (action: "append" | "keep" | "remove", ids = selected) => {
        try {
            const next = editTranscriptPlan(clips, analysis, ids, action);
            if (JSON.stringify(next) === JSON.stringify(clips)) {
                void message.info("所选字幕不在当前清单中，无需删除");
                return;
            }
            // A confirmation may outlive the current render; never replace later edits.
            const commit = () => {
                try {
                    onEdit(next);
                    setSelected([]);
                } catch (error) {
                    void message.error((error as Error).message);
                }
            };
            if (action === "keep")
                modal.confirm({
                    title: `用所选 ${ids.length} 句组成新清单？`,
                    content: `按原素材顺序拼接为 ${next.length} 个片段，共 ${editTimecode(next.reduce((sum, clip) => sum + clip.end - clip.start, 0))}（转场前）。将替换当前清单；应用后仍可撤销和手调，原素材保留。`,
                    okText: "替换清单",
                    cancelText: "继续选择",
                    onOk: commit,
                });
            else commit();
        } catch (error) {
            void message.error((error as Error).message);
        }
    };
    return (
        <section className="space-y-2 text-xs" aria-label="文字精剪">
            <p className="m-0 leading-5 opacity-65">像改文稿一样剪视频：先选句，再保留或删除。只按已有字幕时间剪辑，不改原片。</p>
            <Input size="small" aria-label="搜索字幕" allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索字幕内容" />
            {speakers.length > 0 && <Select size="small" className="w-full" aria-label="筛选字幕说话人" allowClear placeholder="全部说话人" value={speaker} onChange={setSpeaker} options={speakers.map((value) => ({ label: value, value }))} />}
            <div className="flex flex-wrap items-center gap-1">
                <Checkbox
                    disabled={disabled || !visible.length}
                    checked={visible.length > 0 && visible.every((cue) => selected.includes(cue.id))}
                    indeterminate={visible.some((cue) => selected.includes(cue.id)) && !visible.every((cue) => selected.includes(cue.id))}
                    onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((cue) => cue.id)])] : selected.filter((id) => !visible.some((cue) => cue.id === id)))}
                >
                    全选结果
                </Checkbox>
                <Button type="text" size="small" disabled={disabled || !selected.length} onClick={() => setSelected([])}>
                    清空选择
                </Button>
            </div>
            <div className={styles.selection} data-edit-selection>
                <span role="status">
                    已选 {selected.length} 句{hidden > 0 && `（含筛选外 ${hidden} 句）`}
                </span>
                <div className="flex flex-wrap gap-1">
                    <Button type="text" size="small" disabled={disabled || !selected.length} onClick={() => apply("keep")}>
                        仅保留所选
                    </Button>
                    <Button type="text" size="small" disabled={disabled || !selected.length} onClick={() => apply("remove")}>
                        删除所选
                    </Button>
                    <Button type="text" size="small" disabled={disabled || !selected.length} onClick={() => apply("append")}>
                        追加所选
                    </Button>
                </div>
            </div>
            {visible.map((cue) => (
                <div key={cue.id} className={styles.transcript} data-edit-transcript>
                    <div className="flex items-start gap-2">
                        <Checkbox
                            aria-label={`选择字幕 ${cue.title} ${editTimecode(cue.start)}`}
                            checked={selected.includes(cue.id)}
                            disabled={disabled}
                            onChange={(event) => setSelected(event.target.checked ? [...selected, cue.id] : selected.filter((id) => id !== cue.id))}
                        />
                        <div className="min-w-0 flex-1">
                            <span className="text-[11px] tabular-nums opacity-60">
                                {cue.title} · {editTimecode(cue.start)}–{editTimecode(cue.end)}
                                {cue.speaker && ` · ${cue.speaker}`}
                            </span>
                            <p className="m-0 break-words leading-5">{cue.text}</p>
                        </div>
                        <Button
                            type="text"
                            size="small"
                            aria-label={`预览字幕 ${cue.title} ${editTimecode(cue.start)}`}
                            icon={<Play size={12} />}
                            disabled={disabled}
                            onClick={() => onPreview({ id: `transcript:${cue.id}`, sourceId: cue.sourceId, start: cue.start, end: cue.end, label: cue.text, enabled: true })}
                        />
                    </div>
                    <div className="flex flex-wrap gap-1 pl-6">
                        <Button type="text" size="small" disabled={disabled} onClick={() => apply("append", [cue.id])}>
                            添加至末尾
                        </Button>
                        <Button type="text" size="small" disabled={disabled || !clips.some((clip) => clip.sourceId === cue.sourceId && clip.start < cue.end && clip.end > cue.start)} onClick={() => apply("remove", [cue.id])}>
                            删除这句
                        </Button>
                    </div>
                </div>
            ))}
            {!visible.length && (
                <p className="m-0 leading-5 opacity-65" role="status">
                    {entries.length ? "没有匹配字幕，请清除搜索或说话人筛选。" : "暂无时间戳字幕。连接已有字幕节点后重新分析，或在上方识别缺失字幕。"}
                </p>
            )}
        </section>
    );
}
