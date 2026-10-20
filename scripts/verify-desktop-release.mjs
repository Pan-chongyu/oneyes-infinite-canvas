import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2], files=(await readdir(root)).filter(v=>!v.endsWith('.txt')).sort();
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
console.log('Verified 12 installers for Windows/macOS/Linux x64 and ARM64');
