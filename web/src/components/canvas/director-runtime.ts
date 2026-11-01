import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { DirectorObject, DirectorScene, DirectorVector } from "@/types/director";

function disposeObject(root: THREE.Object3D) {
    root.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
}
function mannequin(material: THREE.Material, pose: DirectorObject["pose"]) {
    const group = new THREE.Group();
    const part = (geometry: THREE.BufferGeometry, position: DirectorVector) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); group.add(mesh); return mesh; };
    const bone = (a: DirectorVector, b: DirectorVector, radius: number) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
        const mesh = part(new THREE.CylinderGeometry(radius, radius * 0.9, direction.length(), 16), from.clone().add(to).multiplyScalar(0.5).toArray());
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        part(new THREE.SphereGeometry(radius * 1.08, 16, 12), b);
    };
    const seated = pose === "sit", hip = seated ? 0.55 : 0.94, shoulder = hip + 0.46;
    part(new THREE.SphereGeometry(0.14, 24, 18), [0, shoulder + 0.3, 0]);
    const torso = part(new THREE.SphereGeometry(1, 24, 18), [0, hip + 0.24, 0]); torso.scale.set(0.23, 0.32, 0.13);
    for (const side of [-1, 1]) {
        const x = side * 0.12, stride = pose === "walk" ? side * 0.23 : 0;
        const knee: DirectorVector = [x, seated ? hip : 0.52, seated ? 0.4 : stride];
        const ankle: DirectorVector = [x, 0.1, seated ? 0.43 : -stride];
        bone([x, hip, 0], knee, 0.09); bone(knee, ankle, 0.07);
        const foot = part(new THREE.BoxGeometry(0.14, 0.1, 0.25), [x, 0.05, ankle[2] + 0.06]); foot.rotation.x = 0;
        const elbow: DirectorVector = pose === "reach" ? [side * 0.3, shoulder - 0.08, 0.3] : [side * 0.31, shoulder - 0.25, -stride];
        const hand: DirectorVector = pose === "reach" ? [side * 0.27, shoulder - 0.02, 0.6] : [side * 0.3, shoulder - 0.5, stride];
        bone([side * 0.22, shoulder, 0], elbow, 0.055); bone(elbow, hand, 0.045);
    }
    return group;
}
function buildObject(object: DirectorObject) {
    const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: 0.72 });
    const group = object.kind === "person" ? mannequin(material, object.pose) : new THREE.Group();
    if (object.kind !== "person") {
        const geometry = object.kind === "box" ? new THREE.BoxGeometry(1, 1, 1) : object.kind === "sphere" ? new THREE.SphereGeometry(0.5, 32, 24) : new THREE.CylinderGeometry(0.4, 0.4, 1, 32);
        group.add(new THREE.Mesh(geometry, material));
    }
    group.position.fromArray(object.position); group.rotation.set(...object.rotation.map(THREE.MathUtils.degToRad) as DirectorVector); group.scale.fromArray(object.scale);
    group.userData.directorId = object.id;
    group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    return group;
}

export type DirectorRuntime = ReturnType<typeof createDirectorRuntime>;
export function createDirectorRuntime(container: HTMLElement, initial: DirectorScene, callbacks: { camera: (camera: DirectorScene["camera"]) => void; object: (id: string, patch: Partial<DirectorObject>) => void; select: (id: string | null) => void; error: (message: string) => void }) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "3D 导演台取景视窗"); renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);
    // Controls must use the actual shot rectangle, including portrait letterboxing.
    const surface = document.createElement("div"); surface.dataset.directorControls = ""; surface.style.cssText = "position:absolute;touch-action:none"; container.appendChild(surface);
    const scene = new THREE.Scene(), subjects = new THREE.Group(), helpers = new THREE.Group(); scene.add(subjects, helpers);
    const shot = new THREE.PerspectiveCamera(40, initial.width / initial.height, 0.01, 10000);
    const editor = new THREE.PerspectiveCamera(45, 1, 0.01, 10000); editor.position.set(6, 5, 8);
    const controls = new OrbitControls(shot, surface); controls.target.fromArray(initial.camera.target);
    const transform = new TransformControls(shot, surface); helpers.add(transform.getHelper());
    const cameraHelper = new THREE.CameraHelper(shot); helpers.add(cameraHelper);
    const grid = new THREE.GridHelper(100, 100, "#8c8881", "#b0aba2"); helpers.add(grid);
    const ambient = new THREE.HemisphereLight("#ffffff", "#6b6260", 2), key = new THREE.DirectionalLight("#ffffff", 3); scene.add(ambient, key);
    key.castShadow = true; key.shadow.mapSize.set(1024,1024); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.1, far: 80 }); key.shadow.bias = -0.0001;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: initial.floor, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; scene.add(floor);
    floor.receiveShadow = true;
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let state = initial, objects = new Map<string, THREE.Group>(), selected: string | null = null, mode: "camera" | "scene" = "camera", disposed = false, pending = 0, syncing = false, capturing = false;
    let width = 1, height = 1, pointerStart: [number, number] | null = null;
    const liveCamera = () => mode === "camera" ? shot : editor;
    const viewRect = () => { const ratio = state.width / state.height; return width / height > ratio ? { x: (width - height * ratio) / 2, y: 0, width: height * ratio, height } : { x: 0, y: (height - width / ratio) / 2, width, height: width / ratio }; };
    function draw() {
        if (disposed || capturing || renderer.getContext().isContextLost()) return;
        renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.clear();
        cameraHelper.visible = mode === "scene"; grid.visible = state.grid;
        const rect = mode === "camera" ? viewRect() : { x: 0, y: 0, width, height };
        Object.assign(surface.style, { left: `${rect.x}px`, top: `${height - rect.y - rect.height}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        renderer.setViewport(rect.x, rect.y, rect.width, rect.height); renderer.setScissor(rect.x, rect.y, rect.width, rect.height); renderer.setScissorTest(true); renderer.render(scene, liveCamera());
        if (mode === "scene") {
            helpers.visible = false;
            const w = Math.min(width * 0.32, 260), h = w / shot.aspect;
            renderer.setViewport(width - w - 12, 12, w, h); renderer.setScissor(width - w - 12, 12, w, h); renderer.render(scene, shot); helpers.visible = true;
        }
        renderer.setScissorTest(false);
    }
    const render = () => { if (!pending && !disposed) pending = requestAnimationFrame(() => { pending = 0; draw(); }); };
    const commitCamera = () => { if (!syncing && mode === "camera") callbacks.camera({ position: shot.position.toArray(), target: controls.target.toArray(), lens: state.camera.lens }); };
    controls.addEventListener("change", render); controls.addEventListener("end", commitCamera);
    transform.addEventListener("dragging-changed", event => { controls.enabled = !event.value; });
    transform.addEventListener("change", render);
    transform.addEventListener("mouseUp", () => {
        const object = transform.object;
        if (object && selected) callbacks.object(selected, { position: object.position.toArray(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(THREE.MathUtils.radToDeg) as DirectorVector, scale: object.scale.toArray() });
    });
    const down = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const up = (event: PointerEvent) => {
        if (event.button !== 0 || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 4 || transform.axis) return;
        const bounds = renderer.domElement.getBoundingClientRect(), x = event.clientX - bounds.left, y = bounds.height - (event.clientY - bounds.top);
        if (mode === "scene") { const w = Math.min(width * 0.32, 260); if (x >= width - w - 12 && x <= width - 12 && y >= 12 && y <= 12 + w / shot.aspect) return; }
        const rect = mode === "camera" ? viewRect() : { x: 0, y: 0, width, height };
        if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return;
        pointer.set((x - rect.x) / rect.width * 2 - 1, (y - rect.y) / rect.height * 2 - 1); raycaster.setFromCamera(pointer, liveCamera());
        let hit: THREE.Object3D | null | undefined = raycaster.intersectObjects(subjects.children, true)[0]?.object;
        while (hit && !hit.userData.directorId) hit = hit.parent;
        callbacks.select(hit?.userData.directorId || null);
    };
    const contextLost = (event: Event) => { event.preventDefault(); callbacks.error("三维渲染已中断，请关闭导演台后重新打开；场景设置已保留"); };
    surface.addEventListener("pointerdown", down); surface.addEventListener("pointerup", up); renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const resize = new ResizeObserver(() => { width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight); renderer.setSize(width, height, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; editor.aspect = width / height; editor.updateProjectionMatrix(); render(); }); resize.observe(container);
    function update(next: DirectorScene, selection: string | null) {
        state = next; selected = selection; syncing = true;
        try {
            const attached = transform.object?.userData.directorId;
            for (const [id, object] of objects) if (!next.objects.some(item => item.id === id && JSON.stringify(item) === object.userData.source)) { if (attached === id) transform.detach(); subjects.remove(object); disposeObject(object); objects.delete(id); }
            for (const item of next.objects) if (!objects.has(item.id)) { const object = buildObject(item); object.userData.source = JSON.stringify(item); objects.set(item.id, object); subjects.add(object); }
            const target = selected && objects.get(selected); if (target) { if (transform.object !== target) transform.attach(target); } else transform.detach();
            shot.aspect = next.width / next.height; shot.setFocalLength(next.camera.lens); shot.position.fromArray(next.camera.position); shot.lookAt(new THREE.Vector3(...next.camera.target)); shot.updateProjectionMatrix();
            if (mode === "camera") { controls.target.fromArray(next.camera.target); controls.update(); }
            const azimuth = THREE.MathUtils.degToRad(next.light.azimuth), elevation = THREE.MathUtils.degToRad(next.light.elevation);
            key.position.set(Math.sin(azimuth) * Math.cos(elevation) * 10, Math.sin(elevation) * 10, Math.cos(azimuth) * Math.cos(elevation) * 10); key.intensity = next.light.intensity;
            scene.background = new THREE.Color(next.background); floor.material.color.set(next.floor); cameraHelper.update(); render();
        } finally { syncing = false; }
    }
    update(initial, null);
    return {
        update,
        mode(value: "camera" | "scene") { mode = value; controls.object = liveCamera(); transform.camera = liveCamera(); syncing = true; if (mode === "camera") controls.target.fromArray(state.camera.target); controls.update(); syncing = false; render(); },
        transform(value: "translate" | "rotate" | "scale") { transform.setMode(value); render(); },
        adoptView() { callbacks.camera({ position: editor.position.toArray(), target: controls.target.toArray(), lens: state.camera.lens }); },
        async capture() {
            if (disposed || capturing || renderer.getContext().isContextLost()) throw new Error("三维渲染尚未就绪，请重新打开导演台");
            const context = renderer.getContext(), maxSize = Math.min(context.getParameter(context.MAX_TEXTURE_SIZE), context.getParameter(context.MAX_RENDERBUFFER_SIZE));
            const viewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array;
            if (state.width > Math.min(maxSize, viewport[0]) || state.height > Math.min(maxSize, viewport[1])) throw new Error(`当前显卡不支持 ${state.width} × ${state.height} 输出，请手动调整尺寸；不会自动降低分辨率`);
            capturing = true; controls.enabled = false; transform.enabled = false;
            try {
                helpers.visible = false; renderer.setScissorTest(false); renderer.setSize(state.width, state.height, false); renderer.setViewport(0, 0, state.width, state.height); renderer.render(scene, shot);
                if (renderer.domElement.width !== state.width || renderer.domElement.height !== state.height) throw new Error("无法分配指定尺寸的图像，请释放显存后重试");
                const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("取景图导出失败，请重试")), "image/png"));
                if (disposed || context.isContextLost()) throw new Error("导出已中断，场景设置保持不变");
                return blob;
            } finally { capturing = false; helpers.visible = true; controls.enabled = true; transform.enabled = true; if (!disposed) { renderer.setSize(width, height, false); render(); } }
        },
        dispose() { disposed = true; cancelAnimationFrame(pending); resize.disconnect(); controls.dispose(); transform.dispose(); surface.removeEventListener("pointerdown", down); surface.removeEventListener("pointerup", up); surface.remove(); renderer.domElement.removeEventListener("webglcontextlost", contextLost); disposeObject(scene); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); objects.clear(); },
    };
}
