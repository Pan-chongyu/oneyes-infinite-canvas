import {readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildBlockMap}=require('app-builder-lib/out/targets/blockmap/blockmap');
const {readBlockmap}=require('../desktop/update-blockmap.cjs');

export async function prepareBlockmap(file) {
    const size=(await stat(file)).size,map=file+'.blockmap';
    // Preserve NSIS' finer chunks for its uncompressed app.asar region.
    try {await readBlockmap(map,size);}
    catch(error) {if(error.code!=='ENOENT')throw error;await buildBlockMap(file,'gzip',map);}
    await readBlockmap(map,size);
    return map;
}

export async function prepareBlockmaps(directory) {
    for(const name of await readdir(directory))if(/\.(exe|zip|AppImage|deb|rpm)$/.test(name)){
        await prepareBlockmap(join(directory,name));
        console.log(`Verified streaming block map: ${name}`);
    }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await prepareBlockmaps(resolve(process.argv[2]));
