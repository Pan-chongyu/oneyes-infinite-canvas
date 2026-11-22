import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';
import { useModelCatalogStore } from '@/stores/use-model-catalog-store';
import { useConfigStore, type AiConfig } from '@/stores/use-config-store';
import { videoModelState } from '@/lib/video-model-status';

/** Fixed public labels only; never render a service status/message verbatim. */
export function VideoModelStatus({ value, config: supplied, menu = false }: { value: string; config?: AiConfig; menu?: boolean }) {
    const global = useConfigStore(state => state.config), config = supplied || global;
    const catalog = useVideoCatalogStore(state => state.catalog), delayed = useVideoCatalogStore(state => state.delayed);
    const discoveryFailed = useModelCatalogStore(state => Boolean(state.errors[value.split('::')[0]]));
    const state = videoModelState(config, value, catalog);
    const details = <>
        {(delayed || discoveryFailed || state.stale) && <span className="text-muted-foreground" data-model-info-delayed>信息更新延迟</span>}
        {state.priceStale && <span className="text-muted-foreground" data-model-price-stale title="保留上次价格供参考，实际费用以成功任务结算为准">价格待核实</span>}
        {state.parametersStale && <span className="text-muted-foreground" data-model-parameters-stale title="参数规则变化待核实，保留上次验证配置，不自动修改已有节点">参数待更新</span>}
    </>;
    return <span className={menu ? 'contents text-[11px] font-normal' : 'inline-flex flex-wrap items-center gap-1 align-middle text-[11px] font-normal leading-4'} data-video-model-status={state.status}>
        <span data-model-availability className={menu ? `col-start-3 row-start-1 pt-0.5 text-right text-[11px] leading-5 ${state.disabled ? 'text-destructive' : 'text-muted-foreground'}` : state.disabled ? 'rounded border border-destructive/30 bg-destructive/10 px-1 text-destructive' : 'rounded border border-border bg-muted px-1 text-muted-foreground'}>{state.label}</span>
        {menu ? (delayed || discoveryFailed || state.stale || state.priceStale || state.parametersStale) && <span className="col-span-2 col-start-2 row-start-3 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4">{details}</span> : details}
    </span>;
}
