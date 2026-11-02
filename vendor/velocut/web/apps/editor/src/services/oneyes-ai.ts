import { CommandSchema, COMMAND_CATALOG, type Command, type VDocument } from '@velocut/protocol';
import { TsEngineAdapter } from '@velocut/runtime/engine';

const allowed = new Set(['addTrack','removeTrack','moveTrack','addClip','addTextClip','duplicateClip','removeClip','moveClip','trimClip','splitClip','setClipSpeed','setTransform','setClipVolume','setText','setTransition','setKeyframe','removeKeyframe','addEffect','removeEffect','setEffectParams','setTrackMuted']);
function checkValues(value:unknown):void {
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('AI 草稿包含无效数值，未修改时间线');
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
    if(['shader','wgsl','glsl','code','url','src'].includes(key.toLowerCase()))throw Error('AI 草稿不能注入脚本或外部资源');
    checkValues(item);
  }
}
export const editSystem = `你是 OneYes 视频剪辑助手。只返回 JSON：{"summary":"中文剪辑说明","commands":[编辑命令]}。
仅根据提供的时间线、素材名称和用户要求编排。未看到画面或听到音频，不能声称识别人声、静音或理解镜头；需要这些信息时说明缺少内容，不编造识别结果。时间单位为整数微秒。不得修改项目分辨率、素材来源、调用生成接口或运行脚本。保留源素材，不改 Key、账号和接口地址。无操作时返回空 commands 并说明原因。
下列是上游真实命令及字段（新增轨道后其 ID 为 track_<nextId>，每次新增实体都会递增 nextId）：
${COMMAND_CATALOG.filter(c=>allowed.has(c.type)).map(c=>c.type+': '+c.summary).join('\n')}`;
export function parseDraft(text: string, doc: VDocument) {
  const body=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(typeof body.summary!=='string'||!Array.isArray(body.commands))throw Error('AI 未返回有效剪辑草稿，请保留时间线并修改要求后重试');
  const commands: Command[]=body.commands.map((value: unknown)=>{
    checkValues(value);
    const c=CommandSchema.parse(value);
    if(!allowed.has(c.type))throw Error('AI 草稿包含不支持的操作，未修改时间线');
    if(c.type==='addEffect'&&/custom|shader/i.test(c.effect))throw Error('AI 草稿不能创建自定义着色脚本');
    return c;
  });
  const engine=new TsEngineAdapter(doc.name,doc.width,doc.height,doc.fpsNum,doc.fpsDen);engine.load(structuredClone(doc));
  const command: Command={type:'batch',commands}, result=engine.apply(command);
  if(!result.ok)throw Error('AI 草稿未通过时间线校验：'+result.error.message);
  for(const track of engine.document().tracks)for(const clip of track.clips){
    const asset=doc.assets.find(a=>a.id===clip.assetId);
    if(asset&&asset.kind!=='image'&&(clip.sourceInUs<0||clip.sourceInUs+clip.durationUs*clip.speed>asset.durationUs+1))throw Error('AI 草稿超出了原始素材时长，未修改时间线');
  }
  return {summary:body.summary as string,command,base:JSON.stringify(doc),after:engine.document()};
}
