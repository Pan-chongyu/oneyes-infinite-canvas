import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const source=(path: string)=>fileURLToPath(new URL(path,import.meta.url));
export default defineConfig({
  base:'/editor/',publicDir:false,plugins:[react()],
  resolve:{alias:[
    ...['provider-sdk','protocol','core-ts','render-sdk','scene-sdk','runtime','collab-sdk','agent-sdk'].flatMap(name=>[
      {find:new RegExp('^@velocut/'+name+'$'),replacement:source('../../packages/'+name+'/src/'+(name==='protocol'?'types':name==='core-ts'?'engine':'index')+'.ts')},
      {find:new RegExp('^@velocut/'+name+'/(.*)$'),replacement:source('../../packages/'+name+'/src/')+'$1.ts'},
    ]),
  ]},build:{target:'esnext',outDir:'../../../../../web/dist/editor',emptyOutDir:true},
});
