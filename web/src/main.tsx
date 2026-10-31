import { initializeDiagnostics, reportError } from '@/services/diagnostics';
import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { useConfigStore } from "@/stores/use-config-store";
import { router } from "@/router";
import { initializeDesktopTransport } from "@/services/api/desktop-transport";
import { initializeImageTasks } from "@/stores/use-image-task-store";

initializeDiagnostics();
initAnalytics();
initializeDesktopTransport();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

await useConfigStore.persist.rehydrate();
initializeImageTasks();

createRoot(document.getElementById("root")!, { onCaughtError: error => reportError("app", "renderer", error), onUncaughtError: error => reportError("app", "renderer", error) }).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
