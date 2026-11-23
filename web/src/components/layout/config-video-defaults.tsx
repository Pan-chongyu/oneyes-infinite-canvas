import { Button } from 'antd';
import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { VideoSettingsPanel } from '@/components/video-settings-panel';
import { canvasThemes } from '@/lib/canvas-theme';
import { videoModelDefaults, videoModelDefaultsKey } from '@/lib/video-model-defaults';
import { selectableModelsByCapability, useConfigStore } from '@/stores/use-config-store';
import { useThemeStore } from '@/stores/use-theme-store';
import styles from './config-preferences.module.css';

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
    return <section className={styles.section} aria-labelledby="video-defaults-heading" data-testid="video-model-defaults">
        <header>
            <h2 id="video-defaults-heading">视频模型默认配置</h2>
            <p>为每个模型保存常用参数，切换模型时自动应用。</p>
            <p>不会改变已有节点或正在生成的任务。未保存偏好时，沿用模型默认配置。</p>
        </header>
        <div className={styles.videoDefaults}>
        {model ? <>
            <div className={styles.videoHeader}>
                <div className="min-w-0 flex-1"><ModelPicker config={config} value={model} capability="video" onChange={setSelected} fullWidth /></div>
                <Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} disabled={!saved} onClick={reset}>恢复默认配置</Button>
            </div>
            <p role="status" aria-live="polite" className={styles.saved}><Check aria-hidden="true" className="size-3.5" />{saved ? '已自动保存 · 仅用于这个模型' : '使用模型默认配置 · 调整后自动保存'}</p>
            <VideoSettingsPanel compact config={{ ...config, ...videoModelDefaults(config, model), model }} model={model} theme={theme} showTitle={false} showModelDetails={false} validateReferences={false} className="grid items-start gap-x-5 gap-y-5 sm:grid-cols-2" onConfigChange={(key, value) => {
                const current = useConfigStore.getState().config;
                useConfigStore.getState().updateConfig('videoModelDefaults', { ...current.videoModelDefaults, [videoModelDefaultsKey(current, model)]: { ...videoModelDefaults(current, model), [key]: value } });
            }} />
        </> : <p className="text-xs text-muted-foreground">请先登录并配置可用的视频模型。</p>}
        </div>
    </section>;
}
