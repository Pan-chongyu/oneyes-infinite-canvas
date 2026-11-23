import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import '@/i18n';
import '@/styles/globals.css';
import { CanvasImageDetails } from '@/components/canvas/canvas-image-details';
import { CanvasNode } from '@/components/canvas/canvas-node';
import { getAntThemeConfig } from '@/lib/app-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import { uploadImage, setImageBlob } from '@/services/image-storage';
import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';

async function main() {
    const canvas = new OffscreenCanvas(4096, 2048), context = canvas.getContext('2d')!;
    context.fillStyle = '#6d7956'; context.fillRect(0, 0, 4096, 2048); context.fillStyle = '#d5b487'; context.fillRect(1200, 500, 1600, 1000);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' }), first = await uploadImage(blob);
    const secondCanvas = new OffscreenCanvas(240, 480), c2 = secondCanvas.getContext('2d')!; c2.fillStyle = '#7e6177'; c2.fillRect(0, 0, 240, 480);
    const second = await uploadImage(await secondCanvas.convertToBlob({ type: 'image/png' }));
    // Storage identity is authoritative even when the renderer URL is expired.
    const node: CanvasNodeData = { id: 'detail-fixture', type: CanvasNodeType.Image, title: '画布图片 作品', width: 400, height: 200, position: { x: 80, y: 140 }, metadata: {
        ...first, content: first.url, naturalWidth: 1, naturalHeight: 1, primaryImageId: 'first', model: 'provider::gpt-image-2', size: '4K@2:1', quality: 'high', prompt: '保留真实原图的细节与质感\n第二行提示词', images: [
            { id: 'first', status: 'success', content: 'blob:expired-fixture', storageKey: first.storageKey, naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: 'image/png' },
            { id: 'pending', status: 'loading', content: '', naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' },
            { id: 'second', status: 'success', content: second.url, storageKey: second.storageKey, naturalWidth: 240, naturalHeight: 480, bytes: second.bytes, mimeType: second.mimeType },
        ],
    } };
    function Fixture() {
        const [current, setCurrent] = useState(node), [open, setOpen] = useState(false), [imageId, setImageId] = useState<string | null>(null);
        const theme = useThemeStore(state => state.theme);
        Object.assign(window, { imageDetailsTest: {
            open: (id: string | null = null) => flushSync(() => { setImageId(id); setOpen(true); }),
            theme: (dark: boolean) => flushSync(() => useThemeStore.getState().setTheme(dark ? 'dark' : 'light')),
            missing: () => flushSync(() => { setCurrent({ ...node, metadata: { storageKey: 'image:missing', content: '', status: 'success' } }); setImageId(null); setOpen(true); }),
            recover: () => setImageBlob('image:missing', blob),
            remove: () => flushSync(() => setOpen(false)),
            bytes: async () => Array.from(new Uint8Array(await blob.arrayBuffer())),
            node: () => JSON.stringify(current),
            restore: () => flushSync(() => { setCurrent(node); setOpen(false); }),
        } });
        return <ConfigProvider theme={getAntThemeConfig(theme === 'dark')}><App><div className="h-screen" style={{ background: theme === 'dark' ? '#181715' : '#f4f2ed' }}>
            <button id="open-details" onClick={() => { setImageId(null); setOpen(true); }}>查看图片详情</button>
            <CanvasNode data={current} scale={1} isSelected isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false}
                onViewImage={(_node, id) => { setImageId(id || null); setOpen(true); }} onSelectCapture={() => {}} onMouseDown={() => {}} onResizeStart={() => {}} onResize={() => {}} onResizeEnd={() => {}} onHoverStart={() => {}} onHoverEnd={() => {}} onConnectStart={() => {}} onContentChange={() => {}} onTitleChange={() => {}} onContextMenu={() => {}} />
            <CanvasImageDetails node={open ? current : null} imageId={imageId} onSelect={setImageId} onClose={() => setOpen(false)} />
        </div></App></ConfigProvider>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture />);
}
void main();
