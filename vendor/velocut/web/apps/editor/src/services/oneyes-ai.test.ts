import test from 'node:test';
import assert from 'node:assert/strict';
import {TsEngineAdapter} from '@velocut/runtime/engine';
import {parseDraft} from './oneyes-ai';

function fixture(){
 const e=new TsEngineAdapter('剪辑',1920,1080,30,1);
 e.apply({type:'addAsset',kind:'video',src:'opfs://original',name:'原片',width:1920,height:1080,durationUs:2e6});
 e.apply({type:'addTrack',kind:'video'});e.apply({type:'addClip',assetId:'asset_1',trackId:'track_2',startUs:0,durationUs:2e6});
 return e;
}
test('AI uses real editor commands with atomic application and immutable source document',()=>{
 const e=fixture(),doc=e.document(),raw=JSON.stringify(doc);
 const draft=parseDraft(JSON.stringify({summary:'分割并降低音量',commands:[{type:'splitClip',clipId:'clip_3',atUs:1e6},{type:'setClipVolume',clipId:'clip_3',volume:.5}]}),doc);
 assert.equal(JSON.stringify(doc),raw);assert.equal(draft.base,raw);
 assert.equal(draft.after.tracks[0].clips.length,2);assert.equal(draft.after.width,1920);assert.equal(draft.after.height,1080);
 assert.equal(draft.after.assets[0].src,'opfs://original');
 const result=e.apply(draft.command);assert.equal(result.ok,true);e.undo();assert.equal(e.document().tracks[0].clips.length,1);
});
test('AI forbids source replacement, external generation, script execution and invalid source bounds',()=>{
 const doc=fixture().document();
 for(const command of [{type:'addAsset',kind:'video',src:'https://example.test',name:'remote'},{type:'setAssetSpec',assetId:'asset_1',spec:'{}'},{type:'batch',commands:[]},{type:'trimClip',clipId:'clip_3',edge:'out',toUs:9e6},{type:'setClipVolume',clipId:'missing',volume:1},{type:'addEffect',clipId:'clip_3',effect:'shader',params:{code:'injected'}}]){
  assert.throws(()=>parseDraft(JSON.stringify({summary:'invalid',commands:[command]}),doc));
 }
 assert.throws(()=>parseDraft('{bad}',doc));assert.equal(doc.tracks[0].clips.length,1);
});
