import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import { changeAppLocale, type AppLocale } from '@/i18n';
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
    const secondCanvas = new OffscreenCanvas(240, 480), c2 = secondCanvas.getContext('2d')!; c2.fillStyle = '#7e6177'; c2.fillRect(0, 0, 240, 480); c2.clearRect(0, 0, 30, 30);
    const second = await uploadImage(await secondCanvas.convertToBlob({ type: 'image/png' }));
    // Storage identity is authoritative even when the renderer URL is expired.
    const node: CanvasNodeData = { id: 'detail-fixture', type: CanvasNodeType.Image, title: '画布图片 作品', width: 400, height: 200, position: { x: 80, y: 140 }, metadata: {
        ...first, content: first.url, naturalWidth: 1, naturalHeight: 1, primaryImageId: 'first', model: 'provider::gpt-image-2', size: '4K@2:1', quality: 'high', prompt: '保留真实原图的细节与质感\n第二行提示词', images: [
            { id: 'first', status: 'success', content: 'blob:expired-fixture', storageKey: first.storageKey, naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: 'image/png' },
            { id: 'pending', status: 'loading', content: '', naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' },
            { id: 'second', status: 'success', content: second.url, storageKey: second.storageKey, naturalWidth: 240, naturalHeight: 480, bytes: second.bytes, mimeType: second.mimeType },
        ],
    } };
    let pasted: { width: number; height: number; alpha: number } | null = null, drags = 0, downloadedImageId: string | null = null;
    function Fixture() {
        const [current, setCurrent] = useState(node), [open, setOpen] = useState(false), [imageId, setImageId] = useState<string | null>(null);
        const [expanded, setExpanded] = useState(false), [scale, setScale] = useState(1);
        const theme = useThemeStore(state => state.theme);
        Object.assign(window, { imageDetailsTest: {
            open: (id: string | null = null) => flushSync(() => { setImageId(id); setOpen(true); }),
            theme: (dark: boolean) => flushSync(() => useThemeStore.getState().setTheme(dark ? 'dark' : 'light')),
            missing: () => flushSync(() => { setCurrent({ ...node, metadata: { storageKey: 'image:missing', content: '', status: 'success' } }); setImageId(null); setOpen(true); }),
            recover: () => setImageBlob('image:missing', blob),
            remove: () => flushSync(() => setOpen(false)),
            bytes: async () => Array.from(new Uint8Array(await blob.arrayBuffer())),
            node: () => JSON.stringify(current),
            restore: () => flushSync(() => { setCurrent(node); setExpanded(false); setScale(1); setImageId(null); setOpen(false); }),
            expanded: (value: boolean) => flushSync(() => { setExpanded(value); setCurrent(value ? { ...node, width: 240, height: 120 } : node); }),
            size: (width: number, zoom: number) => flushSync(() => { setCurrent({ ...node, width }); setScale(zoom); }),
            locale: async (value: AppLocale) => { await changeAppLocale(value); },
            downloadedImageId: () => downloadedImageId,
            plain: () => flushSync(() => setCurrent({ ...node, metadata: { content: 'blob:expired-fixture', storageKey: first.storageKey } })),
            missingCopy: () => flushSync(() => setCurrent({ ...node, metadata: { content: 'blob:missing-fixture', storageKey: 'image:absent-copy' } })),
            pasted: () => pasted,
            clearPaste: () => { pasted = null; },
            drags: () => drags,
        } });
        return <ConfigProvider theme={getAntThemeConfig(theme === 'dark')}><App><div className="h-screen" style={{ background: theme === 'dark' ? '#181715' : '#f4f2ed' }}>
            <button id="open-details" onClick={() => { setImageId(null); setOpen(true); }}>查看图片详情</button>
            <div className="relative origin-top-left" style={{ transform: `scale(${scale})` }}>
                <CanvasNode data={current} scale={scale} batchExpanded={expanded} isSelected isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false}
                    onViewImage={(_node, id) => { setImageId(id || null); setOpen(true); }} onSelectCapture={() => {}} onMouseDown={() => { drags++; }} onResizeStart={() => {}} onResize={() => {}} onResizeEnd={() => {}} onHoverStart={() => {}} onHoverEnd={() => {}} onConnectStart={() => {}} onContentChange={() => {}} onTitleChange={() => {}} onContextMenu={() => {}}
                    onToggleBatch={() => setExpanded(value => !value)} onDownloadBatchImage={(_node, id) => { downloadedImageId = id; }} />
            </div>
            <textarea id="paste-image-target" aria-label="粘贴图片测试" className="absolute bottom-2 left-2" onPaste={event => {
                const file = event.clipboardData.files[0]; event.preventDefault();
                if (file) void createImageBitmap(file).then(bitmap => { const surface = new OffscreenCanvas(bitmap.width, bitmap.height), context = surface.getContext('2d')!; context.drawImage(bitmap, 0, 0); pasted = { width: bitmap.width, height: bitmap.height, alpha: context.getImageData(0, 0, 1, 1).data[3] }; bitmap.close(); });
            }} />
            <CanvasImageDetails node={open ? current : null} imageId={imageId} onSelect={setImageId} onClose={() => setOpen(false)} />
        </div></App></ConfigProvider>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture />);
}
void main();
