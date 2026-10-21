import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { bundleBuiltinPlugin, builtinPluginIds } from "../web/build/builtin-plugins.mjs";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
globalThis.InfiniteCanvasRuntime = { React };
const plugins = await Promise.all(builtinPluginIds.map(async id => {
    const source = await bundleBuiltinPlugin(id);
    return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
}));
const theme = { node: { text: "#333", muted: "#666", placeholder: "#777", fill: "#eee", stroke: "#ddd" }, toolbar: { panel: "#fff" } };
function context(node, upstream = []) {
    return { node, theme, getUpstream: () => upstream };
}

test("all five built-in plugins bundle without external imports and retain saved node contracts", () => {
    assert.deepEqual(plugins.map(p => p.id), builtinPluginIds);
    assert.equal(new Set(plugins.flatMap(p => p.nodes.map(n => n.type))).size, 5);
    assert.deepEqual(plugins.flatMap(p => p.nodes.map(n => n.type)), ["markdown:doc", "svg:vector", "html:render", "panorama:viewer", "sticky-note:note"]);
    for (const plugin of plugins) {
        const definition = plugin.nodes[0];
        assert.notEqual(definition.showInCreateMenu, false);
        const node = { type: definition.type, metadata: { ...definition.defaultMetadata } };
        assert.ok(renderToStaticMarkup(React.createElement(definition.Content, { ctx: context(node) })));
    }
});

test("HTML preserves its opaque sandbox and injects upstream input; SVG accepts upstream vectors", () => {
    const html = plugins.find(p => p.id === "html").nodes[0];
    const markup = renderToStaticMarkup(React.createElement(html.Content, { ctx: context({ metadata: { content: "<h1>{{input}}</h1>" } }, [{ metadata: { content: "from upstream" } }]) }));
    assert.match(markup, /sandbox="allow-scripts allow-forms"/);
    assert.doesNotMatch(markup, /allow-same-origin/);
    assert.match(markup, /&lt;h1&gt;from upstream&lt;\/h1&gt;/);
    const svg = plugins.find(p => p.id === "svg").nodes[0];
    assert.match(renderToStaticMarkup(React.createElement(svg.Content, { ctx: context({ metadata: {} }, [{ metadata: { content: '<svg><circle r="8"/></svg>' } }]) })), /<svg><circle/);
});

test("existing metadata is rendered unchanged and AI panorama still uses the host generation panel", () => {
    const markdown = plugins.find(p => p.id === "markdown").nodes[0];
    const mdNode = { metadata: { content: "# saved document", editing: true } };
    assert.match(renderToStaticMarkup(React.createElement(markdown.Content, { ctx: context(mdNode) })), /# saved document/);
    assert.equal(markdown.resource(mdNode).text, "# saved document");
    const note = plugins.find(p => p.id === "sticky-note").nodes[0];
    const noteNode = { metadata: { content: "saved note", pluginColor: "#fca5a5" } };
    const markup = renderToStaticMarkup(React.createElement(note.Content, { ctx: context(noteNode) }));
    assert.match(markup, /saved note/);
    assert.match(markup, /#fca5a5/);
    const panorama = plugins.find(p => p.id === "panorama").nodes[0];
    assert.equal(panorama.useBuiltinPanel.mode, "image");
    assert.equal(panorama.useBuiltinPanel.writeBackToSelf, true);
    assert.deepEqual(panorama.resource({ metadata: { content: "data:image/png;base64,fixture" } }), { kind: "image", url: "data:image/png;base64,fixture" });
});
