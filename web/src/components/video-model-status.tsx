import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';
import { useModelCatalogStore } from '@/stores/use-model-catalog-store';
import { useConfigStore, type AiConfig } from '@/stores/use-config-store';
import { videoModelState } from '@/lib/video-model-status';

/** Fixed public labels only; never render a service status/message verbatim. */
export function VideoModelStatus({ value, config: supplied }: { value: string; config?: AiConfig }) {
    const global = useConfigStore(state => state.config), config = supplied || global;
    const catalog = useVideoCatalogStore(state => state.catalog), delayed = useVideoCatalogStore(state => state.delayed);
    const discoveryFailed = useModelCatalogStore(state => Boolean(state.errors[value.split('::')[0]]));
    const state = videoModelState(config, value, catalog);
    return <span className="inline-flex flex-wrap items-center gap-1 align-middle text-[11px] font-normal leading-4" data-video-model-status={state.status}>
        <span className={state.disabled ? 'rounded border border-destructive/30 bg-destructive/10 px-1 text-destructive' : 'rounded border border-border bg-muted px-1 text-muted-foreground'}>{state.label}</span>
        {(delayed || discoveryFailed || state.stale) && <span className="text-muted-foreground" data-model-info-delayed>信息更新延迟</span>}
        {state.priceStale && <span className="text-muted-foreground" data-model-price-stale title="保留上次价格供参考，实际费用以成功任务结算为准">价格待核实</span>}
        {state.parametersStale && <span className="text-muted-foreground" data-model-parameters-stale title="参数规则变化待核实，保留上次验证配置，不自动修改已有节点">参数待更新</span>}
    </span>;
}
