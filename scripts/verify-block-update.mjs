import {readFile,writeFile,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {prepareBlockmap} from './prepare-ota-blockmaps.mjs';
const require=createRequire(import.meta.url);
const {filename,platformKey,readManifest,newer,RELEASE_ROOT}=require('../desktop/update-policy.cjs');
const {fileHash,validateFile}=require('../desktop/updater.cjs');
const {readBlockmap,planBlocks,downloadBlocks}=require('../desktop/update-blockmap.cjs');
const [platform,arch,format]=process.argv[2].split('-'),target={platform,arch,format};
const version=require('../package.json').version,root=resolve(process.argv[3]),baseRoot=resolve(process.argv[4]);
const key=platformKey(target),file=filename(version,platform,arch,format),current=join(root,file);
const [text,signature]=await Promise.all(['canvas-latest.json','canvas-latest.json.sig'].map(name=>readFile(join(baseRoot,name),'utf8')));
const base=readManifest(text,signature,target,process.env.CANVAS_OTA_TEST_PUBLIC_KEY||undefined);
if(!newer(version,base.version))throw Error('The signed base must be older than this release');
const baseFile=join(baseRoot,base.file);
await validateFile(baseFile,base);
const oldMapFile=await prepareBlockmap(baseFile),newMapFile=await prepareBlockmap(current);
const sha256=await fileHash(current),size=(await stat(current)).size,newMap=await readBlockmap(newMapFile,size);
const {total,reused}=planBlocks(await readBlockmap(oldMapFile,base.size),newMap,size);
const map={file:file+'.blockmap',size:(await stat(newMapFile)).size,sha256:await fileHash(newMapFile)};
const entry={file,url:`${RELEASE_ROOT}/download/v${version}/${file}`,size,sha256,blockmap:map};
const output=current+'.reconstructed';
try {
    if(reused){
        await downloadBlocks({baseFile,oldMapFile,newMapFile,base:{...base,blockmap:{sha256:await fileHash(oldMapFile)}},entry,outputFile:output,fetcher:async(url,init)=>{
            if(url!==entry.url)throw Error('Unexpected reconstruction URL');
            const range=/^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range||'');
            if(!range)throw Error('Reconstruction must request exact changed byte ranges');
            const start=Number(range[1]),end=Number(range[2]);
            return new Response(Readable.toWeb(createReadStream(current,{start,end})),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${size}`}});
        }});
        await validateFile(output,entry);
    } else await validateFile(current,entry);
} finally {await rm(output,{force:true});await rm(output+'.json',{force:true});}
const report={version,target:key,from:base.version,baseSha256:base.sha256,sha256,size,blockmap:map,downloadBytes:total,reusedBytes:reused};
await writeFile(join(root,`OTA-BLOCKS-${key}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
