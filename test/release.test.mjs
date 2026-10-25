import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,verify} from 'node:crypto';
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
    const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'}),privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'});
    const run=()=>spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8',env:{...process.env,CANVAS_OTA_PRIVATE_KEY:privateKey,CANVAS_OTA_TEST_PUBLIC_KEY:publicKey}});
    const result=run();assert.equal(result.status,0,result.stderr);
    const sums=await readFile(join(dir,'SHA256SUMS.txt'),'utf8');
    assert.equal(sums.trim().split('\n').length,12);assert.ok(sums.includes('Linux-aarch64.rpm'));
    const text=await readFile(join(dir,'canvas-latest.json'),'utf8'),signature=await readFile(join(dir,'canvas-latest.json.sig'),'utf8');
    assert.ok(verify(null,Buffer.from(text),publicKey,Buffer.from(signature.trim(),'base64')));
    assert.equal(Object.keys(JSON.parse(text).platforms).length,10);
    assert.ok(JSON.parse(text).platforms['linux-arm64-rpm'].file.endsWith('Linux-aarch64.rpm'));
    await rm(join(dir,files[0]));assert.notEqual(run().status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
