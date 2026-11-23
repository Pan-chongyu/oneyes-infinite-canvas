import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { App, Button, Modal } from 'antd';
import { ChevronLeft, ChevronRight, Copy, Download, ImageOff, Info, LoaderCircle, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { saveAs } from 'file-saver';
import { fileTypeFromBlob } from 'file-type/core';
import { useCopyText } from '@/hooks/use-copy-text';
import { canvasThemes } from '@/lib/canvas-theme';
import { detailImages, detailImageIndex, imageAspectRatio } from '@/lib/canvas/canvas-image-details';
import { formatBytes } from '@/lib/image-utils';
import { fetchImageBlob, getImageBlob } from '@/services/image-storage';
import { useThemeStore } from '@/stores/use-theme-store';
import { modelOptionName } from '@/stores/use-config-store';
import type { CanvasNodeData } from '@/types/canvas';
import { useImageEditorViewport } from './use-image-editor-viewport';

export function CanvasImageDetails({ node, imageId, onSelect, onClose }: { node: CanvasNodeData | null; imageId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore(state => state.theme)], images = node ? detailImages(node) : [];
    const index = node ? detailImageIndex(node, imageId) : 0, image = images[index];
    return <Modal title={<div className="min-w-0 pr-8"><div className="flex items-center gap-2 text-base"><span className="truncate">{node?.title || '图片详情'}</span>{images.length > 1 && <span className="shrink-0 text-xs font-normal tabular-nums" style={{ color: theme.node.muted }}>{index + 1} / {images.length}</span>}</div><p className="mt-1 text-xs font-normal" style={{ color: theme.node.muted }}>图片详情 · 原图预览</p></div>} open={Boolean(node)} onCancel={onClose} footer={null} centered width={1140} destroyOnHidden
        styles={{ container: { background: theme.node.panel, color: theme.node.text }, header: { background: 'transparent' }, body: { padding: 0 } }}
        modalRender={modal => <div data-canvas-shortcuts-ignore onMouseDown={event => event.stopPropagation()}>{modal}</div>}>
        {node && image ? <ImageDetailContent key={`${node.id}:${image.id}:${image.storageKey || ''}:${image.content}`} node={node} image={image} index={index} count={images.length} onStep={step => { const next = images[index + step]; if (next) onSelect(next.id); }} /> : <p role="status" className="py-16 text-center">暂无可查看的图片</p>}
    </Modal>;
}

function ImageDetailContent({ node, image, index, count, onStep }: { node: CanvasNodeData; image: ReturnType<typeof detailImages>[number]; index: number; count: number; onStep: (step: number) => void }) {
    const theme = canvasThemes[useThemeStore(state => state.theme)], copyText = useCopyText(), { message } = App.useApp();
    const [original, setOriginal] = useState<{ url: string; blob: Blob; extension: string; mime: string } | null>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [showInfo, setShowInfo] = useState(true);
    const viewport = useImageEditorViewport(dimensions, true, { actualSize: true, dragToPan: true });
    const ready = Boolean(original && dimensions && !error);
    const contentRef = useRef<HTMLElement>(null);
    useEffect(() => { if (ready) contentRef.current?.querySelector<HTMLElement>('[role=region]')?.focus({ preventScroll: true }); }, [ready]);
    const prompt = node.metadata?.prompt?.trim(), model = node.metadata?.model ? modelOptionName(node.metadata.model) : '';
    const quality = node.metadata?.quality, qualityLabel = quality ? ({ auto: '自动', low: '低', medium: '中', high: '高', standard: '标准', hd: '高清' }[quality] || quality) : '';
    useEffect(() => {
        const abort = new AbortController(); let url = '';
        setOriginal(null); setDimensions(null); setError(false);
        void (async () => {
            const local = image.storageKey ? await getImageBlob(image.storageKey) : null;
            const blob = local || (image.content ? await fetchImageBlob(image.content, { signal: abort.signal }) : null);
            if (!blob) throw Error('Missing original');
            const type = await fileTypeFromBlob(blob);
            if (abort.signal.aborted) return;
            const mime = type?.mime || (blob.type.startsWith('image/') ? blob.type : '');
            url = URL.createObjectURL(blob);
            setOriginal({ url, blob, mime, extension: type?.ext || (mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1]) || 'image' });
        })().catch(() => { if (!abort.signal.aborted) setError(true); });
        return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
    }, [image.storageKey, image.content, attempt]);
    const keyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); event.stopPropagation(); onStep(event.key === 'ArrowLeft' ? -1 : 1);
        }
        if (['+', '=', '-', '0', '1'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (!ready) return;
            if (event.key === '-') viewport.zoomOut(); else if (event.key === '0') viewport.resetZoom(); else if (event.key === '1') viewport.actualSize(); else viewport.zoomIn();
        }
    };
    const download = () => {
        if (!original || !ready) return;
        try { saveAs(original.blob, `${node.title || '画布图片'}${count > 1 ? `-${index + 1}` : ''}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i, '') + '.' + original.extension); }
        catch { message.error('下载失败，请重试'); }
    };
    return <section ref={contentRef} aria-label="图片详情内容" className="flex h-[min(76vh,780px)] min-h-0 flex-col" onKeyDown={keyDown}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b pb-2" style={{ borderColor: theme.node.stroke }}>
            <div className="flex items-center gap-0.5">
                <Button type="text" aria-label="上一张" title="上一张（←）" icon={<ChevronLeft size={16} />} disabled={!index} onClick={() => onStep(-1)} />
                <Button type="text" aria-label="下一张" title="下一张（→）" icon={<ChevronRight size={16} />} disabled={index >= count - 1} onClick={() => onStep(1)} />
                <span className="mx-1 h-4 border-l" style={{ borderColor: theme.node.stroke }} />
                <Button type="text" aria-label="缩小图片" title="缩小（−）" icon={<ZoomOut size={16} />} disabled={!ready || !viewport.canZoomOut} onClick={viewport.zoomOut} />
                <span aria-live="polite" className="w-12 text-center text-xs tabular-nums">{ready ? `${Math.round(viewport.imageScale * 100)}%` : '—'}</span>
                <Button type="text" aria-label="放大图片" title="放大（+）" icon={<ZoomIn size={16} />} disabled={!ready || !viewport.canZoomIn} onClick={viewport.zoomIn} />
                <Button type="text" title="适应窗口（0）" aria-label="适应窗口" icon={<Scan size={15} />} disabled={!ready} onClick={viewport.resetZoom} />
                <Button type="text" title="原始大小（1）" disabled={!ready} onClick={viewport.actualSize}>1:1</Button>
            </div>
            <div className="flex items-center gap-1">
                <Button type="text" icon={<Info size={15} />} aria-pressed={showInfo} onClick={() => setShowInfo(value => !value)}>信息</Button>
                <Button type="text" icon={<Download size={15} />} disabled={!ready} onClick={download}>下载原图</Button>
            </div>
        </div>
        <div className={`grid min-h-0 flex-1 ${showInfo ? 'grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]' : 'grid-cols-1'}`}>
            <div className="relative min-h-0 min-w-0" style={{ background: theme.canvas.background }}>
                <div ref={viewport.viewportRef} {...viewport.panHandlers} tabIndex={0} role="region" aria-label="图片预览，滚轮缩放，拖动查看细节" className={`h-full min-h-[180px] outline-offset-[-3px] ${viewport.scrollClassName} ${viewport.isPanning ? 'cursor-grabbing' : ready ? 'cursor-grab' : ''}`} onDoubleClick={() => ready && (viewport.zoom > 1 ? viewport.resetZoom() : viewport.actualSize())}>
                    <div className="relative" style={viewport.contentStyle}>
                        {original && <div ref={viewport.stageRef} className="absolute" style={viewport.stageStyle}><img src={original.url} alt={node.title || '画布图片'} draggable={false} className="pointer-events-none block max-w-none select-none" style={viewport.mediaStyle} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError(true)} /></div>}
                    </div>
                </div>
                {(!ready || error) && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: theme.node.muted }}>
                    {error ? <><ImageOff size={26} /><p role="alert">原图暂时无法读取，请确认素材仍在本机或网络已恢复</p><Button type="text" className="pointer-events-auto" onClick={() => setAttempt(value => value + 1)}>重新读取</Button></> : <><LoaderCircle size={24} className="animate-spin motion-reduce:animate-none" /><p role="status">正在读取原图…</p></>}
                </div>}
            </div>
            {showInfo && <aside aria-label="图片信息" className="thin-scrollbar max-h-[28vh] min-h-0 space-y-5 overflow-auto border-t p-4 text-sm md:max-h-none md:border-l md:border-t-0" style={{ borderColor: theme.node.stroke }}>
                <div><h3 className="mb-3 text-xs font-medium" style={{ color: theme.node.muted }}>文件信息</h3><dl className="space-y-2.5">
                    <DetailRow label="原图尺寸" value={dimensions ? `${dimensions.width} × ${dimensions.height} px` : '—'} />
                    <DetailRow label="宽高比例" value={dimensions ? imageAspectRatio(dimensions.width, dimensions.height) : '—'} />
                    <DetailRow label="文件大小" value={original ? formatBytes(original.blob.size) : '—'} />
                    <DetailRow label="图片格式" value={original?.mime ? original.mime.replace('image/', '').toUpperCase() : '—'} />
                </dl></div>
                {(model || node.metadata?.size || qualityLabel) && <div><h3 className="mb-3 text-xs font-medium" style={{ color: theme.node.muted }}>生成参数</h3><dl className="space-y-2.5">{model && <DetailRow label="模型" value={model} />}{node.metadata?.size && <DetailRow label="请求尺寸" value={node.metadata.size} />}{qualityLabel && <DetailRow label="生成质量" value={qualityLabel} />}</dl></div>}
                <div><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium" style={{ color: theme.node.muted }}>生成提示词</h3><Button type="text" size="small" aria-label="复制提示词" icon={<Copy size={13} />} disabled={!prompt} onClick={() => prompt && copyText(prompt)}>复制</Button></div><p className="select-text whitespace-pre-wrap break-words text-xs leading-6" style={{ color: prompt ? theme.node.text : theme.node.muted }}>{prompt || '这张图片没有保存生成提示词'}</p></div>
                {image.resolutionWarning && <p role="note" className="text-xs leading-5" style={{ color: theme.node.muted }}>{image.resolutionWarning}</p>}
            </aside>}
        </div>
        <p className="shrink-0 border-t pt-2 text-center text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>滚轮缩放 · 拖动查看 · 双击切换原始大小 · Esc 关闭</p>
    </section>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    return <div className="flex items-start justify-between gap-4 text-xs leading-5"><dt className="shrink-0" style={{ color: theme.node.muted }}>{label}</dt><dd className="min-w-0 select-text break-words text-right">{value}</dd></div>;
}
