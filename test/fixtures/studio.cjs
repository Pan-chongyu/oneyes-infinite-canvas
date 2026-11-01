const { app, BrowserWindow, protocol, net } = require("electron");
const assert = require("node:assert/strict");
const {writeFile}=require('node:fs/promises');
const { route } = require("../../desktop/protocol.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "oneyes-canvas",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
app.setPath("userData", process.env.CANVAS_STUDIO_TEST_PROFILE);
app
  .whenReady()
  .then(async () => {
    protocol.handle("oneyes-canvas", (request) =>
      net.fetch(route(request.url, process.env.CANVAS_STUDIO_TEST_ROOT).file),
    );
    const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 1000,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      }),
      js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      const until = Date.now() + 20000;
      while (!(await js(code))) {
        if (Date.now() > until)
          throw Error("Studio fixture timed out: " + code);
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const click = async (text) => {
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    try {
      await win.loadURL(process.argv[2]);
      await wait("Boolean(window.studioTest)");
      if (process.env.CANVAS_STUDIO_TEST_PHASE === "restore") {
        assert.equal(
          await js("studioTest.calls().length"),
          0,
          "restart must not submit any model task",
        );
        await js("studioTest.batch()");
        assert.equal(
          await js("studioTest.calls().length"),
          0,
          "uncertain task must not replay",
        );
        assert.match(
          await js(
            'studioTest.state().nodes.find(n=>n.id==="tool").metadata.errorDetails',
          ),
          /已有任务尚未完成/,
        );
        console.log(
          "STUDIO_RESTART_OK: persisted batch state, uncertain submission never replays",
        );
        app.exit(0);
        return;
      }
      await js('studioTest.tool("storyboard",[],{text:"雨夜跑车"})');
      await wait('document.querySelector("[data-studio-panel=storyboard]")');
      await click("生成分镜");
      await wait('document.body.textContent.includes("输出镜头节点")');
      await click("输出镜头节点（不自动生成）");
      assert.equal(
        await js('studioTest.state().nodes.filter(n=>n.type==="video").length'),
        1,
      );
      assert.equal(await js("studioTest.calls().length"), 0);
      await js(
        'studioTest.tool("reference",["source0","source1"],{role:"角色 A",style:"电影"})',
      );
      await wait('document.querySelector("[data-studio-panel=reference]")');
      const context = await js("studioTest.reference()");
      assert.equal(context.referenceImages.length, 2);
      assert.match(context.prompt, /角色 A/);
      await js('studioTest.tool("ocr",["source0"])');
      await wait('document.querySelector("[data-studio-panel=ocr]")');
      await click("提取文字");
      await wait(
        'studioTest.state().nodes.some(n=>n.type==="text"&&n.metadata.content==="识别文字")',
      );
      assert.match(
        await js("studioTest.requests().at(-1).references[0]"),
        /^data:image\/png;base64,/,
      );
      await js(
        'studioTest.tool("compare",["source0","source1"],{selectedId:"source1"})',
      );
      await wait('document.querySelector("[data-studio-panel=compare]")');
      await click("输出精选图片");
      await wait(
        'studioTest.state().nodes.filter(n=>n.type==="image").length===3',
      );
      assert.deepEqual(
        await js("studioTest.image()").then((x) => [x.width, x.height]),
        [10, 8],
      );
      if(process.env.CANVAS_STUDIO_TEST_SCREENSHOT)await writeFile(process.env.CANVAS_STUDIO_TEST_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      const exported = await js("studioTest.export()");
      assert.equal(exported.identical, true);
      assert.equal(exported.names.length, 2);
      assert.ok(exported.names.every((name) => !/[\\/]/.test(name)));
      assert.doesNotMatch(exported.params, /fixture-private-secret|apiKey/);
      await js("studioTest.theme(true)");
      await wait('document.documentElement.classList.contains("dark")');
      await js(
        'studioTest.tool("creator-tools:board",["source0","source1"],{columns:2,gap:2,labels:false})',
      );
      await wait('document.querySelector("[data-creator-panel=board]")');
      await click("生成分镜板");
      await wait(
        'studioTest.state().nodes.filter(n=>n.type==="image").length===3',
      );
      assert.deepEqual(
        await js("studioTest.image()").then((x) => [x.width, x.height]),
        [26, 12],
      );
      await js(
        'studioTest.tool("creator-tools:color",["source0"],{exposure:1,contrast:1,temperature:0,matchId:"source1"})',
      );
      await wait('document.querySelector("[data-creator-panel=color]")');
      await click("输出调色图片");
      await wait(
        'studioTest.state().nodes.filter(n=>n.type==="image").length===3',
      );
      assert.deepEqual(
        await js("studioTest.image()").then((x) => [x.width, x.height]),
        [9, 7],
      );
      await js('studioTest.tool("batch",[],{text:"第一张\\n第二张"})');
      await wait('document.querySelector("[data-studio-panel=batch]")');
      await click("开始批量生成");
      await wait('document.body.textContent.includes("确认生成")');
      assert.equal(await js("studioTest.calls().length"), 0);
      await click("确认生成");
      await wait(
        'studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.items?.every(i=>i.state==="done")',
      );
      assert.equal(await js("studioTest.calls().length"), 2);
      await js(
        'studioTest.tool("batch",[],{text:"保存失败"});studioTest.fail("failSave",true);studioTest.batch()',
      );
      await wait("!studioTest.active()");
      assert.equal(
        await js("studioTest.calls().length"),
        2,
        "failed persistence must not submit",
      );
      await js('studioTest.fail("failSave",false)');
      await js(
        'studioTest.tool("batch",[],{text:"暂停当前\\n不能执行"});studioTest.fail("hold",true);void studioTest.batch()',
      );
      await wait("studioTest.calls().length===3");
      await js("studioTest.pause();studioTest.release()");
      await wait("!studioTest.active()");
      assert.equal(
        await js("studioTest.calls().length"),
        3,
        "pause must not start a second item",
      );
      await js('studioTest.fail("hold",false)');
      await js(
        'studioTest.tool("batch",[],{text:"失败任务\\n不应执行"});studioTest.fail("failGenerate",true);studioTest.batch()',
      );
      await wait("!studioTest.active()");
      assert.equal(await js("studioTest.calls().length"), 4);
      const failed = await js(
        'studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.items',
      );
      assert.deepEqual(
        failed.map((i) => i.state),
        ["started", "pending"],
      );
      await js('studioTest.fail("failGenerate",false);studioTest.batch()');
      assert.equal(
        await js("studioTest.calls().length"),
        4,
        "failure must not resubmit",
      );
      await js("studioTest.persist()");
      console.log(
        "STUDIO_UI_OK: editable shots, reference bundle, OCR originals, compare selection, exact-size image workers, dark theme, explicit batch confirmation, sequential completion and failure pause",
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
