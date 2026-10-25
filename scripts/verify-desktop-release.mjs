import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash,sign,verify,createPrivateKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{filename,platformKey,RELEASE_ROOT}=require('../desktop/update-policy.cjs');
const publicKey=process.env.CANVAS_OTA_TEST_PUBLIC_KEY||require('../desktop/update-key.cjs');
const root=process.argv[2], files=(await readdir(root)).filter(v=>/\.(exe|dmg|zip|AppImage|deb|rpm)$/.test(v)).sort();
const version=JSON.parse(await readFile('package.json','utf8')).version;
for(const os of ['Windows','macOS','Linux']) for(const arch of ['x64','arm64']) for(const extension of {Windows:['exe'],macOS:['dmg','zip'],Linux:['AppImage','deb','rpm']}[os]) {
  const packageArch=os==='Linux'?{AppImage:{x64:'x86_64',arm64:'arm64'},deb:{x64:'amd64',arm64:'arm64'},rpm:{x64:'x86_64',arm64:'aarch64'}}[extension][arch]:arch;
  const name=`OneYes-Canvas-${version}-${os}-${packageArch}${os==='Windows'?'-Setup':''}.${extension}`;
  if(!files.includes(name))throw new Error(`Missing ${name}`);
}
if(files.length!==12)throw new Error('Expected 12 platform installers');
const sums=await Promise.all(files.map(async name=>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(join(root,name)))hash.update(chunk);
  return hash.digest('hex')+'  '+name;
}));
await writeFile(join(root,'SHA256SUMS.txt'),sums.join('\n')+'\n');
const privateKey=createPrivateKey(process.env.CANVAS_OTA_PRIVATE_KEY||'');
const hashes=new Map(sums.map(line=>[line.slice(66),line.slice(0,64)])),platforms={};
for(const platform of ['win32','darwin','linux'])for(const arch of ['x64','arm64'])for(const format of {win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]){
  const file=filename(version,platform,arch,format),{size}=await stat(join(root,file));
  platforms[platformKey({platform,arch,format})]={file,url:`${RELEASE_ROOT}/download/v${version}/${file}`,size,sha256:hashes.get(file)};
}
const changelog=await readFile('CHANGELOG.md','utf8'),section=changelog.split(`## v${version}`)[1]?.split('\n## ')[0]?.trim()||'';
const text=JSON.stringify({schema:1,version,notes:section.replace(/^\+\s*/gm,''),platforms},null,2)+'\n';
const signature=sign(null,Buffer.from(text),privateKey);
if(!verify(null,Buffer.from(text),publicKey,signature))throw new Error('OTA signing identity does not match pinned Canvas key');
await writeFile(join(root,'canvas-latest.json'),text);
await writeFile(join(root,'canvas-latest.json.sig'),signature.toString('base64')+'\n');
console.log('Verified 12 installers and generated signed OTA manifest for 10 independent platform/architecture/formats');
