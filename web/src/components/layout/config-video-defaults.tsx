import { Button } from 'antd';
import { useState } from 'react';
import { ModelPicker } from '@/components/model-picker';
import { VideoSettingsPanel } from '@/components/video-settings-panel';
import { canvasThemes } from '@/lib/canvas-theme';
import { videoModelDefaults, videoModelDefaultsKey } from '@/lib/video-model-defaults';
import { selectableModelsByCapability, useConfigStore } from '@/stores/use-config-store';
import { useThemeStore } from '@/stores/use-theme-store';

export function ConfigVideoDefaults() {
    const config = useConfigStore(state => state.config);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const [selected, setSelected] = useState(config.videoModel);
    const models = selectableModelsByCapability(config, 'video');
    const model = models.includes(selected) ? selected : models[0];
    const key = model ? videoModelDefaultsKey(config, model) : '';
    const saved = Boolean(config.videoModelDefaults?.[key]);
    const reset = () => {
        const current = useConfigStore.getState().config;
        const defaults = { ...current.videoModelDefaults };
        delete defaults[key];
        useConfigStore.getState().updateConfig('videoModelDefaults', defaults);
    };
    return <section className="mb-6 space-y-3" aria-label="视频模型默认配置" data-testid="video-model-defaults">
        <div>
            <div className="text-sm font-semibold">视频模型默认配置</div>
            <p className="mt-1 text-xs leading-5 opacity-65">切换模型时自动应用；动态模型采用已审核的默认配置，其他模型使用最低分辨率、最短时长。不会改动已有节点或正在生成的任务。</p>
        </div>
        {model ? <>
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><ModelPicker config={config} value={model} capability="video" onChange={setSelected} fullWidth /></div>
                <Button type="text" size="small" disabled={!saved} onClick={reset}>恢复默认配置</Button>
            </div>
            <p role="status" aria-live="polite" className="text-xs" style={{ color: theme.node.muted }}>{saved ? '已自动保存 · 仅用于这个模型' : '使用模型默认配置 · 调整后自动保存'}</p>
            <VideoSettingsPanel config={{ ...config, ...videoModelDefaults(config, model), model }} model={model} theme={theme} showTitle={false} showModelDetails={false} validateReferences={false} className="grid items-start gap-5 md:grid-cols-2" onConfigChange={(key, value) => {
                const current = useConfigStore.getState().config;
                useConfigStore.getState().updateConfig('videoModelDefaults', { ...current.videoModelDefaults, [videoModelDefaultsKey(current, model)]: { ...videoModelDefaults(current, model), [key]: value } });
            }} />
        </> : <p className="text-xs opacity-65">请先登录并配置可用的视频模型。</p>}
    </section>;
}
