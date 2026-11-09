import * as THREE from "three";
import { createDirectorModel, directorModelShape, updateDirectorModel } from "./director-models";
import { shotScene } from "@/lib/canvas/director-sequence";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SobelOperatorShader } from 'three/addons/shaders/SobelOperatorShader.js';
import { LuminosityShader } from 'three/addons/shaders/LuminosityShader.js';
import type { DirectorObject, DirectorOutput, DirectorScene, DirectorVector } from "@/types/director";

function disposeObject(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
export type DirectorRuntime = ReturnType<typeof createDirectorRuntime>;
export type DirectorTool = "select" | "translate" | "rotate" | "scale";
export function createDirectorRuntime(container: HTMLElement, initial: DirectorScene, callbacks: { camera: (camera: DirectorScene["camera"]) => void; object: (id: string, patch: Partial<DirectorObject>) => void; select: (id: string | null) => void; error: (message: string) => void }) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "3D 导演台取景视窗"); renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);
    // Controls must use the actual shot rectangle, including portrait letterboxing.
    const surface = document.createElement("div"); surface.dataset.directorControls = ""; surface.style.cssText = "position:absolute;touch-action:none"; container.appendChild(surface);
    const guide = document.createElement("div"); guide.dataset.directorGuide = ""; guide.style.cssText = "position:absolute;inset:0;pointer-events:none"; surface.appendChild(guide);
    const scene = new THREE.Scene(), subjects = new THREE.Group(), helpers = new THREE.Group(); scene.add(subjects, helpers);
    const shot = new THREE.PerspectiveCamera(40, initial.width / initial.height, 0.01, 10000);
    const editor = new THREE.PerspectiveCamera(45, 1, 0.01, 10000); editor.position.set(6, 5, 8);
    const controls = new OrbitControls(shot, surface); controls.target.fromArray(initial.camera.target);
    const transform = new TransformControls(shot, surface); helpers.add(transform.getHelper());
    let tool: DirectorTool = "select";
    const cameraHelper = new THREE.CameraHelper(shot); helpers.add(cameraHelper);
    const selection = new THREE.Box3Helper(new THREE.Box3(), 0xd5a454); helpers.add(selection); selection.visible = false;
    const paths = new THREE.Group(); helpers.add(paths);
    let pathShots: DirectorScene["shots"];
    const grid = new THREE.GridHelper(100, 100, "#8c8881", "#b0aba2"); helpers.add(grid);
    const ambient = new THREE.HemisphereLight("#ffffff", "#6b6260", 2), key = new THREE.DirectionalLight("#ffffff", 3); scene.add(ambient, key);
    const fill = new THREE.DirectionalLight("#dce8ff", 0), rim = new THREE.DirectionalLight("#ffffff", 0); fill.position.set(7, 4, 3); rim.position.set(-3, 5, -7); scene.add(fill, rim);
    key.castShadow = true; key.shadow.mapSize.set(1024,1024); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.1, far: 80 }); key.shadow.bias = -0.0001;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: initial.floor, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; scene.add(floor);
    floor.receiveShadow = true;
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const editorTarget = new THREE.Vector3(0, 0.95, 0);
    let state = initial, objects = new Map<string, THREE.Group>(), selected: string | null = null, mode: "camera" | "scene" = "camera", disposed = false, pending = 0, syncing = false, capturing = false;
    let width = 1, height = 1, pointerStart: [number, number] | null = null, interactive = true;
    const liveCamera = () => mode === "camera" ? shot : editor;
    const viewRect = () => { const ratio = state.width / state.height; return width / height > ratio ? { x: (width - height * ratio) / 2, y: 0, width: height * ratio, height } : { x: 0, y: (height - width / ratio) / 2, width, height: width / ratio }; };
    function draw() {
        if (disposed || capturing || renderer.getContext().isContextLost()) return;
        renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.clear();
        cameraHelper.visible = mode === "scene"; grid.visible = state.grid;
        paths.visible = mode === "scene" && state.motionPaths !== false;
        selection.visible = interactive && !!selected && objects.get(selected)?.visible === true;
        if (selection.visible) selection.box.setFromObject(objects.get(selected!)!);
        const rect = mode === "camera" ? viewRect() : { x: 0, y: 0, width, height };
        Object.assign(surface.style, { left: `${rect.x}px`, top: `${height - rect.y - rect.height}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        guide.style.display = mode === "camera" ? "block" : "none";
        renderer.setViewport(rect.x, rect.y, rect.width, rect.height); renderer.setScissor(rect.x, rect.y, rect.width, rect.height); renderer.setScissorTest(true); renderer.render(scene, liveCamera());
        if (mode === "scene") {
            helpers.visible = false;
            const w = Math.min(width * 0.32, 260, height * 0.32 * shot.aspect), h = w / shot.aspect;
            renderer.setViewport(width - w - 12, 12, w, h); renderer.setScissor(width - w - 12, 12, w, h); renderer.render(scene, shot); helpers.visible = true;
        }
        renderer.setScissorTest(false);
    }
    const render = () => { if (!pending && !disposed) pending = requestAnimationFrame(() => { pending = 0; draw(); }); };
    const commitCamera = () => { if (syncing || !interactive) return; if (mode === "camera") callbacks.camera({ ...state.camera, position: shot.position.toArray(), target: controls.target.toArray() }); else editorTarget.copy(controls.target); };
    let orbitChanged = false;
    controls.addEventListener("start", () => { orbitChanged = false; });
    controls.addEventListener("change", () => { if (!syncing) orbitChanged = true; render(); });
    controls.addEventListener("end", () => { if (orbitChanged) commitCamera(); orbitChanged = false; });
    transform.addEventListener("dragging-changed", event => { controls.enabled = !event.value && interactive && !capturing; });
    transform.addEventListener("change", render);
    transform.addEventListener("mouseUp", () => {
        const object = transform.object;
        const saved = state.objects.find(item => item.id === selected);
        if (interactive && object && selected && saved && !saved.locked) {
            // Scene scales are positive. Reject a collapsed or mirrored gizmo
            // edit instead of persisting invalid geometry or changing its size.
            if (object.scale.toArray().some(value => value <= 0)) object.scale.fromArray(saved.scale);
            callbacks.object(selected, { position: object.position.toArray(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(THREE.MathUtils.radToDeg) as DirectorVector, scale: object.scale.toArray() });
        }
    });
    const down = (event: PointerEvent) => { pointerStart = event.button === 0 ? [event.clientX, event.clientY] : null; };
    const pick = (event: MouseEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect(), x = event.clientX - bounds.left, y = bounds.height - (event.clientY - bounds.top);
        if (mode === "scene") { const w = Math.min(width * 0.32, 260, height * 0.32 * shot.aspect); if (x >= width - w - 12 && x <= width - 12 && y >= 12 && y <= 12 + w / shot.aspect) return; }
        const rect = mode === "camera" ? viewRect() : { x: 0, y: 0, width, height };
        if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return;
        pointer.set((x - rect.x) / rect.width * 2 - 1, (y - rect.y) / rect.height * 2 - 1); raycaster.setFromCamera(pointer, liveCamera());
        let hit: THREE.Object3D | null | undefined = raycaster.intersectObjects([...objects.values()].filter(object => object.visible), true)[0]?.object;
        while (hit && !hit.userData.directorId) hit = hit.parent;
        return (hit?.userData.directorId as string | undefined) || null;
    };
    const up = (event: PointerEvent) => {
        const start = pointerStart; pointerStart = null;
        if (!interactive || event.button !== 0 || !start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4 || transform.axis) return;
        const id = pick(event); if (id !== undefined) callbacks.select(id);
    };
    const doubleClick = (event: MouseEvent) => { if (!interactive || transform.axis) return; const id = pick(event); if (id) { callbacks.select(id); frame(undefined, id); } };
    const contextLost = (event: Event) => { event.preventDefault(); callbacks.error("三维渲染已中断，请关闭导演台后重新打开；场景设置已保留"); };
    surface.addEventListener("pointerdown", down); surface.addEventListener("pointerup", up); surface.addEventListener("dblclick", doubleClick); renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const resize = new ResizeObserver(() => { width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight); renderer.setSize(width, height, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; editor.aspect = width / height; editor.updateProjectionMatrix(); render(); }); resize.observe(container);
    function update(next: DirectorScene, selection: string | null) {
        state = next; selected = selection; syncing = true;
        try {
            const attached = transform.object?.userData.directorId;
            const shape = directorModelShape;
            for (const [id, object] of objects) if (!next.objects.some(item => item.id === id && shape(item) === object.userData.shape)) { if (attached === id) transform.detach(); subjects.remove(object); disposeObject(object); objects.delete(id); }
            for (const item of next.objects) {
                let object = objects.get(item.id);
                if (!object) { object = createDirectorModel(item); object.userData.shape = shape(item); objects.set(item.id, object); subjects.add(object); }
                object.position.fromArray(item.position); object.rotation.set(...item.rotation.map(THREE.MathUtils.degToRad) as DirectorVector); object.scale.fromArray(item.scale); object.visible = item.visible !== false;
                updateDirectorModel(object,item);
            }
            const target = selected && objects.get(selected), editable = next.objects.find(item => item.id === selected);
            if (interactive && tool !== "select" && target && editable?.visible !== false && !editable?.locked) { if (transform.object !== target) transform.attach(target); } else { transform.detach(); transform.axis = null; }
            shot.aspect = next.width / next.height; shot.setFocalLength(next.camera.lens); shot.position.fromArray(next.camera.position); shot.lookAt(new THREE.Vector3(...next.camera.target)); shot.updateProjectionMatrix();
            editor.fov = shot.fov; editor.updateProjectionMatrix();
            if (mode === "camera") { controls.target.fromArray(next.camera.target); controls.update(); }
            shot.rotateZ(THREE.MathUtils.degToRad(next.camera.roll ?? 0));
            const azimuth = THREE.MathUtils.degToRad(next.light.azimuth), elevation = THREE.MathUtils.degToRad(next.light.elevation);
            key.position.set(Math.sin(azimuth) * Math.cos(elevation) * 10, Math.sin(elevation) * 10, Math.cos(azimuth) * Math.cos(elevation) * 10); key.intensity = next.light.intensity;
            key.color.set(next.light.color || "#ffffff"); key.castShadow = next.light.shadows !== false; ambient.intensity = next.light.ambient ?? 2; fill.intensity = next.light.fill ?? 0; rim.intensity = next.light.rim ?? 0; floor.visible = next.floorVisible !== false;
            scene.background = new THREE.Color(next.background); floor.material.color.set(next.floor); cameraHelper.update(); render();
            if (pathShots !== next.shots) {
                pathShots = next.shots; disposeObject(paths); paths.clear();
                for (const saved of next.shots || []) {
                    const times = [0,...(saved.keyframes || []).slice().sort((a,b)=>a.time-b.time).map(key=>key.time)];
                    const samples = times.flatMap((time,index) => index === times.length-1 ? [time] : Array.from({length:8},(_,i)=>time+(times[index+1]-time)*i/8));
                    const positions = samples.map(time=>shotScene(next,saved,time).camera.position);
                    if (positions.length > 1) paths.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions.map(position=>new THREE.Vector3(...position))),new THREE.LineBasicMaterial({color:0xd5a454})));
                }
            }
            guide.replaceChildren();
            const divisions = next.guide === "thirds" ? [1 / 3, 2 / 3] : next.guide === "center" ? [0.5] : [];
            for (const fraction of divisions) for (const vertical of [true, false]) { const line = document.createElement("div"); line.style.cssText = vertical ? `position:absolute;left:${fraction * 100}%;top:0;height:100%;border-left:1px solid rgba(255,255,255,.6);box-shadow:1px 0 rgba(0,0,0,.25)` : `position:absolute;top:${fraction * 100}%;left:0;width:100%;border-top:1px solid rgba(255,255,255,.6);box-shadow:0 1px rgba(0,0,0,.25)`; guide.appendChild(line); }
            if (next.safeFrame) for (const margin of [5,10]) { const box=document.createElement("div");box.style.cssText=`position:absolute;inset:${margin}%;border:1px dashed rgba(255,255,255,.65)`;box.title=margin===5?"90% 动作安全区":"80% 标题安全区";guide.appendChild(box); }
        } finally { syncing = false; }
    }
    function frame(direction?: THREE.Vector3, id?: string | null) {
        const bounds = new THREE.Box3();
        for (const [key, object] of objects) if (object.visible && (!id || key === id)) bounds.expandByObject(object);
        if (bounds.isEmpty()) return;
        const center = bounds.getCenter(new THREE.Vector3()), camera = liveCamera();
        const angle = Math.min(THREE.MathUtils.degToRad(camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
        const distance = bounds.getBoundingSphere(new THREE.Sphere()).radius / Math.sin(angle / 2) * 1.15;
        const axis = direction || camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(center).addScaledVector(axis, distance); controls.target.copy(center); controls.update(); commitCamera(); render();
    }
    update(initial, null);
    return {
        update,
        interactive(value: boolean) { if (interactive === value) return; interactive = value; controls.enabled = value && !capturing; transform.enabled = value && !capturing; update(state, selected); },
        mode(value: "camera" | "scene") { if (mode === "scene") editorTarget.copy(controls.target); mode = value; controls.object = liveCamera(); transform.camera = liveCamera(); syncing = true; controls.target.copy(mode === "camera" ? new THREE.Vector3(...state.camera.target) : editorTarget); controls.update(); syncing = false; update(state,selected); },
        transform(value: DirectorTool) { tool = value; if (value !== "select") transform.setMode(value); update(state, selected); },
        space(value: "world" | "local") { transform.setSpace(value); render(); },
        snap(value: boolean) { transform.setTranslationSnap(value ? 0.1 : null); transform.setRotationSnap(value ? THREE.MathUtils.degToRad(15) : null); transform.setScaleSnap(value ? 0.1 : null); render(); },
        focus(id?: string | null) { frame(undefined, id); },
        view(value: "front" | "back" | "left" | "right" | "top" | "perspective") { const axes = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.001], perspective: [1, 0.6, 1] }; frame(new THREE.Vector3(...axes[value]).normalize(), selected); },
        ground(id: string) { const object = objects.get(id); if (!object || state.objects.find(item => item.id === id)?.locked) return; const bounds = new THREE.Box3().setFromObject(object); callbacks.object(id, { position: [object.position.x, object.position.y - bounds.min.y, object.position.z] }); },
        adoptView() { callbacks.camera({ position: editor.position.toArray(), target: controls.target.toArray(), lens: state.camera.lens, roll: 0 }); },
        aim(id: string) { const object = objects.get(id); if (!object?.visible || !interactive) return; const target = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()); if (target.distanceTo(shot.position) > 0) callbacks.camera({ ...state.camera, target: target.toArray() }); },
        async capture(output: DirectorOutput='color',maskId?:string) {
            if (disposed || capturing || renderer.getContext().isContextLost()) throw new Error("三维渲染尚未就绪，请重新打开导演台");
            const context = renderer.getContext(), maxSize = Math.min(context.getParameter(context.MAX_TEXTURE_SIZE), context.getParameter(context.MAX_RENDERBUFFER_SIZE));
            const viewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array;
            if (state.width > Math.min(maxSize, viewport[0]) || state.height > Math.min(maxSize, viewport[1])) throw new Error(`当前显卡不支持 ${state.width} × ${state.height} 输出，请手动调整尺寸；不会自动降低分辨率`);
            capturing = true; controls.enabled = false; transform.enabled = false;
            const background=scene.background,override=scene.overrideMaterial,tone=renderer.toneMapping,floorVisible=floor.visible;
            const materials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>(),temporary:THREE.Material[]=[];
            let composer:EffectComposer|undefined;
            try {
                helpers.visible = false; renderer.setScissorTest(false); renderer.setSize(state.width, state.height, false); renderer.setViewport(0, 0, state.width, state.height);
                if(output==='transparent'){scene.background=null;floor.visible=false;}
                else if(output==='normal'){const normal=new THREE.MeshNormalMaterial();scene.overrideMaterial=normal;temporary.push(normal);renderer.toneMapping=THREE.NoToneMapping;scene.background=new THREE.Color(0);}
                else if(output==='mask'){
                    if(!maskId||!objects.has(maskId)||!objects.get(maskId)!.visible)throw Error('请先选择可见物体，再输出蒙版');
                    const white=new THREE.MeshBasicMaterial({color:0xffffff}),black=new THREE.MeshBasicMaterial({color:0x000000});temporary.push(white,black);
                    for(const [id,object] of objects)object.traverse(child=>{if(child instanceof THREE.Mesh){materials.set(child,child.material);child.material=id===maskId?white:black;}});
                    materials.set(floor,floor.material);(floor as THREE.Mesh).material=black;scene.background=new THREE.Color(0);renderer.toneMapping=THREE.NoToneMapping;
                }else if(output==='depth'){
                    shot.updateMatrixWorld();const box=new THREE.Box3();for(const object of objects.values())if(object.visible)box.expandByObject(object);
                    if(box.isEmpty())throw Error('请添加可见物体后输出深度图');
                    const distances:number[]=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])distances.push(-new THREE.Vector3(x,y,z).applyMatrix4(shot.matrixWorldInverse).z);
                    const near=Math.max(shot.near,Math.min(...distances)),far=Math.max(near+Number.EPSILON,Math.max(...distances));
                    const material=new THREE.ShaderMaterial({uniforms:{depthNear:{value:near},depthFar:{value:far}},vertexShader:'varying float viewDepth; void main(){vec4 view=modelViewMatrix*vec4(position,1.0);viewDepth=-view.z;gl_Position=projectionMatrix*view;}',fragmentShader:'uniform float depthNear;uniform float depthFar;varying float viewDepth;void main(){float depth=1.0-clamp((viewDepth-depthNear)/max(depthFar-depthNear,0.000001),0.0,1.0);gl_FragColor=vec4(vec3(depth),1.0);}'});
                    scene.overrideMaterial=material;temporary.push(material);scene.background=new THREE.Color(0);renderer.toneMapping=THREE.NoToneMapping;
                }else if(output==='outline'){
                    const normal=new THREE.MeshNormalMaterial();scene.overrideMaterial=normal;temporary.push(normal);scene.background=new THREE.Color(0);
                    composer=new EffectComposer(renderer);composer.setSize(state.width,state.height);
                    composer.addPass(new RenderPass(scene,shot));composer.addPass(new ShaderPass(LuminosityShader));const sobel=new ShaderPass(SobelOperatorShader);sobel.uniforms.resolution.value.set(state.width,state.height);composer.addPass(sobel);
                }
                if(composer)composer.render();else renderer.render(scene, shot);
                if (renderer.domElement.width !== state.width || renderer.domElement.height !== state.height) throw new Error("无法分配指定尺寸的图像，请释放显存后重试");
                const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("取景图导出失败，请重试")), "image/png"));
                if (disposed || context.isContextLost()) throw new Error("导出已中断，场景设置保持不变");
                return blob;
            } finally {scene.background=background;floor.visible=floorVisible;scene.overrideMaterial=override;renderer.toneMapping=tone;materials.forEach((material,mesh)=>{mesh.material=material;});if(composer){composer.passes.forEach(pass=>pass.dispose());composer.dispose();}temporary.forEach(material=>material.dispose()); capturing = false; helpers.visible = true; controls.enabled = interactive; transform.enabled = interactive; if (!disposed) { renderer.setSize(width, height, false); render(); } }
        },
        dispose() { disposed = true; cancelAnimationFrame(pending); resize.disconnect(); controls.dispose(); transform.dispose(); surface.removeEventListener("pointerdown", down); surface.removeEventListener("pointerup", up); surface.removeEventListener("dblclick", doubleClick); surface.remove(); renderer.domElement.removeEventListener("webglcontextlost", contextLost); disposeObject(scene); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); objects.clear(); },
    };
}
