import assert from "node:assert/strict";
import test from "node:test";
import { arrangeCanvasNodes } from "./canvas-arrange";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

const node = (id: string, type = CanvasNodeType.Image, width = 320, height = 240): CanvasNodeData => ({
    id, type, title: id, position: { x: -200, y: 180 }, width, height, metadata: { content: id, status: "loading", storageKey: id },
});
const links: CanvasConnection[] = [
    { id: "a-b", fromNodeId: "a", toNodeId: "b" }, { id: "b-c", fromNodeId: "b", toNodeId: "c" },
];
function disjoint(nodes: CanvasNodeData[]) {
    for (const first of nodes) for (const second of nodes) if (first.id !== second.id) {
        assert.ok(first.position.x + first.width <= second.position.x || second.position.x + second.width <= first.position.x ||
            first.position.y + first.height <= second.position.y || second.position.y + second.height <= first.position.y, `${first.id} overlaps ${second.id}`);
    }
}

test("arranges connected nodes left to right, packs disconnected nodes and remains stable", () => {
    const nodes = [node("c", CanvasNodeType.Video, 420, 700), node("a"), node("b", CanvasNodeType.Config, 600, 250), ...Array.from({ length: 9 }, (_, index) => node(`free-${index}`))];
    const original = structuredClone(nodes);
    const arranged = arrangeCanvasNodes(nodes, [...links, { id: "stale", fromNodeId: "deleted", toNodeId: "a" }]);
    const find = (id: string) => arranged.find(item => item.id === id)!;
    assert.ok(find("a").position.x + find("a").width < find("b").position.x);
    assert.ok(find("b").position.x + find("b").width < find("c").position.x);
    disjoint(arranged);
    assert.ok(new Set(arranged.filter(item => item.id.startsWith("free")).map(item => item.position.x)).size > 1, "loose nodes occupy multiple columns");
    assert.deepEqual(nodes, original, "source remains available for undo");
    arranged.forEach((item, index) => { assert.equal(item.metadata, nodes[index].metadata); assert.equal(item.width, nodes[index].width); assert.equal(item.height, nodes[index].height); });
    assert.equal(arrangeCanvasNodes(arranged, links), arranged, "repeated arrange is a no-op");
});

test("groups keep all member offsets and frame sizes while external connections route the whole group", () => {
    const group = { ...node("g", CanvasNodeType.Group, 800, 500), position: { x: 80, y: 150 } };
    const a = { ...node("a"), position: { x: 104, y: 202 }, metadata: { groupId: "g" } };
    const b = { ...node("b"), position: { x: 600, y: 600 }, metadata: { groupId: "g" } };
    const nodes = [group, a, b, node("c"), node("orphan", CanvasNodeType.Text)];
    nodes[4].metadata = { groupId: "missing" };
    const arranged = arrangeCanvasNodes(nodes, links);
    for (let index = 1; index <= 2; index++) {
        assert.equal(arranged[index].position.x - arranged[0].position.x, nodes[index].position.x - group.position.x);
        assert.equal(arranged[index].position.y - arranged[0].position.y, nodes[index].position.y - group.position.y);
    }
    assert.equal(arranged[0].width, group.width);
    disjoint([arranged[0], arranged[3], arranged[4]]);
    assert.ok(arranged[3].position.x > arranged[2].position.x + arranged[2].width, "outside-group members are included in layout bounds");
    assert.equal(arrangeCanvasNodes([group, a, b], links)[0], group);
});

test("cycles, self links and empty canvases never create invalid coordinates", () => {
    assert.deepEqual(arrangeCanvasNodes([], []), []);
    const nodes = [node("a"), node("b"), node("c")];
    const arranged = arrangeCanvasNodes(nodes, [...links, { id: "cycle", fromNodeId: "c", toNodeId: "a" }, { id: "self", fromNodeId: "a", toNodeId: "a" }]);
    disjoint(arranged);
    arranged.forEach(item => assert.ok(Number.isFinite(item.position.x) && Number.isFinite(item.position.y)));
    const broken = [{ ...node("g", CanvasNodeType.Group), metadata: { groupId: "h" } }, { ...node("h", CanvasNodeType.Group), metadata: { groupId: "g" } }];
    assert.throws(() => arrangeCanvasNodes(broken, []), /分组关系异常/);
});
