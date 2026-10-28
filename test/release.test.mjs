import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,verify,sign,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{filename,platformKey,RELEASE_ROOT,readManifest}=require('../desktop/update-policy.cjs');
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
    const baseDir=await mkdtemp(join(tmpdir(),'canvas-release-base-'));
    try {
      const previous='0.20.20',basePayload=Buffer.from('previous fixture'),basePlatforms={};
      for(const platform of ['win32','darwin','linux'])for(const arch of ['x64','arm64'])for(const format of {win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]){
        const file=filename(previous,platform,arch,format);
        basePlatforms[platformKey({platform,arch,format})]={file,url:`${RELEASE_ROOT}/download/v${previous}/${file}`,size:basePayload.length,sha256:createHash('sha256').update(basePayload).digest('hex')};
        await writeFile(join(baseDir,file),basePayload);
      }
      const baseText=JSON.stringify({schema:1,version:previous,notes:'base',platforms:basePlatforms});
      await writeFile(join(baseDir,'canvas-latest.json'),baseText);
      await writeFile(join(baseDir,'canvas-latest.json.sig'),sign(null,Buffer.from(baseText),privateKey).toString('base64'));
      const runDelta=()=>spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8',env:{...process.env,CANVAS_OTA_PRIVATE_KEY:privateKey,CANVAS_OTA_TEST_PUBLIC_KEY:publicKey,CANVAS_OTA_BASE_DIR:baseDir,CANVAS_OTA_BSDIFF:''}});
      const deltaRun=runDelta();assert.equal(deltaRun.status,0,deltaRun.stderr);
      const deltaText=await readFile(join(dir,'canvas-latest.json'),'utf8'),deltaSignature=await readFile(join(dir,'canvas-latest.json.sig'),'utf8');
      const manifest=JSON.parse(deltaText);assert.equal(Object.keys(manifest.deltas).length,10);
      for(const key of Object.keys(manifest.deltas)){
        const [platform,arch,format]=key.split('-');
        const entry=readManifest(deltaText,deltaSignature,{platform,arch,format},publicKey,previous);
        assert.equal(entry.delta.from,previous);assert.equal(entry.delta.targetSha256,entry.sha256);
        assert.equal(createHash('sha256').update(await readFile(join(dir,entry.delta.file))).digest('hex'),entry.delta.sha256);
      }
      assert.equal((await readFile(join(dir,'SHA256SUMS.txt'),'utf8')).trim().split('\n').length,12);
      assert.equal((await readFile(join(dir,'SHA256SUMS-deltas.txt'),'utf8')).trim().split('\n').length,10);
      await writeFile(join(baseDir,Object.values(basePlatforms)[0].file),'tampered');assert.notEqual(runDelta().status,0);
    } finally {await rm(baseDir,{recursive:true,force:true});}
    await rm(join(dir,files[0]));assert.notEqual(run().status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
