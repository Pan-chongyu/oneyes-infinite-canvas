import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const web=resolve('vendor/velocut/web'), out=resolve('web/dist/editor');
execFileSync(process.execPath,[resolve(web,'node_modules/vite/bin/vite.js'),'build','--config','oneyes.vite.config.ts'],{cwd:resolve(web,'apps/editor'),stdio:'inherit'});
await cp(resolve(web,'packages/scene-sdk/assets'),resolve(out,'scene-assets'),{recursive:true});
await mkdir(resolve(out,'licenses'),{recursive:true});
await cp(resolve('vendor/velocut/LICENSE'),resolve(out,'licenses/velocut.txt'));
const notices=[];
const modules=resolve(web,'node_modules');
for(const entry of await readdir(modules)) {
  const names=entry.startsWith('@')?(await readdir(resolve(modules,entry))).map(name=>entry+'/'+name):[entry];
  for(const name of names){
    const root=resolve(modules,name),pkg=await readFile(resolve(root,'package.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(!pkg)continue;
    const texts=[];
    for(const file of await readdir(root))if(/^(license|licence|copying|notice)(\.|$)/i.test(file)){
      const content=await readFile(resolve(root,file),'utf8').catch(()=>null);if(content)texts.push(file+'\n'+content);
    }
    notices.push(`${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}\n${texts.join('\n')}`);
  }
}
await writeFile(resolve(out,'licenses/dependencies.txt'),notices.join('\n\n'+'='.repeat(72)+'\n\n'));
