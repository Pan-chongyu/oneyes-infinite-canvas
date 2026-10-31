import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseConfig, writeConfigFile, type CanvasAgentConfig } from "./config.js";

const sample: CanvasAgentConfig = { url: "http://127.0.0.1:17371", token: "test-token-0123456789012345" };

function makeTempBase(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
}

// POSIX-only: chmod semantics differ on Windows, where these modes are advisory.
const posix = process.platform === "win32" ? { skip: true } : {};

test("writeConfigFile creates directory 0700 and file 0600", posix, () => {
    const base = makeTempBase();
    const dir = path.join(base, "nested-config");
    const file = path.join(dir, "canvas-agent.json");
    try {
        writeConfigFile(dir, file, sample);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile tightens existing loose permissions", posix, () => {
    const base = makeTempBase();
    const dir = path.join(base, "existing-config");
    const file = path.join(dir, "canvas-agent.json");
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    try {
        writeConfigFile(dir, file, sample);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile persists the config content", () => {
    const base = makeTempBase();
    const file = path.join(base, "canvas-agent.json");
    try {
        writeConfigFile(base, file, sample);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), sample);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("parseConfig rejects non-local or malformed agent endpoints", () => {
    assert.throws(() => parseConfig({ url: "http://0.0.0.0:17371", token: sample.token }), /127\.0\.0\.1/);
    assert.throws(() => parseConfig({ url: "https://127.0.0.1:17371", token: sample.token }), /127\.0\.0\.1/);
    assert.throws(() => parseConfig({ url: sample.url, token: "short" }), /token/);
});

test("parseConfig normalizes valid origins and rejects malformed workspace state", () => {
    const config = parseConfig({ url: sample.url, token: sample.token, origins: ["http://127.0.0.1:1420", "http://127.0.0.1:1420"], workspace: { workspacePath: "~/canvas", pinnedThreadIds: ["thread-1"] } });
    assert.deepEqual(config.origins, ["http://127.0.0.1:1420"]);
    assert.equal(config.workspace?.pinnedThreadIds?.[0], "thread-1");
    assert.throws(() => parseConfig({ url: sample.url, token: sample.token, workspace: { workspacePath: "" } }), /workspace/);
});
