const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-chat-test-')));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const state = () => js('chatTest.state()');
    const wait = async (condition) => {
        const until = Date.now() + 20000;
        while (!await js(condition)) {
            if (Date.now() > until) throw new Error(`Timed out: ${condition}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const type = async (text) => {
        assert.equal(await js('document.querySelector("[role=textbox]").isContentEditable'), true, 'draft must remain editable');
        await js('document.querySelector("[role=textbox]").focus()');
        await win.webContents.insertText(text);
        await wait(`chatTest.state().prompt === ${JSON.stringify(text)}`);
    };
    const enter = async () => {
        // Hidden Linux windows have no OS keyboard focus; exercise the same React key handler through DOM events.
        await js('document.querySelector("[role=textbox]").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", code:"Enter", keyCode:13, bubbles:true, cancelable:true}))');
        await js('new Promise(resolve => setTimeout(resolve, 50))');
    };
    try {
        await win.loadURL(process.argv[2]);
        await wait('window.chatTest && chatTest.state().status === "ready" && !chatTest.state().loadingThreads && document.querySelector("[role=textbox]")');
        await type('first message'); await enter();
        await wait('chatTest.state().waiting && chatTest.state().turns.length === 1');
        await type('下一条消息'); await enter();
        assert.equal((await state()).turns.length, 1, 'running turn must reject duplicate submission');
        await js('chatTest.holdHistory(); chatTest.complete()');
        await wait('chatTest.state().status === "ready" && chatTest.state().pendingHistory === 1');
        assert.equal((await state()).prompt, '下一条消息', 'completion must retain the next draft');
        await enter();
        await wait('chatTest.state().turns.length === 2 && chatTest.state().waiting');
        assert.equal((await state()).turns[1].prompt, '下一条消息');
        await js('chatTest.releaseHistory()');
        await wait('!chatTest.state().loadingThreads');
        assert.equal((await state()).waiting, true, 'stale history cannot end the current turn');
        await js('chatTest.complete()');
        await wait('chatTest.state().status === "ready" && !chatTest.state().loadingThreads');
        await js('document.querySelector("[role=textbox]").dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))');
        await win.webContents.insertText('中文输入');
        await js('document.querySelector("[role=textbox]").dispatchEvent(new CompositionEvent("compositionend", {bubbles:true}))');
        await wait('chatTest.state().prompt === "中文输入"');
        await enter();
        await wait('chatTest.state().turns.length === 3');
        assert.equal((await state()).turns[2].prompt, '中文输入');
        await js('chatTest.complete()');
        await wait('chatTest.state().status === "ready" && !chatTest.state().loadingThreads');
        await js('chatTest.rejectNext()'); await type('will fail'); await enter();
        await wait('chatTest.state().turns.length === 4');
        await type('失败时保留新草稿'); await js('chatTest.failTurn()');
        await wait('!chatTest.state().sending');
        assert.equal((await state()).prompt, '失败时保留新草稿');
        await js('chatTest.holdHistory(); chatTest.refreshHistory()');
        await wait('chatTest.state().pendingHistory === 1');
        await js('chatTest.changeThread()');
        await wait('chatTest.state().threadId === "thread-2"');
        await js('chatTest.releaseHistory()');
        await wait('!chatTest.state().loadingThreads');
        assert.equal((await state()).threadId, 'thread-2', 'invalidated snapshot cannot switch back');
        console.log('CHAT_INPUT_REGRESSION_OK: consecutive turns, slow/stale history, draft during reply, IME, send failure, snapshot invalidation');
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
