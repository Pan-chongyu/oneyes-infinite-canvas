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
          throw Error("Studio fixture timed out: " + code + " " + JSON.stringify(await js('({dialogs:Array.from(document.querySelectorAll(".ant-modal")).map(n=>({className:n.className,text:n.textContent,style:n.getAttribute("style"),animations:n.getAnimations({subtree:true}).map(a=>({state:a.playState,time:a.currentTime}))})),tool:studioTest.state().nodes.find(n=>n.id==="tool")?.metadata,requests:studioTest.requests().length})')));
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    const click = async (text) => {
      await js(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(async()=>{const button=Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.replaceAll(' ','')===${JSON.stringify(text.replaceAll(' ', ''))}&&b.getClientRects().length).at(-1);if(!button)throw Error('Visible button not found');const dialog=button.closest('.ant-modal');if(dialog)await Promise.all(dialog.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));button.click()})`,
      );
    };
    const screenshot = async (suffix = "") => {
      if (!process.env.CANVAS_STUDIO_TEST_SCREENSHOT) return;
      win.showInactive();
      await js('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      await writeFile(process.env.CANVAS_STUDIO_TEST_SCREENSHOT.replace(/\.png$/,suffix+".png"),(await win.webContents.capturePage()).toPNG());
    };
    try {
      await win.loadURL(process.argv[2]);
      // Native modal animations need a painted window; hidden renderers can
      // retain an exiting dialog indefinitely even with throttling disabled.
      win.showInactive();
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
      await wait('document.querySelector("[aria-label=常用流程列表]").querySelectorAll("button").length===5');
      await js('(()=>{const b=document.querySelector("[aria-label=常用流程列表]").querySelector("button");if(!b.textContent.includes("漫剧制作"))throw Error("漫剧模板不是首项");b.click()})()');
      await wait('!document.querySelector("[data-node-library]")');
      assert.equal(await js('studioTest.state().connections.length'),3);
      assert.deepEqual(await js('studioTest.state().nodes.filter(n=>["studio:screenplay","studio:reference","studio:storyboard"].includes(n.type)).map(n=>n.type).sort()'),["studio:reference","studio:screenplay","studio:storyboard"]);
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
      await js('studioTest.tool("screenplay",[],{text:"山海异闻，少女阿宁入山寻人"})');
      await wait('document.querySelector("[data-studio-panel=screenplay]")');
      await click("拆解漫剧剧本");
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.screenplay?.episodes.length===2');
      assert.match(await js('document.body.textContent'), /模型调用按站点计费/);
      await screenshot('-screenplay');
      const beforeNext = await js('studioTest.requests().length');
      await click('下一步：做分镜');
      await click('下一步：做分镜');
      assert.equal(await js('studioTest.state().nodes.filter(n=>n.type==="studio:storyboard").length'),1,'next step reuses the linked storyboard');
      assert.equal(await js('studioTest.openedPanel()'),await js('studioTest.state().nodes.find(n=>n.type==="studio:storyboard").id'),'next step opens the correct node panel');
      assert.equal(await js('studioTest.requests().length'),beforeNext,'next step never requests the model');
      await click("输出本集剧本文本");
      assert.match(await js('studioTest.state().nodes.find(n=>n.type==="text").metadata.content'), /白衣少女/);
      assert.match(await js('studioTest.state().nodes.find(n=>n.type==="text").metadata.content'), /山门无声合上/);
      await js('studioTest.apply([{type:"update_node",id:"tool",metadata:{studio:{...studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio,episodeIndex:1}}}])');
      await click("输出本集剧本文本");
      assert.match(await js('studioTest.state().nodes.filter(n=>n.type==="text").at(-1).metadata.content'), /第二集/);
      const screenplayRequests = await js('studioTest.requests().length');
      await click("拆解漫剧剧本");
      await wait('document.body.textContent.includes("保留当前内容")');
      await click("保留当前内容");
      assert.equal(await js('studioTest.requests().length'),screenplayRequests,"cancel must preserve the edited screenplay without a new request");
      await js('(()=>{const script=studioTest.state().nodes.find(n=>n.id==="tool");studioTest.tool("storyboard",["script-source","role-ref"]);studioTest.apply([{type:"add_node",id:"script-source",nodeType:"studio:screenplay",metadata:script.metadata},{type:"add_node",id:"role-ref",nodeType:"studio:reference",metadata:{studio:{role:"白衣阿宁",style:"国风水墨",sourceIds:["source0"]}}}])})()');
      await click("生成分镜");
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.shots?.length===1');
      assert.match(await js('studioTest.requests().at(-1).prompt'), /第二集/);
      assert.match(await js('studioTest.requests().at(-1).system'), /白衣阿宁/);
      await click("转为批量任务");
      assert.deepEqual(await js('studioTest.state().nodes.find(n=>n.type==="studio:batch").metadata.studio.sourceIds'),["role-ref"]);
      assert.equal(await js('studioTest.calls().length'),0,"screenplay and storyboard outputs must never start image/video tasks");
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
      await js('studioTest.tool("storyboard",[],{shots:[{title:"配音测试",picture:"山门近景",dialogue:"快走",camera:"推进",seconds:5}]})');
      await click("输出镜头节点（不自动生成）");
      assert.equal(
        await js('studioTest.state().nodes.filter(n=>n.type==="video").length'),
        1,
      );
      assert.equal(await js('studioTest.state().nodes.filter(n=>n.type==="audio").length'),1);
      assert.equal(await js('studioTest.state().connections.some(c=>c.fromNodeId===studioTest.state().nodes.find(n=>n.type==="audio").id&&c.toNodeId===studioTest.state().nodes.find(n=>n.type==="video").id)'),true,"dialogue audio must feed the matching video node");
      assert.equal(await js("studioTest.calls().length"), 0);
      assert.equal(await js('studioTest.state().nodes.find(n=>n.type==="video").metadata.seconds'), '5');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.type==="audio").metadata.model'), 'test');
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
      await js('studioTest.tool("reference",["source0"],{text:"少女阿宁",assistantModel:"group-b/model"})');
      await click('AI 整理角色');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.role==="白衣少女阿宁"');
      assert.equal(await js('studioTest.requests().at(-1).model'),'group-b/model','assistant keeps the exact selected channel');
      assert.match(await js('studioTest.requests().at(-1).references[0]'),/^data:image\/png;base64,/);
      await screenshot('-simple-reference');
      await js('studioTest.theme(true)');
      await screenshot('-simple-reference-dark');
      await js('studioTest.theme(false)');
      await js('studioTest.assistant({aiReply:"invalid-json"})');
      await click('AI 整理角色');
      await wait('document.body.textContent.includes("确认调用")');
      await click('确认调用');
      await wait('!document.querySelector(".ant-modal-confirm")');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.role'),'白衣少女阿宁','invalid reply preserves existing role');
      await js('studioTest.assistant({aiReply:null});studioTest.tool("compare",["source0","source1"],{selectedId:"source0"})');
      await click('AI 帮我选');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.selectionAdvice?.sourceId==="source1"');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.selectedId'),'source0','AI advice does not replace a manual selection');
      await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="采用建议")');
      await click('采用建议');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.selectedId'),'source1');
      await js('studioTest.patch({studio:{...studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio,text:"新标准"}})');
      assert.equal(await js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="采用建议")'),false,'stale advice cannot be applied');
      await js('studioTest.tool("subtitles",[],{cues:[{start:0.125,end:3.9,text:"校对前",speaker:"阿宁"}]})');
      await click('AI 校对字幕');
      await wait('document.body.textContent.includes("确认调用")');
      await click('确认调用');
      await wait('!document.querySelector(".ant-modal-confirm")');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.cues[0].text==="校对后的字幕。"');
      assert.deepEqual(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.cues[0]'),{start:0.125,end:3.9,text:'校对后的字幕。',speaker:'阿宁'});
      await js('studioTest.tool("batch",["words"],{});studioTest.textSource("这里是上游完整故事")');
      await click('AI 整理提示词');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.preparedPrompts?.length===2');
      await click('开始批量生成');
      await wait('document.body.textContent.includes("本次最多提交 2 项")');
      await click('取消');
      assert.equal(await js('studioTest.calls().length'),0,'preparing prompts and canceling the batch never generates an image');
      await js('studioTest.tool("reference",[],{text:"阿宁",assistantModel:"removed/model"})');
      const beforeUnavailable = await js('studioTest.requests().length');
      await click('AI 整理角色');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.equal(await js('studioTest.requests().length'),beforeUnavailable,'removed model is blocked without fallback');
      await js('studioTest.tool("reference",["words"],{});studioTest.textSource("最初剧本");studioTest.assistant({holdAi:true})');
      await click('AI 整理角色');
      await wait('studioTest.requests().length>'+beforeUnavailable);
      await js('studioTest.apply([{type:"update_node",id:"words",metadata:{content:"用户修改后的剧本"}}]);studioTest.releaseAi()');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.role'),undefined,'changed upstream never receives stale generated role');
      await js('studioTest.tool("reference",[],{text:"补充说明",role:"原有角色"})');
      const beforeCancel = await js('studioTest.requests().length');
      await click('AI 整理角色');
      await wait('document.body.textContent.includes("确认调用")');
      await click('确认调用');
      await wait('!document.querySelector(".ant-modal-confirm")');
      await wait('studioTest.requests().length>'+beforeCancel);
      await click('停止等待');
      await wait('studioTest.state().nodes.find(n=>n.id==="tool").metadata.status==="error"');
      assert.equal(await js('studioTest.state().nodes.find(n=>n.id==="tool").metadata.studio.role'),'原有角色');
      assert.equal(await js('studioTest.requests().length'),beforeCancel+1,'canceling the assistant never replays the model request');
      await js('studioTest.assistant({holdAi:false});studioTest.tool("compare",["source0","source1"],{selectedId:"source1"})');
      console.log('STUDIO_ASSISTANTS_OK: exact model, original images, safe drafts, preserved subtitle timestamps, no automatic paid image tasks, unavailable and stale input rejection');
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
          "STUDIO_UI_OK: screenplay episodes, character continuity, manual shots and audio/video links, reference-preserving batches, OCR originals, exact-size workers, dark theme, explicit paid confirmation and failure pause",
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
