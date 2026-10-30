// OneYes Canvas 单文件节点示例。修改 id 和 type 后即可制作自己的插件。
// 不需要 npm、构建工具或单独的 React；将此文件拖入画布即可安装。
export default function ({ React }) {
    const h = React.createElement;
    function Content({ ctx }) {
        return h('div', {
            'data-canvas-no-zoom': true,
            onPointerDown: event => event.stopPropagation(),
            onMouseDown: event => event.stopPropagation(),
            onWheel: event => event.stopPropagation(),
            style: { height: '100%', padding: 12, boxSizing: 'border-box', color: ctx.theme.node.text },
        }, h('textarea', {
            'aria-label': '我的笔记',
            value: ctx.node.metadata?.content || '',
            placeholder: '写点什么，内容会随画布保存…',
            onChange: event => ctx.updateMetadata({ content: event.target.value }),
            style: { width: '100%', height: '100%', resize: 'none', border: 0, background: 'transparent', color: 'inherit', font: 'inherit', lineHeight: 1.6 },
        }));
    }
    return {
        id: 'my-quick-note',
        name: '我的笔记',
        version: '1.0.0',
        description: '可编辑、随画布保存的自定义文本节点示例',
        nodes: [{
            type: 'my-quick-note:note',
            title: '我的笔记',
            icon: h('span', { 'aria-hidden': true }, 'Aa'),
            defaultSize: { width: 280, height: 200 },
            defaultMetadata: { content: '' },
            hidePanel: true,
            resource: node => ({ kind: 'text', text: node.metadata?.content || '' }),
            Content,
        }],
    };
}
