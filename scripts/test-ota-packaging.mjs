import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build,Platform,Arch}=require('electron-builder');
const {readBlockmap,planBlocks}=require('../desktop/update-blockmap.cjs');
if(process.platform!=='win32'){console.log('NSIS packing regression runs on native Windows');process.exit(0);}
const root=await mkdtemp(join(tmpdir(),'canvas-ota-packing-')),output=join(root,'output');
try{
    const payload=randomBytes(8*1024*1024);
    await writeFile(join(root,'static.bin'),payload);
    const files=[];
    for(const version of ['1.0.0','1.0.1']){
        await writeFile(join(root,'package.json'),JSON.stringify({name:'canvas-ota-fixture',version,description:'Isolated NSIS regression',author:'OneYes',main:'main.cjs'}));
        await writeFile(join(root,'main.cjs'),`module.exports = ${JSON.stringify(version)};\n`);
        await build({projectDir:root,targets:Platform.WINDOWS.createTarget('nsis',Arch[process.arch]),publish:'never',config:{
            appId:'ai.oneyes.canvas.ota-fixture',productName:'Canvas OTA Fixture',electronVersion:require('../package.json').devDependencies.electron,
            electronDist:resolve('node_modules/electron/dist'),directories:{output},files:['package.json','main.cjs','static.bin'],npmRebuild:false,
            artifactName:'fixture-${version}.${ext}',win:{icon:resolve('desktop/resources/icon.ico'),signAndEditExecutable:false},
            nsis:{differentialPackage:'store-asar'},publish:{provider:'generic',url:'https://invalid.example/'},
        }});
        const file=join(output,`fixture-${version}.exe`);files.push({file,size:(await stat(file)).size});
    }
    const [before,after]=await Promise.all(files.map(file=>readBlockmap(file.file+'.blockmap',file.size)));
    const plan=planBlocks(before,after,files[1].size);
    assert.ok(plan.total<payload.length,'a small app edit must not re-download the unchanged static payload');
    console.log(JSON.stringify({test:'real-store-asar-nsis',arch:process.arch,fullMiB:files[1].size/1048576,downloadMiB:plan.total/1048576,reusedPercent:plan.reused/files[1].size*100}));
}finally{await rm(root,{recursive:true,force:true});}
