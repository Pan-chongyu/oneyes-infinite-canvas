import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestImageStream, isOneYes } from './image-stream';
const options = { timeoutMs: 600000 }, original = globalThis.fetch;
function stream(value: string) {
    const bytes = new TextEncoder().encode(value);
    let index=0;
    return new Response(new ReadableStream({ pull(controller) { if(index>=bytes.length) return controller.close(); controller.enqueue(bytes.slice(index,index+=3)); } }), {headers:{'content-type':'text/event-stream'}});
}
test('OneYes JSON and multipart requests stream previews and only retain completed images',async()=>{
    try {
        const partial: string[]=[];let calls=0;
        globalThis.fetch=async(_url,init)=>{
            calls++; assert.equal(new Headers(init?.headers).get('accept'),'text/event-stream');
            if(init?.body instanceof FormData) { assert.equal(init.body.get('stream'),'true');assert.equal(init.body.get('partial_images'),'2');assert.ok(init.body.get('image') instanceof Blob);assert.equal(new Headers(init.headers).has('content-type'),false); }
            else { const data=JSON.parse(String(init?.body)); assert.equal(data.stream,true);assert.equal(data.partial_images,2);assert.equal(data.n,1); }
            return stream(': 心跳\r\n\r\nevent: image_generation.partial_image\r\ndata: {"b64_json":"preview"}\r\n\r\nevent: image_generation.completed\r\ndata: {"b64_json":"final","output_index":0}\r\n\r\ndata: [DONE]\r\n\r\n');
        };
        const result=await requestImageStream('https://example.test',{n:1},{},{...options,onPartial:p=>partial.push(p)});
        assert.equal(result.data.length,1);assert.equal(result.data[0].b64_json,'final');assert.equal(partial[0],'data:image/png;base64,preview');
        const form=new FormData();form.set('image',new Blob(['image']), 'reference.png');
        await requestImageStream('https://example.test',form,{},options);assert.equal(calls,2);
    } finally {globalThis.fetch=original;}
});
test('524, SSE errors, malformed and truncated streams never retry or return a preview as final',async()=>{
    try {
        for(const response of [new Response('timeout',{status:524}),stream('data: {"type":"error","error":{"message":"quota"}}\n\n'),stream('data: broken\n\n'),stream('data: {"type":"image_generation.partial_image","b64_json":"partial"}\n\n')]) {
            let calls=0;globalThis.fetch=async()=>{calls++;return response;};
            await assert.rejects(requestImageStream('https://example.test',{n:1},{},options));assert.equal(calls,1);
        }
        globalThis.fetch=async()=>Response.json({data:[{b64_json:'final'}]});
        assert.equal((await requestImageStream('https://example.test',{n:1},{},options)).data[0].b64_json,'final');
        assert.equal(isOneYes('https://api.oneyes.ai/v1'),true);assert.equal(isOneYes('https://api.oneyes.ai.evil/v1'),false);
    } finally {globalThis.fetch=original;}
});
test('cancellation passes an aborted signal through to the request',async()=>{
    const controller=new AbortController();controller.abort();
    try {globalThis.fetch=async(_url,init)=>{assert.equal(init?.signal?.aborted,true);throw init?.signal?.reason;};await assert.rejects(requestImageStream('https://example.test',{n:1},{},{...options,signal:controller.signal}));}
    finally {globalThis.fetch=original;}
});
