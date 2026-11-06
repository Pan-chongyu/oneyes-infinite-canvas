import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '@/i18n';
import '@/styles/globals.css';
import { CanvasNode } from '@/components/canvas/canvas-node';
import { InfiniteCanvas } from '@/components/canvas/infinite-canvas';
import { useThemeStore } from '@/stores/use-theme-store';
import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';

function Fixture() {
    const container = useRef<HTMLDivElement>(null), events = useRef({ selection: 0, drag: 0, resize: 0, background: 0, viewport: 0 });
    const [scale, setScale] = useState(1);
    const node: CanvasNodeData = { id: 'playback', type: CanvasNodeType.Video, title: '视频', position: { x: 100, y: 100 }, width: 520, height: 320, metadata: { content: '/sample.mp4', status: 'success' } };
    Object.assign(window, { playbackTest: {
        events: () => events.current,
        configure: (scale: number, dark: boolean) => flushSync(() => { setScale(scale); useThemeStore.getState().setTheme(dark ? 'dark' : 'light'); events.current = { selection: 0, drag: 0, resize: 0, background: 0, viewport: 0 }; }),
    } });
    return <main style={{ height: '100vh' }}><InfiniteCanvas containerRef={container} viewport={{ x: 20, y: 50, k: scale }} tool="select" onViewportChange={() => { events.current.viewport++; }} onCanvasMouseDown={() => { events.current.background++; }}>
        <CanvasNode data={node} scale={scale} isSelected isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false}
            onSelectCapture={() => { events.current.selection++; }} onMouseDown={event => { event.stopPropagation(); events.current.drag++; }}
            onResizeStart={() => { events.current.resize++; }} onResize={() => {}} onResizeEnd={() => {}} onHoverStart={() => {}} onHoverEnd={() => {}} onConnectStart={() => {}} onContentChange={() => {}} onTitleChange={() => {}} onContextMenu={() => {}} />
    </InfiniteCanvas></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
