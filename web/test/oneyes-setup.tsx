import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import 'antd/dist/reset.css';
import '@/styles/globals.css';
import '@/i18n';
import { OneYesSetupDialog } from '@/components/layout/oneyes-setup-dialog';
import { AppTopNav } from '@/components/layout/app-top-nav';
import ConfigPage from '@/pages/config';
import ProfilePage from '@/pages/profile';
import { getAntThemeConfig } from '@/lib/app-theme';
import { defaultConfig, useConfigStore } from '@/stores/use-config-store';
import { useOneYesAccountStore } from '@/stores/use-oneyes-account-store';
import { queryClient } from '@/lib/query-client';

await useConfigStore.persist.rehydrate();
await useOneYesAccountStore.getState().restore();
const trace: unknown[] = [];
Object.assign(window, { setupTrace: trace });
document.addEventListener('click', event => { const store = useConfigStore.getState(); trace.push({ button: (event.target as HTMLElement).closest('button')?.textContent, mode: store.setupMode, open: store.isSetupOpen, status: store.setupStatus }); });
useConfigStore.subscribe((state, previous) => { if (state.isSetupOpen !== previous.isSetupOpen || state.setupMode !== previous.setupMode) trace.push({ mode: state.setupMode, open: state.isSetupOpen, status: state.setupStatus }); });
function Fixture() {
    const [mounted, setMounted] = useState(true), [dark, setDark] = useState(false);
    const [showPages, setShowPages] = useState(false);
    Object.assign(window, { setupTest: {
        state: () => ({ config: useConfigStore.getState().config, status: useConfigStore.getState().setupStatus, mode: useConfigStore.getState().setupMode, open: useConfigStore.getState().isSetupOpen, busy: useOneYesAccountStore.getState().busy, report: useOneYesAccountStore.getState().report, error: useOneYesAccountStore.getState().error }),
        theme: (value: boolean) => flushSync(() => {
            setDark(value);
            document.documentElement.classList.toggle('dark', value);
            document.documentElement.style.colorScheme = value ? 'dark' : 'light';
        }),
        showPages: () => flushSync(() => setShowPages(true)),
        requestModels: () => useConfigStore.getState().openConfigDialog(true),
        reset: async (mode: 'beginner' | 'expert' | null = null, configured = false) => {
            flushSync(() => setMounted(false));
            queryClient.clear();
            useConfigStore.setState({ config: configured ? { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'existing-key', models: [{ name: 'gpt-image-2', capability: 'image' }] }], imageModel: 'default::gpt-image-2' } : defaultConfig, setupStatus: 'pending', setupMode: mode, isSetupOpen: false, isConfigOpen: false });
            useOneYesAccountStore.setState({ ready: false, busy: false, user: null, error: '', report: [], requires_2fa: false });
            await useOneYesAccountStore.getState().restore();
            flushSync(() => setMounted(true));
        },
    } });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App>
        <QueryClientProvider client={queryClient}><MemoryRouter>
            {showPages && <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground md:flex-row">
                <AppTopNav />
                <div className="min-h-0 min-w-0 flex-1">
                    <Routes>
                        <Route path="/" element={null} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/config" element={<ConfigPage />} />
                    </Routes>
                </div>
            </div>}
            {mounted && <OneYesSetupDialog />}
        </MemoryRouter></QueryClientProvider>
    </App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
