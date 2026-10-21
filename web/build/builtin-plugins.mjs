import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(webDir, "package.json"));
export const builtinPluginIds = ["markdown", "svg", "html", "panorama", "sticky-note"];

// Compile the existing SDK plugins with the host React bridge and local dependencies.
// No registry, CDN import, or separate installation is needed at runtime.
export async function bundleBuiltinPlugin(id) {
    if (!builtinPluginIds.includes(id)) throw new Error(`Unknown built-in plugin: ${id}`);
    const result = await build({
        entryPoints: [resolve(webDir, `../plugins/canvas/${id}/src/index.tsx`)],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        jsx: "automatic",
        jsxImportSource: "@infinite-canvas/plugin-sdk",
        loader: { ".css": "text" },
        plugins: [{
            name: "host-plugin-sdk",
            setup(builder) {
                builder.onResolve({ filter: /^https:\/\/esm\.sh\// }, ({ path }) => {
                    const dependency = { "https://esm.sh/marked@14": "marked", "https://esm.sh/three@0.180.0": "three" }[path];
                    if (!dependency) throw new Error(`Unpackaged built-in dependency: ${path}`);
                    return { path: require.resolve(dependency) };
                });
                builder.onResolve({ filter: /^@infinite-canvas\/plugin-sdk(?:\/|$)/ }, ({ path }) => ({
                    path: resolve(webDir, `../plugins/canvas/sdk/src/${path.split("/")[2] || "index"}.ts`),
                }));
            },
        }],
        metafile: true,
        minify: true,
    });
    const external = Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => item.external);
    if (external.length) throw new Error(`Built-in plugin ${id} has unpackaged imports: ${external.map(item => item.path).join(", ")}`);
    return result.outputFiles[0].text;
}

export function builtinPlugins() {
    const prefix = "virtual:canvas-builtin-plugins";
    return {
        name: "canvas-builtin-plugins",
        resolveId(id) {
            if (id === prefix || builtinPluginIds.some(name => id === `${prefix}/${name}`)) return `\0${id}`;
        },
        async load(id) {
            if (id === `\0${prefix}`) {
                return builtinPluginIds.map((name, i) => `import p${i} from ${JSON.stringify(`${prefix}/${name}`)};`).join("\n") +
                    `\nexport default [${builtinPluginIds.map((_, i) => `p${i}`).join(",")}];`;
            }
            if (id.startsWith(`\0${prefix}/`)) return bundleBuiltinPlugin(id.slice(`\0${prefix}/`.length));
        },
    };
}
