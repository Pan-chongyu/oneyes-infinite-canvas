import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import toml from '@iarna/toml';

if(process.platform!=='win32')throw new Error('Windows-only dependency smoke test');
const directory=await mkdtemp(path.join(tmpdir(),'oneyes-windows-mcp-'));
process.env.CODEX_HOME=directory;
process.env.ONEYES_CANVAS_AGENT_HOME=directory;
process.env.ONEYES_DESKTOP_AGENT='1';
const {prepareWindowsMcp,probeWindowsMcp}=await import('../canvas-agent/dist/agent/windows-mcp.js');
const original='model="unchanged"\n[mcp_servers.windows-mcp]\ncommand="C:\\\\missing-oneyes-runtime\\\\uvx.exe"\nargs=["windows-mcp","serve"]\nstartup_timeout_sec=120\n';
let codex;
try {
  await writeFile(path.join(directory,'config.toml'),original);
  const options={installing:()=>console.log('Preparing isolated Windows-MCP dependencies')};
  const prepared=await prepareWindowsMcp(options);
  assert.ok(prepared.command.startsWith(directory));
  const ready=await probeWindowsMcp(prepared);
  assert.ok(ready.tools>0);
  const cached=await prepareWindowsMcp(options);
  assert.equal(cached.command,prepared.command);
  assert.equal(await readFile(path.join(directory,'config.toml'),'utf8'),original);
  const {saveConfig}=await import('../canvas-agent/dist/config.js');
  saveConfig({url:'http://127.0.0.1:1',token:randomBytes(18).toString('hex')});
  const {CodexAppClient}=await import('../canvas-agent/dist/agent/codex-client.js');
  const events=[];
  codex=await CodexAppClient.start((type,payload)=>events.push({type,payload}),()=>{});
  const thread=await codex.startThread(directory,'request',true);
  assert.ok(thread.id);
  assert.ok(events.some(event=>event.type==='agent_bootstrap'&&event.payload.name==='windows-mcp'&&event.payload.status==='ready'),'Native Codex did not load the automatically prepared tools');
  const after=toml.parse(await readFile(path.join(directory,'config.toml'),'utf8'));
  // Codex itself may add its normal workspace trust entry when starting a thread.
  assert.equal(after.model,'unchanged');
  assert.deepEqual(after.mcp_servers,toml.parse(original).mcp_servers);
  console.log('WINDOWS_MCP_DEPENDENCIES_OK',JSON.stringify(ready));
} finally {
  // Only the test-owned app-server tree is stopped. No model turns or tool actions are sent.
  if(codex?.child?.pid)await promisify(execFile)(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(codex.child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:300});
}
