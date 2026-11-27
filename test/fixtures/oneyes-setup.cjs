const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { route } = require('../../desktop/protocol.cjs');
const root = process.env.CANVAS_SETUP_TEST_ROOT;
app.setPath('userData', join(root, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const user = { id: 7, username: '创作者', email: 'fixture@example.test' };
const groups = [{ id: 1, name: 'SVIP', platform: 'openai' }, { id: 2, name: 'DeepSeek', platform: 'deepseek' }, { id: 3, name: 'Video', platform: 'grok' }, { id: 4, name: 'JEV', platform: 'typesafe' }, { id: 5, name: 'Gemini', platform: 'gemini' }];
const geminiReads = [];
const geminiCalls = [];
let stored = null, signedIn = true, fail = '', keys = [], calls = [];
ipcMain.handle('config:read', () => stored);
ipcMain.handle('config:write', (_event, value) => { stored = value; });
ipcMain.handle('diagnostics:report', () => null);
ipcMain.handle('account:call', (_event, op, args) => {
    calls.push(op);
    if (op === 'restore' || op === 'reuse') return { data: { user: signedIn ? user : null, source: 'desktop' } };
    if (op === 'login') return { data: { user: null, requires_2fa: true } };
    if (op === 'login_2fa') { signedIn = true; return { data: { user, source: 'login' } }; }
    if (op === 'logout') { signedIn = false; return { data: {} }; }
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
    assert.notEqual(key, 'fixture-gemini', 'Gemini discovers models through its native API');
    if (fail === 'grok' && key === 'fixture-grok') return { error: '模型连接失败' };
    return { data: key === 'fixture-openai' ? ['gpt-image-2', 'gpt-5.5', 'gpt-4o-mini-tts'] : key === 'fixture-grok' ? ['grok-imagine-video'] : key === 'fixture-deepseek' ? ['deepseek-chat'] : ['jev'] };
});
app.whenReady().then(async () => {
    protocol.handle('oneyes-canvas', async request => {
        const target = route(request.url, root);
        if (target.file) return net.fetch(target.file);
        const url = new URL(target.apis[0]);
        assert.equal(url.origin, 'https://oneyes.ai');
        assert.equal(request.headers.get('x-goog-api-key'), 'fixture-gemini');
        assert.equal(request.headers.get('Authorization'), null);
        if (url.pathname === '/v1beta/models') {
            assert.equal(request.method, 'GET');
            const cursor = url.searchParams.get('pageToken');
            geminiReads.push(cursor);
            if (cursor) {
                assert.equal(cursor, 'next/page+1');
                return Response.json({ models: [
                    { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] },
                    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
                    { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
                ] });
            }
            return Response.json({ models: [
                { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
                { name: 'models/gemini-nano-banana-2.1', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
                { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
            ], nextPageToken: 'next/page+1' });
        }
        assert.equal(request.method, 'POST');
        const payload = await request.json();
        geminiCalls.push(url.pathname);
        if (url.pathname === '/v1beta/models/gemini-nano-banana-2.1:generateContent') {
            assert.deepEqual(payload.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
            return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] });
        }
        assert.equal(url.pathname, '/v1beta/models/gemini-3-flash-preview:streamGenerateContent');
        assert.equal(url.searchParams.get('alt'), 'sse');
        assert.equal(payload.contents[0].parts[0].text, 'fixture text');
        const answer = { candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }] };
        return new Response('data: ' + JSON.stringify(answer) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const win = new BrowserWindow({ width: 1000, height: 860, show: false, webPreferences: { preload: join(__dirname, '../../desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const end = Date.now() + 20000; while (!await js(`Boolean(${code})`)) { if (Date.now() > end) throw Error('Setup wait failed: ' + code + '; ' + await js('document.body.innerText') + '; ' + await js('JSON.stringify(window.setupTrace)')); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const click = async code => {
        await wait(code);
        await wait('[...document.getAnimations()].every(animation => animation.playState !== "running")');
        await js(`(${code}).scrollIntoView({block:'center',behavior:'instant'})`);
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await wait('[...document.getAnimations()].every(animation => animation.playState !== "running")');
        const point = await js(`(()=>{const button=(${code}),rect=button.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);if(!button.contains(document.elementFromPoint(x,y)))throw Error('Setup button is not reachable: '+button.textContent+' at '+x+','+y);return{x,y}})()`);
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const button = text => `[...document.querySelectorAll('.ant-modal button')].find(button=>button.textContent===${JSON.stringify(text)})`;
    const ready = () => wait('setupTest.state().report.length === 5 && !setupTest.state().busy');
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
        assert.equal(calls.filter(op => op === 'create_key').length, 5);
        const state = await js('setupTest.state()');
        for (const key of ['imageModel', 'textModel', 'videoModel', 'audioModel']) assert.ok(state.config[key], key);
        assert.ok(state.report.every(item => item.code === 'ok'));
        assert.deepEqual(geminiReads.slice(0, 2), [null, 'next/page+1']);
        assert.equal(geminiCalls.length, 0, 'setup must only discover models');
        const gemini = state.config.channels.find(channel => channel.id === 'oneyes-gemini');
        assert.deepEqual(Object.fromEntries(gemini.models.map(({ name, capability }) => [name, capability])), {
            'gemini-3-flash-preview': 'text', 'gemini-3.1-flash-image': 'image', 'gemini-nano-banana-2.1': 'image',
        });
        assert.deepEqual(await js('setupTest.callGemini()'), { images: 1, answer: 'Gemini response' });
        assert.equal(geminiCalls.length, 2);
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
        await wait('window.setupTest && setupTest.state().report.length === 5 && setupTest.state().report.every(item=>item.code === "ok") && !setupTest.state().busy');
        assert.equal(calls.filter(op => op === 'groups').length, 1, 'unfinished Beginner setup resumes even with partially saved models');
        assert.equal(calls.filter(op => op === 'create_key').length, 0);
        await click(button('开始使用'));
        console.log('ONEYES_SETUP_OK: first launch choice, shared session, automatic keys/defaults, Expert explicit flow, 2FA, failure/retry, partial restart, no duplicate creation or paid generation');

        await wait('!document.querySelector(".ant-modal")');
        await js('setupTest.showPages()');
        await click('document.querySelector(\'nav a[href="/config"]\')');
        await wait('document.querySelector("h1")?.textContent === "配置与用户偏好" && document.querySelector("[data-testid=config-preferences]")');
        assert.ok(await js('![...document.querySelectorAll("[role=tab]")].some(tab=>tab.textContent==="模型接入")'));
        const beforeProfile = await js('setupTest.state().config');
        await click('document.querySelector(\'nav a[href="/profile"]\')');
        await wait('document.querySelector("h1")?.textContent === "个人中心" && document.querySelectorAll("[data-platform]").length === 5');
        assert.ok(await js('document.querySelector("[data-platform=gemini]")?.textContent.includes("生图与文本")'));
        assert.ok(await js('document.querySelector("main").textContent.includes("创作者") && document.querySelector("main").textContent.includes("已复用 OneYes 客户端登录态")'));
        assert.equal(await js('document.querySelector(\'nav a[href="/profile"]\').getAttribute("aria-current")'), 'page');
        assert.deepEqual(await js('setupTest.state().config'), beforeProfile);
        if (!process.env.CI) await writeFile('.secrets/qa-profile-desktop.png', (await win.webContents.capturePage()).toPNG());
        await click('document.querySelector(\'[data-platform=grok] button\')');
        const saveModels = '[...document.querySelectorAll(".ant-drawer-open button")].find(button=>button.textContent==="保存设置" && !button.disabled)';
        await wait(`(${saveModels}) && document.querySelector(".ant-drawer-open")?.textContent.includes("grok-imagine-video")`);
        await click(saveModels);
        await wait('!document.querySelector(".ant-drawer-open")');
        assert.equal(await js('setupTest.state().config.videoModel'), beforeProfile.videoModel);
        await click('[...document.querySelectorAll("main button")].find(button=>button.textContent==="配置向导")');
        await wait('document.querySelector(".ant-modal")?.textContent.includes("创作者")');
        await click('document.querySelector(".ant-modal-close")');
        await wait('!document.querySelector(".ant-modal")');

        await click('document.querySelector(\'nav a[href="/config"]\')');
        await wait('document.querySelector("main [data-testid=config-preferences]")');
        await js('setupTest.requestModels()');
        await wait('document.querySelector(".ant-modal [data-platform=grok]")');
        assert.ok(await js('document.querySelector("main [data-testid=config-preferences]") && !document.querySelector(".ant-modal [role=tab]")'));
        await click('document.querySelector(".ant-modal-footer button.ant-btn-primary")');
        await wait('!document.querySelector(".ant-modal")');

        await new Promise(resolve => { win.once('resize', resolve); win.setSize(460, 800); });
        await click('document.querySelector(\'button[aria-label="打开导航菜单"]\')');
        await click('document.querySelector(\'.ant-drawer-open a[href="/profile"]\')');
        await wait('document.querySelector("h1")?.textContent === "个人中心" && !document.querySelector(".ant-drawer-open")');
        if (!process.env.CI) await wait('![...document.querySelectorAll(".ant-drawer-mask, .ant-message-notice")].some(el=>el.getClientRects().length)');
        for (const dark of [false, true]) {
            await js(`setupTest.theme(${dark})`);
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert.ok(await js('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth + 1'), 'profile fits the narrow window');
            if (!process.env.CI) {
                await wait('[...document.getAnimations()].every(animation=>animation.playState!=="running")');
                await writeFile(`.secrets/qa-profile-narrow-${dark ? 'dark' : 'light'}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        await click('[...document.querySelectorAll("main button")].find(button=>button.textContent==="退出连接")');
        await wait('document.querySelector("main").textContent.includes("连接 OneYes") && !setupTest.state().busy');
        assert.equal(calls.filter(op => op === 'logout').length, 1);
        assert.equal(calls.filter(op => op === 'create_key').length, 0, 'opening the account page does not create keys');
        console.log('ONEYES_PROFILE_OK: sidebar and narrow navigation, shared account, model editor, setup and contextual model access, sign-out');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
