import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
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
    const currentPayload=Buffer.from('shared installer fixture '.repeat(2000)+'new release');
    const files=[];
    // Actual electron-builder filenames, including target-specific Linux aliases.
    for(const suffix of ['Windows-x64-Setup.exe','Windows-arm64-Setup.exe','macOS-x64.dmg','macOS-x64.zip','macOS-arm64.dmg','macOS-arm64.zip','Linux-x86_64.AppImage','Linux-amd64.deb','Linux-x86_64.rpm','Linux-arm64.AppImage','Linux-arm64.deb','Linux-aarch64.rpm']) {
      const name=`OneYes-Canvas-${version}-${suffix}`;
      await writeFile(join(dir,name),currentPayload);files.push(name);
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
      const previous='0.20.20',basePayload=Buffer.from('shared installer fixture '.repeat(2000)+'previous release'),basePlatforms={};
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
      const independent=await mkdtemp(join(tmpdir(),'canvas-release-independent-'));
      try{
        const target={platform:'win32',arch:'x64',format:'nsis'},file=filename(version,target.platform,target.arch,target.format);
        await copyFile(join(dir,file),join(independent,file));
        const env={...process.env,CANVAS_OTA_PRIVATE_KEY:'',CANVAS_OTA_TEST_PUBLIC_KEY:publicKey,CANVAS_OTA_BASE_DIR:baseDir,CANVAS_OTA_BSDIFF:'',CANVAS_OTA_DELTA_TARGET:platformKey(target)};
        const generated=spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',independent],{encoding:'utf8',env});
        assert.equal(generated.status,0,generated.stderr);
        await assert.rejects(readFile(join(independent,'canvas-latest.json')),'independent jobs must never sign or publish a partial manifest');
        const deltaFile=readManifest(deltaText,deltaSignature,target,publicKey,previous).delta.file;
        await copyFile(join(independent,deltaFile),join(dir,deltaFile));
        const aggregate=()=>spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8',env:{...env,CANVAS_OTA_DELTA_TARGET:'',CANVAS_OTA_PRIVATE_KEY:privateKey,CANVAS_OTA_PREBUILT_DELTAS:'1',CANVAS_OTA_BSDIFF:'must-not-generate-during-aggregation'}});
        assert.equal(aggregate().status,0,'final aggregation must reconstruct the prebuilt deltas without rerunning bsdiff');
        await writeFile(join(dir,deltaFile),'tampered');assert.notEqual(aggregate().status,0,'tampered worker artifacts must block signing');
        await rm(join(dir,deltaFile));assert.equal(aggregate().status,0,'a skipped delta keeps the signed full package available');
        const aggregated=JSON.parse(await readFile(join(dir,'canvas-latest.json'),'utf8'));
        assert.equal(Object.keys(aggregated.platforms).length,10);assert.equal(Object.keys(aggregated.deltas).length,9);
        await copyFile(join(independent,deltaFile),join(dir,deltaFile));
        const pin=spawnSync(process.execPath,['scripts/prepare-ota-base.mjs',baseDir,'--pinned','--manifest-only'],{encoding:'utf8',env});
        assert.equal(pin.status,0,pin.stderr);
      }finally{await rm(independent,{recursive:true,force:true});}
      const skipped=spawnSync(process.execPath,['scripts/verify-desktop-release.mjs',dir],{encoding:'utf8',env:{...process.env,CANVAS_OTA_PRIVATE_KEY:privateKey,CANVAS_OTA_TEST_PUBLIC_KEY:publicKey,CANVAS_OTA_BASE_DIR:baseDir,CANVAS_OTA_BSDIFF:process.execPath,CANVAS_OTA_DELTA_TIMEOUT_MS:'1000'}});
      assert.equal(skipped.status,0,skipped.stderr);assert.equal(JSON.parse(await readFile(join(dir,'canvas-latest.json'),'utf8')).deltas,undefined);await assert.rejects(readFile(join(dir,'SHA256SUMS-deltas.txt')));
      await writeFile(join(baseDir,Object.values(basePlatforms)[0].file),'tampered');assert.notEqual(runDelta().status,0);
    } finally {await rm(baseDir,{recursive:true,force:true});}
    await rm(join(dir,files[0]));assert.notEqual(run().status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('parallel release covers every OTA target and publishes only after all builds and delta jobs pass', async()=>{
  const {parse}=require('../canvas-agent/node_modules/yaml');
  const workflow=parse(await readFile('.github/workflows/desktop-release.yml','utf8'));
  const expected=['win32','darwin','linux'].flatMap(platform=>['x64','arm64'].flatMap(arch=>({win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]).map(format=>platformKey({platform,arch,format}))));
  assert.deepEqual(workflow.jobs.delta.strategy.matrix.include.map(item=>item.target).sort(),expected.sort());
  assert.deepEqual(workflow.jobs.publish.needs,['build','ota-base','delta']);
  assert.equal(workflow.jobs.delta.steps.find(step=>step.name==='Generate and reconstruct this target\'s delta').env.CANVAS_OTA_DELTA_TIMEOUT_MS,120000);
  assert.equal(workflow.jobs.publish.steps.find(step=>step.name==='Verify every platform and generate checksums').env.CANVAS_OTA_PREBUILT_DELTAS,'1');
});
