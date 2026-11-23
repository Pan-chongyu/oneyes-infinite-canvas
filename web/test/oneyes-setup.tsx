import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import 'antd/dist/reset.css';
import '@/styles/globals.css';
import '@/i18n';
import { OneYesSetupDialog } from '@/components/layout/oneyes-setup-dialog';
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
    Object.assign(window, { setupTest: {
        state: () => ({ config: useConfigStore.getState().config, status: useConfigStore.getState().setupStatus, mode: useConfigStore.getState().setupMode, open: useConfigStore.getState().isSetupOpen, busy: useOneYesAccountStore.getState().busy, report: useOneYesAccountStore.getState().report, error: useOneYesAccountStore.getState().error }),
        theme: (value: boolean) => flushSync(() => { setDark(value); document.documentElement.classList.toggle('dark', value); }),
        reset: async (mode: 'beginner' | 'expert' | null = null, configured = false) => {
            flushSync(() => setMounted(false));
            queryClient.clear();
            useConfigStore.setState({ config: configured ? { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'existing-key', models: [{ name: 'gpt-image-2', capability: 'image' }] }], imageModel: 'default::gpt-image-2' } : defaultConfig, setupStatus: 'pending', setupMode: mode, isSetupOpen: false, isConfigOpen: false });
            useOneYesAccountStore.setState({ ready: false, busy: false, user: null, error: '', report: [], requires_2fa: false });
            await useOneYesAccountStore.getState().restore();
            flushSync(() => setMounted(true));
        },
    } });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter>{mounted && <OneYesSetupDialog />}</MemoryRouter></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
