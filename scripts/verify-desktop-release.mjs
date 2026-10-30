import {readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {createHash,sign,verify,createPrivateKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const require=createRequire(import.meta.url),{filename,deltaFilename,platformKey,RELEASE_ROOT}=require('../desktop/update-policy.cjs');
const {readManifest}=require('../desktop/update-policy.cjs');
const {fileHash,validateFile}=require('../desktop/updater.cjs');
const {applyDelta}=require('../desktop/update-delta.cjs');
const publicKey=process.env.CANVAS_OTA_TEST_PUBLIC_KEY||require('../desktop/update-key.cjs');
const root=resolve(process.argv[2]), files=(await readdir(root)).filter(v=>/\.(exe|dmg|zip|AppImage|deb|rpm)$/.test(v)).sort();
const version=JSON.parse(await readFile('package.json','utf8')).version;
const deltaTarget=process.env.CANVAS_OTA_DELTA_TARGET;
const targets=['win32','darwin','linux'].flatMap(platform=>['x64','arm64'].flatMap(arch=>({win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]).map(format=>({platform,arch,format}))));
if(deltaTarget&&!targets.some(target=>platformKey(target)===deltaTarget))throw new Error('Unknown delta target');
const selectedTargets=targets.filter(target=>!deltaTarget||platformKey(target)===deltaTarget);
if(deltaTarget){
  const {platform,arch,format}=selectedTargets[0];
  if(!files.includes(filename(version,platform,arch,format)))throw new Error('Missing target installer');
}else{
for(const os of ['Windows','macOS','Linux']) for(const arch of ['x64','arm64']) for(const extension of {Windows:['exe'],macOS:['dmg','zip'],Linux:['AppImage','deb','rpm']}[os]) {
  const packageArch=os==='Linux'?{AppImage:{x64:'x86_64',arm64:'arm64'},deb:{x64:'amd64',arm64:'arm64'},rpm:{x64:'x86_64',arm64:'aarch64'}}[extension][arch]:arch;
  const name=`OneYes-Canvas-${version}-${os}-${packageArch}${os==='Windows'?'-Setup':''}.${extension}`;
  if(!files.includes(name))throw new Error(`Missing ${name}`);
}
if(files.length!==12)throw new Error('Expected 12 platform installers');
}
const sums=await Promise.all(files.map(async name=>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(join(root,name)))hash.update(chunk);
  return hash.digest('hex')+'  '+name;
}));
const hashes=new Map(sums.map(line=>[line.slice(66),line.slice(0,64)])),platforms={};
for(const {platform,arch,format} of selectedTargets){
  const file=filename(version,platform,arch,format),{size}=await stat(join(root,file));
  platforms[platformKey({platform,arch,format})]={file,url:`${RELEASE_ROOT}/download/v${version}/${file}`,size,sha256:hashes.get(file)};
}
const changelog=await readFile('CHANGELOG.md','utf8'),section=changelog.split(`## v${version}`)[1]?.split('\n## ')[0]?.trim()||'';
const deltas={},deltaSums=[];
const baseRoot=process.env.CANVAS_OTA_BASE_DIR;
if((deltaTarget||process.env.CANVAS_OTA_PREBUILT_DELTAS)&&!baseRoot)throw new Error('Pinned OTA base is required');
const deltaTimeoutMs=Number.isSafeInteger(Number(process.env.CANVAS_OTA_DELTA_TIMEOUT_MS))&&Number(process.env.CANVAS_OTA_DELTA_TIMEOUT_MS)>0?Number(process.env.CANVAS_OTA_DELTA_TIMEOUT_MS):120000;
if(baseRoot){
  const baseText=await readFile(join(baseRoot,'canvas-latest.json'),'utf8');
  const baseSignature=await readFile(join(baseRoot,'canvas-latest.json.sig'),'utf8');
  for(const {platform,arch,format} of selectedTargets){
    const target={platform,arch,format}, currentFile=filename(version,platform,arch,format), base=readManifest(baseText,baseSignature,target,publicKey);
    if(!require('semver').lt(base.version,version))throw new Error('Delta base must be older than release');
    const basePath=join(baseRoot,base.file), deltaFile=deltaFilename(version,base.version,platform,arch,format), deltaPath=join(root,deltaFile), targetEntry=platforms[platformKey(target)];
    await validateFile(basePath,base);
    if(process.env.CANVAS_OTA_PREBUILT_DELTAS){
      try{await stat(deltaPath);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    }else{
    try {
      if(process.env.CANVAS_OTA_BSDIFF){
        await promisify(execFile)(process.env.CANVAS_OTA_BSDIFF,[basePath,join(root,currentFile),deltaPath],{timeout:deltaTimeoutMs});
      }else{
        // Portable fixture/local generator. CI uses the native reference bsdiff
        // producer so large installers do not hit WebAssembly address limits.
        const {loadBsdiff}=await import('bsdiff-wasm'), engine=await loadBsdiff();
        for(const [mount,folder] of [['/base',resolve(baseRoot)],['/release',root]]){engine.FS.mkdir(mount);engine.FS.mount(engine.NODEFS,{root:folder},mount);}
        if(engine.callMain([`/base/${base.file}`,`/release/${currentFile}`,`/release/${deltaFile}`])!==0)throw new Error(`Failed to generate ${deltaFile}`);
      }
      const generated=await stat(deltaPath);
      if(generated.size>=targetEntry.size){await rm(deltaPath,{force:true});console.log(`${platformKey(target)}: skipped delta because it is not smaller`);continue;}
    } catch(error) {
      await rm(deltaPath,{force:true});
      console.log(`${platformKey(target)}: skipped delta generation (${error.code==='ETIMEDOUT'?'timeout':error.message})`);
      continue;
    }
    }
    const reconstructed=join(root,currentFile+'.reconstructed');
    try{
      await applyDelta({baseFile:basePath,patchFile:deltaPath,outputFile:reconstructed,targetSize:targetEntry.size});
      await validateFile(reconstructed,targetEntry);
    }finally{await rm(reconstructed,{force:true});}
    const {size}=await stat(deltaPath),sha256=await fileHash(deltaPath);
    const key=platformKey(target); (deltas[key] ||= {})[base.version]={from:base.version,file:deltaFile,url:`${RELEASE_ROOT}/download/v${version}/${deltaFile}`,size,sha256,baseFile:base.file,baseSize:base.size,baseSha256:base.sha256,targetSha256:targetEntry.sha256,targetSize:targetEntry.size};
    deltaSums.push(`${sha256}  ${deltaFile}`);
    console.log(`${key}: verified delta ${size} / full ${targetEntry.size} bytes`);
  }
}
const expectedDeltas=new Set(Object.values(deltas).flatMap(entries=>Object.values(entries).map(delta=>delta.file)));
for(const file of await readdir(root))if(file.endsWith('.delta')&&!expectedDeltas.has(file))throw new Error(`Unexpected delta ${file}`);
if(deltaTarget){
  console.log(`${deltaTarget}: independent delta task complete; ${expectedDeltas.size} verified patch(es)`);
}else{
const privateKey=createPrivateKey(process.env.CANVAS_OTA_PRIVATE_KEY||'');
await writeFile(join(root,'SHA256SUMS.txt'),sums.join('\n')+'\n');
if(deltaSums.length)await writeFile(join(root,'SHA256SUMS-deltas.txt'),deltaSums.join('\n')+'\n');
else await rm(join(root,'SHA256SUMS-deltas.txt'),{force:true});
const text=JSON.stringify({schema:1,version,notes:section.replace(/^\+\s*/gm,''),platforms,...(Object.keys(deltas).length?{deltas}: {})},null,2)+'\n';
const signature=sign(null,Buffer.from(text),privateKey);
if(!verify(null,Buffer.from(text),publicKey,signature))throw new Error('OTA signing identity does not match pinned Canvas key');
await writeFile(join(root,'canvas-latest.json'),text);
await writeFile(join(root,'canvas-latest.json.sig'),signature.toString('base64')+'\n');
console.log(`Verified 12 installers and generated signed OTA manifest for 10 independent platform/architecture/formats${Object.keys(deltas).length ? ` plus ${Object.values(deltas).reduce((n, v) => n + Object.keys(v).length, 0)} deltas` : ''}`);
}
