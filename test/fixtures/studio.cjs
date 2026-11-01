const { app, BrowserWindow, protocol, net } = require("electron");
const assert = require("node:assert/strict");
const {writeFile}=require('node:fs/promises');
const { createServer } = require('node:http');
const { createNetwork } = require('../../desktop/network.cjs');
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
    const decisions = [];
    let releaseDecision;
    const upstream = createServer(async (req, res) => {
      try {
        assert.equal(req.url, '/v1/systemone');
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Bearer fixture-jev-key');
        assert.equal(req.headers['typesafe-danger-zone-images'], undefined);
        const parts = []; for await (const part of req) parts.push(part);
        const body = JSON.parse(Buffer.concat(parts).toString()); decisions.push(body);
        assert.equal(body.model, 'jev-latest');
        const q = body.questions.decision;
        if (body.state === 'hold') await new Promise(resolve => { releaseDecision = resolve; });
        if (body.state === 'auth-failure') { res.writeHead(403); res.end('private upstream details'); return; }
        const keys = q.type === 'score' ? q.criteria.map((_, i) => String(i)) : q.type === 'choice' ? Object.keys(q.criteria) : [];
        const probabilities = Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 0.8 : 0.2 / (keys.length - 1)]));
        const answer = q.type === 'noul' ? { type: 'noul', noul: 0.9 } : q.type === 'choice' ? { type: 'choice', choice: keys[0], confidence: 0.8, probabilities } : { type: 'score', score: 0.2, confidence: 0.8, probabilities, legend: Object.fromEntries(keys.map(key => [key, q.criteria[Number(key)]])) };
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: 'jev-fixture', answers: { decision: answer }, usage: { input_tokens: 10, output_tokens: 2 } }));
      } catch (error) { console.error(error); res.writeHead(500); res.end('fixture failed'); }
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const network = await createNetwork((url, init) => {
      assert.equal(url, 'https://oneyes.ai/v1/systemone');
      return net.fetch(`http://127.0.0.1:${upstream.address().port}/v1/systemone`, init);
    });
    protocol.handle("oneyes-canvas", async request => {
      const target = route(request.url, process.env.CANVAS_STUDIO_TEST_ROOT);
      if (target.file) return net.fetch(target.file);
      assert.deepEqual(target.apis, ['https://oneyes.ai/v1/systemone', 'https://api.oneyes.ai/v1/systemone']);
      return network.fetch(target.apis[0], { method: request.method, headers: Object.fromEntries(request.headers), body: await request.arrayBuffer(), signal: request.signal, redirect: 'manual' });
    });
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
      js = (code) => win.webContents.executeJavaScript(code).catch(error => { throw new Error("Studio evaluate failed: " + code, {cause:error}); });
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
    const screenshot = async (suffix = "") => {
      if (!process.env.CANVAS_STUDIO_TEST_SCREENSHOT) return;
      win.showInactive();
      await js('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      await writeFile(process.env.CANVAS_STUDIO_TEST_SCREENSHOT.replace(/\.png$/,suffix+".png"),(await win.webContents.capturePage()).toPNG());
      win.hide();
    };
    try {
      await win.loadURL(process.argv[2]);
      await wait("Boolean(window.studioTest)");
      if (process.env.CANVAS_STUDIO_TEST_PHASE === "restore") {
        const saved = await js('studioTest.restoredJev()');
        assert.equal(saved.metadata.studio.decision.answer.choice, '保留');
        assert.equal(saved.metadata.status, 'success');
        assert.equal(decisions.length, 0, 'restart must not replay a decision');
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
      await js('studioTest.configureJev();studioTest.tool("decision",[],{text:"创意方案",question:"选择处理方式",questionType:"choice",criteria:"保留\\n修改"})');
      await wait('document.querySelector("[data-studio-panel=decision]")');
      await click('运行决策');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="success"');
      assert.equal(decisions.length, 1);
      assert.deepEqual(decisions[0].questions.decision, { type: 'choice', instructions: '选择处理方式', criteria: { 保留: '保留', 修改: '修改' } });
      await wait('document.body.textContent.includes("置信度 80.0%")');
      await screenshot('-jev-light');
      await js('studioTest.theme(true)');
      await screenshot('-jev-dark');
      await js('studioTest.theme(false);studioTest.saveJev()');
      await click('输出结果文本');
      assert.match(await js('studioTest.state().nodes.find(n=>n.type==="text").metadata.content'), /选择：保留/);
      assert.ok(!JSON.stringify(await js('studioTest.state()')).includes('fixture-jev-key'));
      await js('studioTest.tool("decision",[],{text:"评分",question:"质量",questionType:"score",criteria:"低\\n高"})');
      await click('运行决策');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="success"');
      assert.match(await js('document.body.textContent'), /评分：0.2 \/ 1/);
      await js('studioTest.tool("decision",[],{text:"auth-failure",question:"是吗"})');
      await click('运行决策');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.match(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.errorDetails'), /诊断 Key 和 JEV 分组权限/);
      assert.equal(decisions.length, 3, 'HTTP failure is not retried');
      await js('studioTest.tool("decision",[],{text:"hold",question:"是吗"})');
      await click('运行决策');
      await wait('document.body.textContent.includes("停止等待")');
      const deadline = Date.now() + 20000;
      while (!releaseDecision) { if (Date.now() > deadline) throw Error('JEV fixture did not receive the request'); await new Promise(resolve=>setTimeout(resolve,25)); }
      await click('停止等待');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      releaseDecision();
      assert.equal(decisions.length, 4, 'cancel never replays the paid request');
      await js('studioTest.tool("decision",[],{text:"判断文本",question:"选择",questionType:"choice",criteria:"重复\\n重复"})');
      await click('运行决策');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.equal(decisions.length, 4, 'invalid criteria never reaches the model');
      console.log('JEV_NATIVE_OK: typed decisions through native protocol and HTTP, own key, error and cancellation without replay, persistence, both themes');
      await js('studioTest.library()');
      await wait('document.querySelector("[aria-label=搜索节点或流程]")===document.activeElement');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await screenshot("-library-light");
      await win.webContents.insertText("OCR");
      await wait('document.querySelector("[aria-label=节点列表]").querySelectorAll("button").length===1');
      win.webContents.sendInputEvent({type:"keyDown",keyCode:"Return"});
      win.webContents.sendInputEvent({type:"keyUp",keyCode:"Return"});
      await wait('!document.querySelector("[data-node-library]")&&studioTest.state().nodes.some(n=>n.type==="studio:ocr")');
      await js('studioTest.library()');
      await wait('document.querySelector("[data-node-library]")');
      await click("常用流程");
      await wait('document.querySelector("[aria-label=常用流程列表]").querySelectorAll("button").length===4');
      await js('document.querySelector("[aria-label=常用流程列表]").querySelector("button").click()');
      await wait('!document.querySelector("[data-node-library]")');
      assert.equal(await js('studioTest.state().connections.length'),2);
      assert.equal(await js('studioTest.calls().length+studioTest.requests().length'),0,"templates must never submit model requests");
      await js('studioTest.tool("storyboard",[],{shots:[{title:"手工镜头",picture:"街道",dialogue:"",camera:"",seconds:5},{title:"第二镜头",picture:"晴天",dialogue:"",camera:"",seconds:3}]})');
      await wait('document.querySelector("[data-studio-panel=storyboard]")');
      await js('document.querySelector("[aria-label=镜头2上移]").click()');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.shots[0].title'),"第二镜头");
      await js('document.querySelector("[aria-label=删除镜头2]").click()');
      await click("添加镜头");
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.shots.length===2');
      await js('document.querySelector("[aria-label=删除镜头2]").click()');
      await click("转为批量任务");
      assert.equal(await js('studioTest.state().nodes.find(n=>n.type==="studio:batch").metadata.studio.text'),"晴天");
      assert.equal(await js('studioTest.calls().length'),0,"converting storyboard is a draft, not paid execution");
      await click("生成分镜");
      await wait('document.body.textContent.includes("保留当前内容")');
      await click("保留当前内容");
      assert.equal(await js('studioTest.requests().length'),0,"cancel replacement preserves the manual storyboard without a model request");
      await js('studioTest.tool("subtitles",[],{cues:[{start:0,end:1,text:"手工字幕"}]})');
      await wait('document.querySelector("[data-studio-panel=subtitles]")');
      await js('document.querySelector("[aria-label=删除字幕1]").click()');
      await click("添加字幕");
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.cues.length'),1);
      await js('studioTest.tool("ocr",["tool"])');
      await wait('document.querySelector("[data-studio-panel=ocr]")');
      assert.match(await js('document.body.textContent'),/类型不匹配/);
      assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="提取文字").disabled'),true);
      await js('studioTest.tool("storyboard",[],{text:"雨夜跑车"})');
      await wait('document.querySelector("[data-studio-panel=storyboard]")');
      await click("生成分镜");
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.shots?.length===1');
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
      await screenshot();
      const exported = await js("studioTest.export()");
      assert.equal(exported.identical, true);
      assert.equal(exported.names.length, 2);
      assert.ok(exported.names.every((name) => !/[\\/]/.test(name)));
      assert.doesNotMatch(exported.params, /fixture-private-secret|apiKey/);
      await js("studioTest.theme(true)");
      await wait('document.documentElement.classList.contains("dark")');
      await js('studioTest.library()');
      await wait('document.querySelector("[aria-label=搜索节点或流程]")===document.activeElement');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await screenshot("-library-dark");
      win.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
      win.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
      await wait('!document.querySelector("[data-node-library]")');
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
      await js('studioTest.tool("batch",["words"],{});studioTest.textSource("第一张\\n第二张")');
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
