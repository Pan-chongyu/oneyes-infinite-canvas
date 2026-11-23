const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { route } = require('../../desktop/protocol.cjs');
const root = process.env.CANVAS_SETUP_TEST_ROOT;
app.setPath('userData', join(root, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const user = { id: 7, username: '创作者', email: 'fixture@example.test' };
const groups = [{ id: 1, name: 'SVIP', platform: 'openai' }, { id: 2, name: 'DeepSeek', platform: 'deepseek' }, { id: 3, name: 'Video', platform: 'grok' }, { id: 4, name: 'JEV', platform: 'typesafe' }];
let stored = null, signedIn = true, fail = '', keys = [], calls = [];
ipcMain.handle('config:read', () => stored);
ipcMain.handle('config:write', (_event, value) => { stored = value; });
ipcMain.handle('account:call', (_event, op, args) => {
    calls.push(op);
    if (op === 'restore' || op === 'reuse') return { data: { user: signedIn ? user : null, source: 'desktop' } };
    if (op === 'login') return { data: { user: null, requires_2fa: true } };
    if (op === 'login_2fa') { signedIn = true; return { data: { user, source: 'login' } }; }
    assert.equal(args.account_id, user.id);
    if (op === 'groups') return fail === 'groups' ? { error: '网络连接失败，请重试' } : { data: groups };
    if (op === 'keys') return { data: { items: keys, total: keys.length } };
    if (op === 'create_key') {
        const group = groups.find(item => item.id === args.group_id);
        const key = { id: group.id, name: 'Canvas_无限画布', group_id: group.id, group, status: 'active', key: `fixture-${group.platform}` };
        assert.ok(!keys.some(item => item.id === key.id), 'never create duplicate keys');
        keys.push(key); return { data: key };
    }
    if (op === 'key') return { data: keys.find(item => item.id === args.id) };
    throw Error('Unexpected account operation: ' + op);
});
ipcMain.handle('models:list', (_event, key) => {
    if (fail === 'grok' && key === 'fixture-grok') return { error: '模型连接失败' };
    return { data: key === 'fixture-openai' ? ['gpt-image-2', 'gpt-5.5', 'gpt-4o-mini-tts'] : key === 'fixture-grok' ? ['grok-imagine-video'] : key === 'fixture-deepseek' ? ['deepseek-chat'] : ['jev'] };
});
app.whenReady().then(async () => {
    protocol.handle('oneyes-canvas', request => net.fetch(route(request.url, root).file));
    const win = new BrowserWindow({ width: 1000, height: 860, show: false, webPreferences: { preload: join(__dirname, '../../desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const end = Date.now() + 20000; while (!await js(`Boolean(${code})`)) { if (Date.now() > end) throw Error('Setup wait failed: ' + code + '; ' + await js('document.body.innerText')); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const click = async code => {
        await wait(code);
        await wait('[...document.getAnimations()].every(animation => animation.playState !== "running")');
        await js(`(${code}).scrollIntoView({block:'center',behavior:'instant'})`);
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const point = await js(`(()=>{const button=(${code}),rect=button.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);if(!button.contains(document.elementFromPoint(x,y)))throw Error('Setup button is not reachable: '+button.textContent+' at '+x+','+y);return{x,y}})()`);
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const button = text => `[...document.querySelectorAll('.ant-modal button')].find(button=>button.textContent===${JSON.stringify(text)})`;
    const ready = () => wait('setupTest.state().report.length === 4 && !setupTest.state().busy');
    const reset = async (mode = null, configured = false) => { calls = []; await js(`setupTest.reset(${JSON.stringify(mode)},${configured})`); };
    try {
        await win.loadURL(process.argv[2]); win.show(); win.focus();
        await wait('window.setupTest && document.querySelector("[data-setup-mode=beginner]")');
        assert.equal(calls.filter(op => op === 'groups').length, 0, 'a shared session must not configure before choosing');
        for (const dark of [false, true]) {
            await js(`setupTest.theme(${dark})`);
            await wait('[...document.getAnimations()].every(animation => animation.playState !== "running")');
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            if (!process.env.CI) { await mkdir('.secrets', { recursive: true }); await writeFile(`.secrets/qa-setup-${dark ? 'dark' : 'light'}.png`, (await win.webContents.capturePage()).toPNG()); }
        }
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(460, 800); });
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.ok(await js('document.querySelector("[data-setup-mode=expert]").getBoundingClientRect().top >= document.querySelector("[data-setup-mode=beginner]").getBoundingClientRect().bottom'), 'narrow screens stack choices');
        assert.ok(await js('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow');
        if (!process.env.CI) await writeFile('.secrets/qa-setup-narrow.png', (await win.webContents.capturePage()).toPNG());
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(1000, 860); });
        await click('document.querySelector("[data-setup-mode=beginner]")'); await ready();
        assert.equal(calls.filter(op => op === 'groups').length, 1, 'StrictMode must not duplicate automatic setup');
        assert.equal(calls.filter(op => op === 'create_key').length, 4);
        const state = await js('setupTest.state()');
        for (const key of ['imageModel', 'textModel', 'videoModel', 'audioModel']) assert.ok(state.config[key], key);
        assert.ok(state.report.every(item => item.code === 'ok'));
        await click(button('开始使用')); await wait('!document.querySelector(".ant-modal")');
        assert.equal(JSON.parse(stored).state.setupMode, 'beginner');
        assert.equal(JSON.parse(stored).state.setupStatus, 'completed');
        calls = []; await win.loadURL(process.argv[2]); await wait('window.setupTest');
        await wait('!setupTest.state().open');
        assert.equal(calls.filter(op => op === 'groups').length, 0, 'completed setup must not configure after restart');

        await reset(null, true);
        assert.equal(await js('setupTest.state().open'), false, 'existing configured users keep their workflow');
        assert.equal(await js('setupTest.state().config.imageModel'), 'default::gpt-image-2');
        await reset(); await click('document.querySelector("[data-setup-mode=expert]")');
        await wait(button('一键配置并继续'));
        assert.equal(calls.filter(op => op === 'groups').length, 0, 'Expert mode waits for the original explicit action');
        await click(button('一键配置并继续')); await ready();
        assert.equal(calls.filter(op => op === 'create_key').length, 0, 'existing keys are reused');

        signedIn = false; keys = [];
        await reset(); await click('document.querySelector("[data-setup-mode=beginner]")');
        await wait('document.querySelector("input#email")');
        await js(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value]of [['email','fixture@example.test'],['password','fake-password']]){const input=document.getElementById(id);set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
        await click(button('登录 OneYes'));
        await wait('document.querySelector("input#code")');
        assert.equal(calls.filter(op => op === 'groups').length, 0, 'two-factor authentication must complete before API setup');
        await js(`(()=>{const input=document.getElementById('code');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await click(button('验证并登录')); await ready();
        assert.equal(calls.filter(op => op === 'groups').length, 1);

        fail = 'groups'; await reset('beginner');
        await wait('!setupTest.state().busy && setupTest.state().error');
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(1000, 600); });
        assert.equal(calls.filter(op => op === 'groups').length, 1);
        await js('setupTest.theme(false)');
        assert.equal(calls.filter(op => op === 'groups').length, 1, 'failure/rerender must not trigger automatic retries');
        assert.equal(await js('setupTest.state().status'), 'pending');
        await click(button('手动配置 Key')); await wait('document.querySelector("input#openai")');
        await click(button('使用账户自动配置'));
        await wait(button('重新检查并配置'));
        await wait('!setupTest.state().busy && setupTest.state().error');
        assert.equal(calls.filter(op => op === 'groups').length, 2, 'returning from manual setup explicitly starts automatic setup again');
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(1000, 860); });
        fail = ''; await click(button('重新检查并配置')); await ready();
        assert.equal(calls.filter(op => op === 'create_key').length, 0);

        fail = 'grok'; await reset('beginner'); await ready();
        assert.ok((await js('setupTest.state().report')).some(item => item.code !== 'ok'));
        assert.ok(await js('document.body.textContent.includes("其余平台可重试")'));
        fail = ''; calls = []; await win.loadURL(process.argv[2]);
        await wait('window.setupTest && setupTest.state().report.length === 4 && setupTest.state().report.every(item=>item.code === "ok") && !setupTest.state().busy');
        assert.equal(calls.filter(op => op === 'groups').length, 1, 'unfinished Beginner setup resumes even with partially saved models');
        assert.equal(calls.filter(op => op === 'create_key').length, 0);
        await click(button('开始使用'));
        console.log('ONEYES_SETUP_OK: first launch choice, shared session, automatic keys/defaults, Expert explicit flow, 2FA, failure/retry, partial restart, no duplicate creation or paid generation');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
