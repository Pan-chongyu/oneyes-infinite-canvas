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
    // Actual electron-builder filenames, including target-specific Linux aliases.
    for(const suffix of ['Windows-x64-Setup.exe','Windows-arm64-Setup.exe','macOS-x64.dmg','macOS-x64.zip','macOS-arm64.dmg','macOS-arm64.zip','Linux-x86_64.AppImage','Linux-amd64.deb','Linux-x86_64.rpm','Linux-arm64.AppImage','Linux-arm64.deb','Linux-aarch64.rpm']) {
      const name=`OneYes-Canvas-${version}-${suffix}`;
      await writeFile(join(dir,name),'fixture');files.push(name);
    }
    const verify=()=>spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8'});
    assert.equal(verify().status,0);
    const sums=await readFile(join(dir,'SHA256SUMS.txt'),'utf8');
    assert.equal(sums.trim().split('\n').length,12);assert.ok(sums.includes('Linux-aarch64.rpm'));
    await rm(join(dir,files[0]));assert.notEqual(verify().status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
