import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {FEED,readManifest,newer}=require('../desktop/update-policy.cjs');
const {validateFile}=require('../desktop/updater.cjs');
const root=resolve(process.argv[2]),version=require('../package.json').version;
const response=async url=>{const result=await fetch(url);if(!result.ok)throw new Error(`Cannot download OTA base (${result.status})`);return result;};
const text=await (await response(FEED)).text(),signature=await (await response(FEED+'.sig')).text();
await mkdir(root,{recursive:true});
await writeFile(join(root,'canvas-latest.json'),text);await writeFile(join(root,'canvas-latest.json.sig'),signature);
for(const platform of ['win32','darwin','linux'])for(const arch of ['x64','arm64'])for(const format of {win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]){
    const base=readManifest(text,signature,{platform,arch,format});
    if(!newer(version,base.version))throw new Error('Previous release must be older than this tag');
    const result=await response(base.url),file=join(root,base.file);
    let bytes=0;
    await pipeline(Readable.from((async function*(){for await(const chunk of result.body){bytes+=chunk.length;if(bytes>base.size)throw new Error('Invalid OTA base size');yield chunk;}})()),createWriteStream(file,{flags:'wx'}));
    await validateFile(file,base);console.log(`Verified previous ${base.version} ${platform}/${arch}/${format}`);
}
