import { useState } from "react";
import { Search, Workflow, X } from "lucide-react";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { filterLibraryNodes, nodeCategories, nodeLibraryInfo, workflowTemplates } from "@/lib/canvas/node-library";

export function NodeLibrary({ extensionsOnly = false, onCreate, onTemplate, onClose }: { extensionsOnly?: boolean; onCreate: (type: string) => void; onTemplate?: (id: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion();
    const [query, setQuery] = useState(""),
        [category, setCategory] = useState<(typeof nodeCategories)[number]>("全部"),
        [templates, setTemplates] = useState(false);
    const defs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && (!extensionsOnly || getNodePluginId(def.type) !== "builtin"));
    const results = filterLibraryNodes(defs, query, category);
    const workflows = workflowTemplates.filter((item) => item.types.every((type) => listNodeDefinitions().some((def) => def.type === type)) && `${item.title} ${item.description}`.includes(query.trim()));
    const categories = nodeCategories.filter((name) => name === "全部" || defs.some((def) => nodeLibraryInfo(def.type).category === name));
    const button = "rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 motion-reduce:transition-none";
    return (
        <div
            data-node-library
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") onClose();
            }}
        >
            <header className="mb-2 flex items-center justify-between px-1">
                <div className="flex gap-1">
                    <button type="button" className={button} aria-pressed={!templates} onClick={() => setTemplates(false)} style={{ color: !templates ? theme.node.text : theme.node.muted }}>
                        节点库
                    </button>
                    {onTemplate && (
                        <button type="button" className={button} aria-pressed={templates} onClick={() => setTemplates(true)} style={{ color: templates ? theme.node.text : theme.node.muted }}>
                            常用流程
                        </button>
                    )}
                </div>
                <button type="button" className={button} aria-label="关闭节点库" onClick={onClose}>
                    <X size={14} />
                </button>
            </header>
            <label className="mx-1 flex items-center gap-2 rounded-md border px-2 py-2" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                <Search size={14} className="shrink-0" />
                <input
                    autoFocus
                    aria-label="搜索节点或流程"
                    placeholder={templates ? "搜索流程" : "搜索名称、用途，如抠图 / OCR"}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                        const first = templates ? workflows[0]?.id : results[0]?.type;
                        if (!first) return;
                        event.preventDefault();
                        if (templates) onTemplate?.(first);
                        else onCreate(first);
                        onClose();
                    }}
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                    style={{ color: theme.node.text }}
                />
            </label>
            {!templates && (
                <div className="my-2 flex flex-wrap gap-0.5 px-1" aria-label="节点分类">
                    {categories.map((name) => (
                        <button
                            type="button"
                            key={name}
                            className={button}
                            aria-pressed={category === name}
                            onClick={() => setCategory(name)}
                            style={{ color: category === name ? theme.toolbar.activeText : theme.node.muted, background: category === name ? theme.toolbar.activeBg : undefined }}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            )}
            <div className="thin-scrollbar mt-2 max-h-[min(40vh,340px)] space-y-0.5 overflow-y-auto" aria-label={templates ? "常用流程列表" : "节点列表"}>
                {templates
                    ? workflows.map((item) => (
                          <button
                              type="button"
                              key={item.id}
                              className="flex w-full gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                              onClick={() => {
                                  onTemplate?.(item.id);
                                  onClose();
                              }}
                          >
                              <Workflow size={17} className="mt-0.5 shrink-0" />
                              <span>
                                  <span className="block text-sm">{item.title}</span>
                                  <span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>
                                      {item.description}
                                  </span>
                              </span>
                          </button>
                      ))
                    : results.map((def) => (
                          <button
                              type="button"
                              key={def.type}
                              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                              onClick={() => {
                                  onCreate(def.type);
                                  onClose();
                              }}
                              title={def.description}
                          >
                              <span className="mt-0.5 grid size-6 shrink-0 place-items-center">{def.icon}</span>
                              <span className="min-w-0">
                                  <span className="block text-sm">{def.title}</span>
                                  <span className="mt-0.5 block text-xs leading-5" style={{ color: theme.node.muted }}>
                                      {nodeLibraryInfo(def.type).flow}
                                  </span>
                              </span>
                          </button>
                      ))}
                {(templates ? !workflows.length : !results.length) && (
                    <p className="px-3 py-6 text-center text-xs" role="status" style={{ color: theme.node.muted }}>
                        没有匹配结果，试试其他名称或用途
                    </p>
                )}
            </div>
            <p className="mb-0 mt-2 border-t px-2 pt-2 text-[11px] leading-5" style={{ color: theme.node.muted, borderColor: theme.toolbar.border }}>
                {templates ? "只创建节点与连线；填写素材后手动运行，不会自动计费。" : `${results.length} 个节点 · 模型节点运行前请确认配置与用量`}
            </p>
        </div>
    );
}
