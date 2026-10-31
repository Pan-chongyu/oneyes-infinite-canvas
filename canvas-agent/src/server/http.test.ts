import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { setCors } from "./http.js";
import type { CanvasAgentConfig } from "../config.js";

test("首次有效网页绑定后，新来源即使持有 token 也不能自动加入白名单", () => {
    const config: CanvasAgentConfig = { url: "http://127.0.0.1:17371", token: "fixture-token" };
    const saved: CanvasAgentConfig[] = [];
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as Response;
    const call = (origin: string, method = "POST", token = config.token) => {
        headers.clear();
        return setCors({ headers: { origin, "x-canvas-agent-token": token }, method } as Request, response, new URL("/canvas/state", config.url), config, (value) => saved.push(value));
    };
    assert.equal(call("https://canvas.example", "OPTIONS", ""), true);
    assert.equal(saved.length, 0);
    assert.equal(call("https://canvas.example", "POST", "bad"), false);
    assert.equal(call("https://canvas.example"), true);
    assert.deepEqual(config.origins, ["https://canvas.example"]);
    assert.equal(call("https://other.example"), false);
    assert.equal(headers.has("Access-Control-Allow-Origin"), false);
    assert.equal(call("https://other.example", "OPTIONS"), false);
    assert.equal(saved.length, 1);
    assert.equal(call("https://canvas.example"), true);
    assert.equal(call("oneyes-canvas://app"), true);
    assert.deepEqual(config.origins, ["https://canvas.example"]);
    assert.equal(call("null"), false);
});
