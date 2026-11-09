import test from "node:test";
import assert from "node:assert/strict";
import { directorPreset } from "./director-scene";
import { createDirectorShot, shotScene } from "./director-sequence";
import { directorAiRequest, formatVideoPrompt, readDirectorDraft, readVideoPrompt } from "./director-assistant";

test("AI stage patches preserve unmentioned objects, locked subjects, original dimensions and saved shots",()=>{
    const scene=directorPreset("dialogue"), id=scene.objects[0].id;scene.objects[0].joints={leftArm:[0,0,30],head:[0,10,0]};scene.shots=[createDirectorShot(scene)];scene.objects[1].locked=true;
    const before=structuredClone(scene), plan={summary:"暖光反打",scene:{camera:{lens:85,roll:10},light:{fill:2},objects:[{id,position:[-1,0,1],joints:{head:[0,30,0]}},{id:"prop",kind:"box",position:[0,0.5,2]}]}};
    const draft=readDirectorDraft('```json\n'+JSON.stringify(plan)+'\n```',scene,"scene");
    assert.equal(draft.scene.objects.length,3);assert.equal(draft.scene.camera.lens,85);assert.equal(draft.scene.camera.roll,10);assert.deepEqual(draft.scene.objects[1],scene.objects[1]);assert.deepEqual(draft.scene.shots,scene.shots);
    assert.equal(draft.scene.width,scene.width);assert.equal(draft.scene.height,scene.height);assert.deepEqual(scene,before);assert.deepEqual(draft.preview.shots,[]);assert.equal(draft.source,JSON.stringify(scene));
    assert.deepEqual(draft.scene.objects[0].joints,{leftArm:[0,0,30],head:[0,30,0]});
    const request=directorAiRequest(scene,"让他转身","scene");assert.match(request.prompt,/让他转身/);assert.match(request.system,/locked:true/);assert.ok(!JSON.parse(request.prompt).当前场景.shots);
});
test("AI animation makes independent cumulative keyframes, appends shots and retains original state",()=>{
    const scene=directorPreset(),id=scene.objects[0].id;scene.shots=[createDirectorShot(scene)];
    const plan={summary:"走近挥手再反打",shots:[{name:"推进",duration:4,easing:"linear",scene:{objects:[{id,pose:"walk"}]},keyframes:[{time:2,scene:{objects:[{id,position:[1,0,0],joints:{leftArm:[0,0,70]}}]}},{time:4,scene:{camera:{lens:85},objects:[{id,position:[2,0,0]}]}}]},{name:"反打",duration:2,scene:{camera:{position:[-3,2,-4]}},keyframes:[{time:2,scene:{objects:[{id,rotation:[0,90,0]}]}}]}]};
    const draft=readDirectorDraft(JSON.stringify(plan),scene,"animation");assert.equal(draft.scene.shots!.length,3);assert.equal(draft.preview.shots!.length,2);assert.equal(draft.added[0].width,scene.width);
    const end=shotScene(draft.scene,draft.added[0],4),next=shotScene(draft.scene,draft.added[1]);assert.equal(end.objects[0].position[0],2);assert.equal(next.objects[0].position[0],2);assert.deepEqual(end.objects[0].joints,{leftArm:[0,0,70]});
    assert.equal(shotScene(draft.scene,draft.added[0],1).objects[0].position[0],0.5);assert.equal(scene.objects[0].position[0],0);assert.equal(scene.shots.length,1);
    const precise=readDirectorDraft(JSON.stringify({summary:"细分运动",shots:[{name:"细分",duration:1,keyframes:[{time:0.1001,scene:{camera:{lens:60}}},{time:0.1002,scene:{camera:{lens:70}}}]}]}),scene,"animation");assert.deepEqual(precise.added[0].keyframes!.map(key=>key.time),[0.1001,0.1002]);
});
test("invalid AI fields, geometry, dimensions, locks and timelines never change the source",()=>{
    const scene=directorPreset();scene.objects[0].locked=true;const id=scene.objects[0].id,before=structuredClone(scene);
    for(const patch of [{width:64},{camera:{lens:0}},{camera:{position:[0,0,0],target:[0,0,0]}},{objects:[{id,position:[9,0,0]}]},{removeObjects:[id]},{objects:[{id:"new",kind:"script",url:"https://bad"}]},{objects:[{id,locked:false}]}])assert.throws(()=>readDirectorDraft(JSON.stringify({summary:"bad",scene:patch}),scene,"scene"));
    for(const shots of [[{name:"bad",duration:0}],[{name:"bad",duration:5,keyframes:[{time:6,scene:{}}]}],[{name:"bad",duration:5,keyframes:[{time:2,scene:{}},{time:2,scene:{}}]}],[{name:"bad",duration:2,keyframes:[{time:1,scene:{removeObjects:[id]}}]}]])assert.throws(()=>readDirectorDraft(JSON.stringify({summary:"bad",shots}),scene,"animation"));
    assert.throws(()=>readDirectorDraft("not json",scene,"scene"),/JSON/);assert.deepEqual(scene,before);
});
test("reverse video output validates ordered time ranges and preserves inference uncertainty",()=>{
    const value={summary:"城市推进",prompt:"雨夜街道，缓慢推进",negativePrompt:"模糊",shots:[{start:0,end:2,description:"雨夜街道",camera:"可能推进",action:"车辆经过",prompt:"电影感街道"}],uncertainties:["未读取音轨，无法确认声音"]};
    assert.deepEqual(readVideoPrompt(JSON.stringify(value),2),value);
    for(const shot of [{...value.shots[0],end:3},{...value.shots[0],start:-1},{...value.shots[0],end:0},{...value.shots[0],camera:{}},{...value.shots[0],prompt:" \n"},{...value.shots[0],description:""},{...value.shots[0],url:"https://bad"}])assert.throws(()=>readVideoPrompt(JSON.stringify({...value,shots:[shot]}),2));
    assert.throws(()=>readVideoPrompt(JSON.stringify({...value,shots:[...value.shots,...value.shots]}),2));
});

test("detailed reverse prompts retain every shot field, full prose, Unicode and uncertainty when exported",()=>{
    const prose='主体 A 穿深蓝外套，位于画面左侧；前景玻璃有暖光反射，背景为冷色街道。\n0.3s 抬头，0.8s 视线转向右侧，期间是否推进待确认。';
    const value={summary:'夜景双镜头',prompt:prose.repeat(60),negativePrompt:'保持服装与人物数量，避免手部畸变、时序闪烁。',shots:[{start:0,end:1,description:'左侧主体 A，前景玻璃；高光呈金色。',camera:'平视中景，背景视差不足，不能确认推进。',action:'0.3s 抬头；0.8s 视线转向右侧。',prompt:prose},{start:1.2,end:2,description:'主体 B 在右侧，<标记> 是画中文字；保留 🎬。',camera:'过肩，切点在 1–1.2s 内待确认。',action:'主体 B 右手抬起，后续动作不可见。',prompt:'主体 B 背景虚化，右手抬至胸前；不要添加未见动作。'}],uncertainties:['未读取音轨，不推断对白。','原片帧率／焦距未知。']};
    const read=readVideoPrompt(JSON.stringify(value),2), formatted=formatVideoPrompt(read);
    assert.deepEqual(read,value);
    for(const text of [value.prompt,value.negativePrompt,...value.shots.flatMap(shot=>[shot.description,shot.camera,shot.action,shot.prompt]),...value.uncertainties])assert.ok(formatted.includes(text),'copy/export retains the complete detailed result');
    assert.match(formatted,/1\.2–2s/);assert.match(formatted,/【待确认】/);assert.deepEqual(value,read,'formatting must not mutate saved results');
});
