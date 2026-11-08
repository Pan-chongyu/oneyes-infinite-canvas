import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Euler, MathUtils } from "three";
import { unzipSync, strFromU8 } from "fflate";
import { directorPreset, readDirectorScene, directorSceneFile, parseDirectorSceneFile } from "./director-scene";
import { createDirectorShot, directorCameraMove, directorFrame, directorFrameChanged, directorMotionPrompt, recordDirectorFrame, retimeDirectorShot, sequenceAt, sequenceDuration, shotDuration, shotListCsv, shotScene } from "./director-sequence";
import { exportDirectorBundle, storyboardHtml } from "./director-export";

test("independent shots and timed frames retain full stage state without mutating saved data", () => {
    const scene = directorPreset(); scene.note = "全片风格";
    const first = createDirectorShot(scene); first.easing = "linear";
    scene.objects[0].position[0] = 8; scene.objects[0].joints = { head: [0, 80, 0] }; scene.light.intensity = 8; scene.background = "#abcdef";
    const second = createDirectorShot(scene); second.id = "other";
    let shot = recordDirectorFrame(first,scene,5);
    scene.shots = [shot,second];
    const before = structuredClone(scene), start = shotScene(scene,shot), middle = shotScene(scene,shot,2.5), end = shotScene(scene,shot,5);
    assert.equal(start.objects[0].position[0],0);assert.equal(middle.objects[0].position[0],4);assert.equal(end.objects[0].position[0],8);
    assert.ok(Math.abs(middle.objects[0].joints!.head![1]-40)<0.001);assert.equal(start.light.intensity,3);assert.equal(end.light.intensity,8);
    assert.equal(start.note,"全片风格");assert.equal(shotScene(scene,second).background,"#abcdef");
    middle.objects[0].position[0]=999;assert.deepEqual(scene,before);
    shot = recordDirectorFrame(shot,scene,5);assert.equal(shot.keyframes?.length,1,"recording at an existing time replaces one key");
    const keyId=shot.keyframes![0].id;shot=recordDirectorFrame(shot,scene,5);assert.equal(shot.keyframes![0].id,keyId);
    assert.deepEqual(parseDirectorSceneFile(directorSceneFile(scene)),scene);
    const legacy={id:"legacy",name:"旧机位",camera:scene.camera,width:101,height:207};assert.equal(shotDuration(legacy),5);assert.equal(shotScene(scene,legacy).objects[0].position[0],8);
});

test("keyframes use quaternion rotation, nondegenerate camera orientation, interpolation modes and exact cut boundaries", () => {
    const scene=directorPreset(), shot=createDirectorShot(scene);shot.duration=2;shot.easing="linear";
    scene.camera={position:[0,0,1],target:[0,0,0],lens:24,roll:0};shot.camera=structuredClone(scene.camera);
    scene.objects[0].rotation=[0,170,0];shot.stage=directorFrame(scene);
    scene.camera={position:[0,0,-1],target:[0,0,0],lens:80,roll:30};scene.objects[0].rotation=[0,-170,0];
    const moving=recordDirectorFrame(shot,scene,2), middle=shotScene(scene,moving,1);
    assert.equal(middle.camera.lens,52);assert.equal(middle.camera.roll,15);
    assert.notDeepEqual(middle.camera.position,middle.camera.target,"opposite cameras must not interpolate into a zero look vector");
    const orientation=new Quaternion().setFromEuler(new Euler(...middle.objects[0].rotation.map(MathUtils.degToRad) as [number,number,number]));
    assert.ok(orientation.angleTo(new Quaternion().setFromEuler(new Euler(0,Math.PI,0)))<0.001,"rotation takes shortest quaternion arc");
    assert.equal(shotScene(scene,{...moving,easing:"hold"},1).camera.lens,24);assert.equal(shotScene(scene,{...moving,easing:"hold"},2).camera.lens,80);
    assert.ok(shotScene(scene,{...moving,easing:"smooth"},0.5).camera.lens < shotScene(scene,moving,0.5).camera.lens);
    const other={...moving,id:"second",duration:3};assert.equal(sequenceDuration([moving,other]),5);assert.equal(sequenceAt([moving,other],2)?.shot.id,"second");assert.equal(sequenceAt([moving,other],5)?.time,3);assert.equal(sequenceAt([],0),null);
});

test('frame status follows the edited shot and retiming preserves its motion, key identities and source dimensions', () => {
    const scene = directorPreset(), first = createDirectorShot(scene);
    assert.equal(directorFrameChanged(scene, first), false);
    scene.camera.lens = 85;
    assert.equal(directorFrameChanged(scene, first), true);
    const shot = recordDirectorFrame(first, scene, 5), original = structuredClone(shot);
    assert.equal(directorFrameChanged(scene, shot, 5), false);
    assert.equal(directorFrameChanged({ ...scene, width: scene.width + 1 }, shot, 5), true);
    const shorter = retimeDirectorShot(shot, 2), longer = retimeDirectorShot(shorter, 10);
    assert.equal(shorter.keyframes![0].time, 2); assert.equal(longer.keyframes![0].time, 10);
    assert.equal(shorter.keyframes![0].id, shot.keyframes![0].id);
    assert.deepEqual(shotScene(scene, shorter, 1), shotScene(scene, shot, 2.5));
    assert.deepEqual(shot, original);
    assert.deepEqual(readDirectorScene({ ...scene, shots: [shorter, { ...longer, id: 'longer' }] }).shots, [shorter, { ...longer, id: 'longer' }]);
    for (const value of [0, -1, NaN, Infinity]) assert.throws(() => retimeDirectorShot(shot, value), /时长/);
});

test("import validates snapshot objects, duration, key identities/times and safe frames without recursive shot data", () => {
    const scene=directorPreset(), shot=createDirectorShot(scene);scene.shots=[recordDirectorFrame(shot,scene,2)];
    assert.deepEqual(readDirectorScene(scene),scene);
    const key=scene.shots[0].keyframes![0];
    const patches=[{duration:0},{duration:Infinity},{easing:"magic"},{cameraPath:"magic"},{dialogue:{}},{stage:[]},{stage:{...shot.stage,objects:[{...scene.objects[0],scale:[0,1,1]}]}},{keyframes:{}},{keyframes:[key,key]},{keyframes:[{...key,time:-1}]},{keyframes:[{...key,time:6}]},{keyframes:[{...key,frame:{...key.frame,camera:{...key.frame.camera,roll:NaN}}}]}];
    for(const patch of patches)assert.throws(()=>readDirectorScene({...scene,shots:[{...scene.shots![0],...patch}]}),/无效/);
    const nested={...shot.stage,shots:[{bad:"ignored"}]};assert.doesNotThrow(()=>readDirectorScene({...scene,shots:[{...shot,stage:nested}]}));
});

test("camera presets preserve the shot stage and keys, orbit on a constant-radius arc and describe actual motion", () => {
    const scene=directorPreset();scene.camera={position:[0,1,5],target:[0,1,0],lens:50};
    const shot=createDirectorShot(scene);shot.duration=2;shot.easing="linear";
    const seeded=recordDirectorFrame(shot,scene,0.5), before=structuredClone(seeded);
    const dolly=directorCameraMove(scene,seeded,"dolly",1), truck=directorCameraMove(scene,shot,"truck",2), crane=directorCameraMove(scene,shot,"crane",-1), orbit=directorCameraMove(scene,shot,"orbit",90);
    assert.equal(dolly.keyframes!.length,2);assert.equal(dolly.keyframes![0].id,seeded.keyframes![0].id);assert.equal(dolly.keyframes![1].frame.camera.position[2],4);
    assert.deepEqual(shotScene(scene,truck,2).camera,{position:[2,1,5],target:[2,1,0],lens:50});
    assert.deepEqual(shotScene(scene,crane,2).camera,{position:[0,0,5],target:[0,0,0],lens:50});
    const middle=shotScene(scene,orbit,1).camera;assert.ok(Math.abs(Math.hypot(middle.position[0],middle.position[2])-5)<1e-8);assert.ok(middle.position[0]>3.5);
    assert.deepEqual(seeded,before);assert.throws(()=>directorCameraMove(scene,shot,"dolly",5),/不能越过/);assert.throws(()=>directorCameraMove(scene,shot,"orbit",270),/分段/);
    const prompt=directorMotionPrompt(scene,orbit);assert.match(prompt,/2 秒/);assert.match(prompt,/最短圆弧/);assert.match(prompt,/0s：相机 \[0, 1, 5\]/);assert.match(prompt,/2s：相机 \[5, 1, 0\]/);
    const legacy={...shot,stage:undefined};const moved=directorCameraMove(scene,legacy,"truck",-1);assert.ok(moved.stage);assert.ok(!Object.hasOwn(moved.stage,"camera"));
});

test("storyboard delivery escapes user content and retains the ordered shot timing and source sizes", async () => {
    const scene=directorPreset();scene.width=313;scene.height=197;scene.note="<script>alert(1)</script>";
    const shot=createDirectorShot(scene);shot.name='=HYPERLINK("bad")';shot.note="雨夜\n反打";shot.dialogue='甲："你好"';shot.duration=0.25;scene.shots=[shot,{...structuredClone(shot),id:"second",name:"乙",duration:0.5}];
    const csv=shotListCsv(scene);assert.ok(csv.startsWith("\uFEFF"));assert.match(csv,/'=HYPERLINK/);assert.match(csv,/313 × 197/);assert.match(csv,/"2","乙","0.25","0.5"/);
    const html=storyboardHtml(scene);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/shots\/0002\/frame-000001.png/);
    const sizes:number[][]=[],progress:number[][]=[];
    const blob=await exportDirectorBundle(scene,{sequence:true,fps:4,signal:new AbortController().signal,render:async frame=>{sizes.push([frame.width,frame.height]);return new Blob([new Uint8Array([1,2,3])],{type:"image/png"});},progress:(...pair)=>progress.push(pair)});
    const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));assert.equal(Object.keys(files).filter(name=>name.endsWith(".png")).length,3);assert.deepEqual(sizes,[[313,197],[313,197],[313,197]]);assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);assert.equal(strFromU8(files["shotlist.csv"]),csv.replace(/^\uFEFF/,""));assert.deepEqual(parseDirectorSceneFile(strFromU8(files["scene.json"])),scene);
    const abort=new AbortController();let renders=0;
    await assert.rejects(exportDirectorBundle(scene,{sequence:true,fps:4,signal:abort.signal,render:async()=>{renders++;abort.abort();return new Blob();},progress:()=>{}}),/abort/i);assert.equal(renders,1);
});
