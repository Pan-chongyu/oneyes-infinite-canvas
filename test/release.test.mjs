import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('release requires all twelve native installers and hashes RPM architecture aliases',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'canvas-release-'));
  try {
    const {version}=JSON.parse(await readFile('package.json','utf8'));
    const files=[];
    for(const os of ['Windows','macOS','Linux'])for(const arch of ['x64','arm64'])for(const ext of {Windows:['exe'],macOS:['dmg','zip'],Linux:['AppImage','deb','rpm']}[os]) {
      const packageArch=ext==='rpm'?{x64:'x86_64',arm64:'aarch64'}[arch]:arch;
      const name=`OneYes-Canvas-${version}-${os}-${packageArch}${os==='Windows'?'-Setup':''}.${ext}`;
      await writeFile(join(dir,name),'fixture');files.push(name);
    }
    const verify=()=>spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8'});
    assert.equal(verify().status,0);
    const sums=await readFile(join(dir,'SHA256SUMS.txt'),'utf8');
    assert.equal(sums.trim().split('\n').length,12);assert.ok(sums.includes('Linux-aarch64.rpm'));
    await rm(join(dir,files[0]));assert.notEqual(verify().status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
