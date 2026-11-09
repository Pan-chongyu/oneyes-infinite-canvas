import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "@/styles/globals.css";
import "@/i18n";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ModelPicker } from "@/components/model-picker";
import { useModelCatalogSync } from "@/hooks/use-model-catalog-sync";
import { queryClient } from "@/lib/query-client";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";

await useConfigStore.persist.rehydrate();
useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-model-key", models: [] }] });
Object.assign(window, { modelTest: {
    state: () => ({ ...useModelCatalogStore.getState(), config: useConfigStore.getState().config }),
    expire: () => queryClient.invalidateQueries({ queryKey: ["oneyes-model-catalog"], refetchType: "none" }),
    sync: () => useModelCatalogStore.getState().sync(),
    checked: (name: string) => (Array.from(document.querySelectorAll("label.ant-checkbox-wrapper")).find(label => label.textContent?.trim() === name)?.querySelector("input") as HTMLInputElement)?.checked,
    toggle: (name: string) => (Array.from(document.querySelectorAll("label.ant-checkbox-wrapper")).find(label => label.textContent?.trim() === name)?.querySelector("input") as HTMLInputElement)?.click(),
} });
function Probe() {
    useModelCatalogSync();
    const config = useConfigStore(state => state.config);
    const [open, setOpen] = useState(false);
    return <div className="p-6">
        <ModelPicker config={config} value={config.textModel} capability="text" onChange={value => useConfigStore.getState().updateConfig("textModel", value)} />
        <Button data-testid="open-models" onClick={() => setOpen(true)}>管理模型</Button>
        <ChannelEditorDrawer open={open} channel={config.channels[0]} onClose={() => setOpen(false)} onSave={channel => useConfigStore.getState().replaceConfig({ ...useConfigStore.getState().config, channels: [channel] })} />
    </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><ConfigProvider><App><Probe /></App></ConfigProvider></React.StrictMode>);
