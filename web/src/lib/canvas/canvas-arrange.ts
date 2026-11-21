import { graphlib, layout } from "@dagrejs/dagre";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { nodeBounds } from "./canvas-node-geometry";

// Groups travel as a unit, including members that extend beyond their frame.
export function arrangeCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    if (nodes.length < 2) return nodes;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const roots = new Map<string, string>();
    const units = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        let root = node;
        const seen = new Set([node.id]);
        while (root.metadata?.groupId) {
            const parent = byId.get(root.metadata.groupId);
            if (!parent || parent.type !== CanvasNodeType.Group) break;
            if (seen.has(parent.id)) throw new Error("分组关系异常，请先解除循环分组后重试");
            seen.add(parent.id);
            root = parent;
        }
        roots.set(node.id, root.id);
        const members = units.get(root.id) || [];
        members.push(node);
        units.set(root.id, members);
    }
    if (units.size < 2) return nodes;
    const graph = new graphlib.Graph().setGraph({}).setDefaultEdgeLabel(() => ({}));
    const bounds = new Map([...units].map(([id, members]) => [id, nodeBounds(members)]));
    for (const id of units.keys()) graph.setNode(id, {});
    for (const link of connections) {
        const from = roots.get(link.fromNodeId), to = roots.get(link.toNodeId);
        if (from && to && from !== to) graph.setEdge(from, to);
    }
    const components = graphlib.alg.components(graph).map(ids => {
        const component = new graphlib.Graph().setGraph({ rankdir: "LR", nodesep: 80, ranksep: 120 }).setDefaultEdgeLabel(() => ({}));
        for (const id of ids) {
            const box = bounds.get(id)!;
            component.setNode(id, { width: box.right - box.left, height: box.bottom - box.top });
        }
        const members = new Set(ids);
        for (const edge of graph.edges()) if (members.has(edge.v) && members.has(edge.w)) component.setEdge(edge.v, edge.w);
        layout(component);
        return { graph: component, width: component.graph().width!, height: component.graph().height! };
    });
    const gap = 96;
    const rowWidth = Math.max(...components.map(item => item.width), Math.sqrt(components.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0)));
    const origin = nodeBounds(nodes);
    const positions = new Map<string, { x: number; y: number }>();
    let x = 0, y = 0, rowHeight = 0;
    for (const component of components) {
        if (x && x + component.width > rowWidth) { x = 0; y += rowHeight + gap; rowHeight = 0; }
        for (const id of component.graph.nodes()) {
            const placed = component.graph.node(id);
            const box = bounds.get(id)!;
            positions.set(id, { x: origin.left + x + placed.x - placed.width / 2 - box.left, y: origin.top + y + placed.y - placed.height / 2 - box.top });
        }
        x += component.width + gap;
        rowHeight = Math.max(rowHeight, component.height);
    }
    let changed = false;
    const arranged = nodes.map(node => {
        const delta = positions.get(roots.get(node.id)!)!;
        if (Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01) return node;
        changed = true;
        return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
    });
    return changed ? arranged : nodes;
}
