import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.argv[2], files=(await readdir(root)).filter(v=>!v.endsWith('.txt')).sort();
const version=JSON.parse(await readFile('package.json','utf8')).version;
for(const os of ['Windows','macOS','Linux']) for(const arch of ['x64','arm64']) for(const extension of {Windows:['exe'],macOS:['dmg','zip'],Linux:['AppImage','deb','rpm']}[os]) {
  if(!files.some(v=>v.startsWith(`OneYes-Canvas-${version}-${os}-${arch}`)&&v.endsWith('.'+extension)))throw new Error(`Missing ${os} ${arch} ${extension}`);
}
if(files.length!==12)throw new Error('Expected 12 platform installers');
const sums=await Promise.all(files.map(async name=>createHash('sha256').update(await readFile(join(root,name))).digest('hex')+'  '+name));
await writeFile(join(root,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log('Verified 12 installers for Windows/macOS/Linux x64 and ARM64');
