import { Alert, Button, Checkbox, Collapse, Drawer, Input, Segmented, Select } from "antd";
import { ChevronRight, KeyRound, RefreshCw, Search, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import { GROK_VIDEO_CHANNEL_ID, guessCapability, normalizeChannelModels, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [catalog, setCatalog] = useState<ChannelModel[]>([]);
    const [available, setAvailable] = useState<string[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<ModelCapability | "all">("all");
    const [keyOpen, setKeyOpen] = useState(false);
    const [manual, setManual] = useState("");
    const [manualConfigured, setManualConfigured] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const request = useRef(0);
    const capabilities = ["image", "text", "video", "audio"] as const;
    const capabilityOptions = capabilities.map(value => ({ label: t(`config.channelEditor.capabilities.${value}`), value }));

    const loadModels = async (target: ModelChannel) => {
        const current = ++request.current;
        setLoading(true); setAvailable(null); setError("");
        try {
            const names = await fetchChannelModels(target);
            if (current !== request.current) return;
            setAvailable(names);
            setCatalog(previous => normalizeChannelModels([...previous, ...names]));
        } catch (cause) {
            if (current === request.current) setError(cause instanceof Error ? cause.message : t("config.modelSelect.fetchFailed"));
        } finally { if (current === request.current) setLoading(false); }
    };

    useEffect(() => {
        if (!open || !channel) return;
        setDraft(channel); setCatalog(channel.models); setAvailable(null); setLoading(false); setError(""); setSearch(""); setFilter("all"); setManual(""); setManualConfigured(false); setScriptTarget(null); setKeyOpen(!channel.apiKey.trim());
        if (channel.apiKey.trim()) void loadModels(channel);
        return () => { request.current++; };
    }, [open, channel]);

    if (!draft) return null;

    const platform = draft.id === GROK_VIDEO_CHANNEL_ID ? "grok" : draft.oneYes?.platform || (draft.id === "oneyes-deepseek" ? "deepseek" : "openai");
    const name = { openai: "OpenAI", deepseek: "DeepSeek", grok: "Grok", minimax: "MiniMax" }[platform];
    const selected = new Set(draft.models.map(model => model.name));
    const missing = available === null ? [] : draft.models.filter(model => !available.includes(model.name));
    const keyword = search.trim().toLowerCase();
    const visible = catalog.filter(model => (!keyword || model.name.toLowerCase().includes(keyword)) && (filter === "all" || model.capability === filter));
    const selectable = visible.filter(model => available === null || available.includes(model.name));
    const keyNeedsCheck = Boolean(draft.apiKey.trim() && draft.apiKey.trim() !== channel?.apiKey.trim() && available === null && !manualConfigured);
    const patch = (value: Partial<ModelChannel>) => setDraft(current => current ? { ...current, ...value } : current);
    const toggle = (model: ChannelModel, checked: boolean) => patch({ models: checked ? [...draft.models, model] : draft.models.filter(item => item.name !== model.name) });
    const updateModel = (name: string, value: Partial<ChannelModel>) => {
        patch({ models: draft.models.map(model => model.name === name ? { ...model, ...value } : model) });
        setCatalog(current => current.map(model => model.name === name ? { ...model, ...value } : model));
    };
    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        const model = catalog.find(item => item.name === name) || { name, capability: guessCapability(name) };
        if (!catalog.some(item => item.name === name)) setCatalog(current => [...current, model]);
        if (!selected.has(name)) toggle(model, true);
        setManual(""); setManualConfigured(true); setSearch(""); setFilter("all");
    };

    return <Drawer open={open} width={600} onClose={onClose}
        title={t("config.channelEditor.manageTitle", { name })}
        styles={{ body: { padding: 20 }, footer: { padding: "12px 20px" } }}
        footer={<div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground" aria-live="polite">{t("config.channelEditor.selectedCount", { count: draft.models.length })}</span>
            <div className="flex gap-2"><Button onClick={onClose}>{t("common.cancel")}</Button><Button type="primary" disabled={loading || keyNeedsCheck} onClick={() => { onSave({ ...draft, apiKey: draft.apiKey.trim(), models: normalizeChannelModels(draft.models) }); onClose(); }}>{t("config.channelEditor.save")}</Button></div>
        </div>}>
        <p className="mb-4 mt-0 text-sm leading-relaxed text-muted-foreground">{t("config.channelEditor.simpleHint")}</p>
        <div className="mb-5 rounded-lg border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5"><KeyRound className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="text-sm font-medium">{t(`config.channelEditor.${draft.apiKey.trim() ? "keyConfigured" : "keyMissing"}`)}</div><div className="mt-0.5 text-xs text-muted-foreground">{draft.oneYes ? t("config.channelEditor.group", { name: draft.oneYes.groupName }) : t("config.channelEditor.keyHint")}</div></div></div>
                <Button type="text" size="small" aria-expanded={keyOpen} onClick={() => setKeyOpen(value => !value)}>{t(`config.channelEditor.${keyOpen ? "hideKey" : "changeKey"}`)}</Button>
            </div>
            {keyOpen && <label className="mt-3 block border-t border-border pt-3"><span className="mb-2 block text-xs font-medium">API Key</span><Input.Password aria-label="API Key" autoComplete="off" value={draft.apiKey} placeholder="sk-..." onChange={event => { request.current++; setLoading(false); setAvailable(null); setManualConfigured(false); setError(""); patch({ apiKey: event.target.value, oneYes: event.target.value.trim() === channel?.apiKey.trim() ? channel?.oneYes : undefined }); }} /><span className="mt-2 block text-xs text-muted-foreground">{t("config.channelEditor.replaceHint")}</span></label>}
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("config.channelEditor.models")}</h3>
            <Button icon={<RefreshCw className="size-3.5" />} loading={loading} disabled={!draft.apiKey.trim()} onClick={() => void loadModels(draft)}>{t(`config.channelEditor.${available === null ? "load" : "refresh"}`)}</Button>
        </div>
        {error && <Alert className="mb-3" type="error" showIcon title={t("config.modelSelect.fetchFailed")} description={<span className="break-words">{error}</span>} />}
        {keyNeedsCheck && <Alert className="mb-3" type="info" showIcon title={t("config.channelEditor.keyChanged")} />}
        {!!missing.length && <Alert className="!mb-3" type="warning" showIcon title={<div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-medium">{t("config.channelEditor.missing", { count: missing.length })}</div><p className="mb-0 mt-1 text-xs text-muted-foreground">{t("config.channelEditor.missingHint")}</p></div><Button size="small" onClick={() => patch({ models: draft.models.filter(model => available?.includes(model.name)) })}>{t("config.channelEditor.removeMissing")}</Button></div>} />}
        <Input aria-label={t("config.modelSelect.search")} prefix={<Search className="size-3.5 text-muted-foreground" />} placeholder={t("config.modelSelect.search")} value={search} onChange={event => setSearch(event.target.value)} allowClear />
        <div className="my-3 overflow-x-auto"><Segmented aria-label={t("config.channelEditor.filter")} value={filter} onChange={value => setFilter(value as typeof filter)} options={[{ label: t("config.channelEditor.all"), value: "all" }, ...capabilityOptions]} /></div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span role="status">{t(loading ? "config.channelEditor.loading" : available === null ? "config.channelEditor.savedList" : "config.channelEditor.availableCount", { count: available?.length || 0 })}</span>
            <div className="flex gap-2"><Button size="small" type="text" disabled={loading || !selectable.length} onClick={() => patch({ models: normalizeChannelModels([...draft.models, ...selectable]) })}>{t("config.channelEditor.selectAll")}</Button><Button size="small" type="text" disabled={loading || !visible.some(model => selected.has(model.name))} onClick={() => patch({ models: draft.models.filter(model => !visible.some(item => item.name === model.name)) })}>{t("config.channelEditor.clear")}</Button></div>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border" aria-busy={loading}>
            {visible.map(model => {
                const missing = available !== null && !available.includes(model.name);
                return <div key={model.name} className="flex items-center justify-between gap-3 px-3 py-3">
                    <Checkbox className="min-w-0 flex-1 [&_.ant-checkbox-label]:min-w-0" checked={selected.has(model.name)} disabled={loading} onChange={event => toggle(model, event.target.checked)}><span className="break-all text-sm">{model.name}</span></Checkbox>
                    <span className="shrink-0 text-xs text-muted-foreground">{t(missing ? "config.channelEditor.notReturned" : `config.channelEditor.capabilities.${model.capability}`)}</span>
                </div>;
            })}
            {!visible.length && <div className="px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">{t(loading ? "config.channelEditor.loading" : search || filter !== "all" ? "config.channelEditor.noMatches" : available?.length === 0 ? "config.channelEditor.noRemoteModels" : "config.channelEditor.empty")}</div>}
        </div>
        <Collapse key={`${draft.id}:${open}`} ghost className="mt-4" expandIcon={({ isActive }) => <ChevronRight className={`size-3.5 motion-safe:transition-transform motion-safe:duration-200 ${isActive ? "rotate-90" : ""}`} />} items={[{ key: "advanced", label: <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Settings2 className="size-3.5" />{t("config.channelEditor.advanced")}</span>, children: <div>
            <p className="mb-3 mt-0 text-xs text-muted-foreground">{t("config.channelEditor.advancedHint")}</p>
            <div className="mb-4 flex gap-2"><Input aria-label={t("config.modelSelect.modelName")} value={manual} placeholder={t("config.modelSelect.modelName")} onChange={event => setManual(event.target.value)} onPressEnter={addManual} /><Button onClick={addManual}>{t("config.modelSelect.add")}</Button></div>
            <div className="space-y-3">{draft.models.map(model => <div key={model.name} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{model.name}</span><Select aria-label={t("config.channelEditor.modelCapability", { name: model.name })} size="small" value={model.capability} options={capabilityOptions} onChange={capability => updateModel(model.name, { capability })} /><Button size="small" onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>{t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}</Button></div>)}</div>
        </div> }]} />
        <ModelScriptEditor open={Boolean(scriptTarget)} capability={scriptTarget?.capability || "text"} modelName={scriptTarget?.name || ""} value={scriptTarget?.value || ""} onSave={script => scriptTarget && updateModel(scriptTarget.name, { script: script || undefined })} onClose={() => setScriptTarget(null)} />
    </Drawer>;
}
