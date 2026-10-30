import { useCallback, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { installPluginFromFile } from "@/lib/canvas/plugin-loader";

export function usePluginInstaller() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const pending = useRef(false);
    const [importing, setImporting] = useState(false);
    const installFiles = useCallback(async (files: File[]) => {
        if (pending.current) { message.info(t("canvas.plugins.importing")); return; }
        pending.current = true;
        setImporting(true);
        try {
            for (const file of files) {
                try {
                    const plugin = await installPluginFromFile(file);
                    message.success(t("canvas.plugins.fileInstalled", { name: plugin.name || plugin.id }));
                } catch (error) {
                    message.error(t("canvas.plugins.installFailed", { error: `${file.name}：${error instanceof Error ? error.message : String(error)}` }));
                }
            }
        } finally { pending.current = false; setImporting(false); }
    }, [message, t]);
    return { importing, installFiles };
}
