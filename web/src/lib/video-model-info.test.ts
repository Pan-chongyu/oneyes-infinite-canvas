import test from "node:test";
import assert from "node:assert/strict";
import { videoModelCatalog } from "./video-model-catalog";
import { getVideoModelInfo, modelPickerOptions, videoModelConfigError, videoModelOptionName, videoModelOptions } from "./video-model-info";
import { modelInformationPriority, splitModelInformation } from './model-information';
import displaySnapshot from './video-model-display-catalog.json';
import type { AiConfig } from "@/stores/use-config-store";
import { minimumVideoModelDefaults, videoModelDefaults, videoModelDefaultsKey, videoModelNodePatch } from './video-model-defaults';
import { parseVideoCatalog } from '../../../desktop/video-catalog.mjs';
import { videoModelMetadata, videoModelState } from './video-model-status';
import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';
import dynamicSnapshot from '../../../test/fixtures/video-catalog-dynamic.json';
import { videoModelDuration } from './video-model-info';
import { buildVideoBridgeRequest } from '@/services/api/video-bridge-request';

const displayCatalog = displaySnapshot.data;
const config = {
    baseUrl: "https://api.oneyes.ai", channels: [{ id: "oneyes-minimax", name: "Video", baseUrl: "https://api.oneyes.ai", models: [] }],
    model: "oneyes-minimax::wan3.0-video", videoModel: "oneyes-minimax::wan3.0-video", vquality: "720", size: "16:9", videoSeconds: "5", videoMode: "reference", videoGenerateAudio: "true",
} as unknown as AiConfig;

test('dynamic SP and future models use exact authorized aliases, reviewed parameters, JSON and binary requests without generic fields', async () => {
    const catalog = parseVideoCatalog({ ...dynamicSnapshot, generated_at: new Date().toISOString() });
    const names = catalog.data.flatMap(model => model.request_ids);
    const selected = { ...config, channels: [{ ...config.channels[0], models: names.map(name => ({ name, capability: 'video' as const })) }] };
    const before = JSON.stringify(selected);
    useVideoCatalogStore.setState({ catalog });
    try {
        const options = modelPickerOptions(selected, names.map(name => 'oneyes-minimax::' + name));
        assert.deepEqual(options.map(option => option.name), ['SP-特价', 'future-fixture-v3']);
        const sp = options[0].value, info = getVideoModelInfo(selected, sp)!;
        assert.equal(info.id, 'SP-特价');
        assert.equal(getVideoModelInfo({ ...selected, channels: [{ ...selected.channels[0], id: 'default' }] }, sp.replace('oneyes-minimax::', 'default::'))?.id, 'SP-特价', 'manual OneYes keys use the same reviewed dynamic protocol');
        const defaults = videoModelDefaults(selected, sp);
        assert.deepEqual([defaults.vquality, defaults.videoSeconds, defaults.videoMode], ['1080', '30', 'reference']);
        assert.equal(videoModelConfigError({ ...selected, ...defaults, model: sp }, sp, { imageCount: 9, audioCount: 3, videoCount: 0 }), undefined);
        for (const invalid of [{ imageCount: 10, audioCount: 0, videoCount: 0 }, { imageCount: 1, audioCount: 4, videoCount: 0 }, { imageCount: 1, audioCount: 0, videoCount: 1 }]) assert.match(videoModelConfigError({ ...selected, ...defaults, model: sp }, sp, invalid)!, /最多支持/);
        const media = { images: [], imageDataUrls: [], videos: [], audios: [] };
        const json = buildVideoBridgeRequest(info, defaults, sp.split('::')[1], '离线验证', media);
        assert.deepEqual(json.body, { model: sp.split('::')[1], prompt: '离线验证', resolution: '1080p', duration: 30, aspect_ratio: '16:9' });
        const image = new File([Uint8Array.of(1, 2, 3)], '原图.webp', { type: 'image/webp' });
        const audio = new File([Uint8Array.of(4, 5)], '音频.mp3', { type: 'audio/mpeg' });
        const multipart = buildVideoBridgeRequest(info, defaults, sp.split('::')[1], '离线验证', { ...media, images: [image], audios: [audio] }).body as FormData;
        assert.deepEqual([...multipart.keys()], ['model', 'prompt', 'resolution', 'duration', 'aspect_ratio', 'reference_images', 'reference_audios']);
        assert.deepEqual(await (multipart.get('reference_images') as File).arrayBuffer(), await image.arrayBuffer());
        assert.doesNotMatch(JSON.stringify([...multipart.keys()]), /"(?:mode|first_frame|size)"/);
        const future = getVideoModelInfo(selected, options[1].value)!;
        assert.deepEqual(videoModelDuration(future, '1080').values, [10, 12]);
        assert.match(videoModelConfigError({ ...selected, ...videoModelDefaults(selected, options[1].value), model: options[1].value, vquality: '1080' })!, /10 \/ 12/);
        assert.deepEqual(videoModelDefaults(selected, options[1].value).size, '9:16');
        const onlyBare = modelPickerOptions(selected, ['oneyes-minimax::SP-特价']);
        assert.equal(onlyBare[0].value, 'oneyes-minimax::SP-特价', 'feed never grants a recommended alias not returned by this Key');
        for (const id of catalog.data.filter(model => model.new_tasks_enabled === false || model.status === 'retired').flatMap(model => model.request_ids)) assert.equal(videoModelMetadata(selected, 'oneyes-minimax::' + id, catalog)?.request_ids.includes(id), true, 'hidden histories still resolve exactly');
        assert.equal(getVideoModelInfo(selected, 'oneyes-minimax::SP-特价 [1080p 5-30s ¥999/条]'), undefined);
        assert.match(videoModelConfigError(selected, 'oneyes-minimax::not-reviewed')!, /尚未完成适配/);
        assert.equal(JSON.stringify(selected), before);
    } finally { useVideoCatalogStore.setState({ catalog: undefined }); }
});

test('every audited video model starts with its lowest supported resolution and shortest explicit duration', () => {
    for (const info of videoModelCatalog) {
        const model = `oneyes-minimax::${info.id.startsWith('grok-') ? info.aliases[0] : info.id}`;
        const defaults = minimumVideoModelDefaults(config, model);
        assert.equal(videoModelConfigError({ ...config, ...defaults, model }), undefined, info.id);
        assert.equal(defaults.videoSeconds, String(info.duration.values?.filter(value => value > 0).sort((a, b) => a - b)[0] ?? Math.max(1, info.duration.min)), info.id);
        const rank = (value: string) => parseFloat(value) * (/k$/i.test(value) ? 1000 : 1);
        assert.equal(rank(defaults.vquality), Math.min(...info.resolutions.map(rank)), info.id);
        assert.equal(defaults.videoGenerateAudio, info.audio === 'required' ? 'true' : 'false');
    }
});

test('priced metadata needs a complete amount and unit; explicit zero is valid', () => {
    for (const information of ['¥0/秒', '￥0.0/条', '2.178元/条', '¥13.2/百万Token起']) assert.equal(modelInformationPriority(`视频 [${information}]`), 2);
    for (const information of ['价格待定', '720p 5s', '¥2', '￥/秒', '元/条', '¥2/unknown']) assert.notEqual(modelInformationPriority(`视频 [${information}]`), 2);
    assert.equal(modelInformationPriority('视频 [¥1/秒] incomplete'), 0);
});

test('dynamic state decorates only exact authorized IDs, preserves old aliases and never grants feed-only models', () => {
    const old = 'veo-3.1-fast [720p 8s ¥0.165/秒]', current = 'veo-3.1-fast [720p-4k 4/6/8s ¥0.165/秒起]';
    const input = { schema_version: 1, generated_at: '2026-11-18T00:00:00Z', check: { stale: false }, data: [{ id: 'veo-3.1-fast', model_name: 'veo-3.1-fast', model_info: '最新价格参数 ￥0.165/秒起', request_ids: ['veo-3.1-fast', old, current], recommended_request_id: current, status: 'retired', new_tasks_enabled: false, stale: false, price_stale: true, parameters_stale: true }] };
    const catalog = parseVideoCatalog(input), options = ['oneyes-minimax::' + old];
    assert.deepEqual(modelPickerOptions(config, options, options[0], catalog), [], 'retired selections remain stored but disappear from new menus');
    const active = parseVideoCatalog({ ...input, data: [{ ...input.data[0], status: 'active', new_tasks_enabled: true }] });
    assert.equal(modelPickerOptions(config, options, options[0], active)[0].value, options[0], 'public recommendations cannot add an unreturned request ID');
    assert.equal(modelPickerOptions(config, options, options[0], active)[0].information, '最新价格参数 ￥0.165/秒起');
    assert.equal(videoModelState(config, options[0], catalog).status, 'retired');
    assert.equal(videoModelState(config, options[0], catalog).disabled, true);
    assert.equal(videoModelState(config, options[0], catalog).priceStale, true);
    assert.equal(videoModelState(config, options[0], catalog).parametersStale, true);
    assert.equal(videoModelMetadata(config, 'oneyes-minimax::veo-3.1-fast-unknown', catalog), undefined);
    assert.equal(videoModelMetadata({ ...config, channels: [{ ...config.channels[0], baseUrl: 'https://other.invalid' }] }, options[0], catalog), undefined);
    assert.deepEqual(modelPickerOptions(config, [], undefined, catalog), []);
    const before = JSON.stringify(config);
    for (const [status, enabled, disabled] of [['active', true, false], ['unknown', true, false], ['unavailable', true, true], ['retired', true, true], ['active', false, true]] as const) {
        input.data[0].status = status; input.data[0].new_tasks_enabled = enabled; input.check.stale = true;
        assert.equal(videoModelState(config, options[0], parseVideoCatalog(input)).disabled, disabled);
    }
    assert.equal(JSON.stringify(config), before);
    assert.equal(videoModelState(config, options[0]).disabled, false, 'missing metadata is not evidence of retirement');
    const withoutPrice = parseVideoCatalog({ ...input, data: [{ ...input.data[0], status: 'active', new_tasks_enabled: true, has_price: false }] });
    assert.deepEqual(modelPickerOptions(config, options, undefined, withoutPrice), [], 'unpriced public entries cannot become new Video choices');
});

test('per-model defaults share exact aliases, stay isolated, and map atomically to node metadata', () => {
    const model = 'oneyes-minimax::wan3.0-video';
    const custom = { ...minimumVideoModelDefaults(config, model), vquality: '1080', videoSeconds: '12', size: '9:16' };
    const saved = { ...config, videoModelDefaults: { [videoModelDefaultsKey(config, model)]: custom } };
    const before = JSON.stringify(saved);
    assert.deepEqual(videoModelDefaults(saved, `oneyes-minimax::${videoModelCatalog[0].aliases[0]}`), custom);
    assert.equal(videoModelDefaults(saved, 'oneyes-minimax::veo-3.1').videoSeconds, '4');
    assert.deepEqual(videoModelNodePatch(saved, model), { model, size: '9:16', vquality: '1080', seconds: '12', videoMode: custom.videoMode, generateAudio: custom.videoGenerateAudio, watermark: custom.videoWatermark });
    assert.equal(JSON.stringify(saved), before);
});

test("all 28 models have valid priced options and accept their published client defaults", () => {
    assert.equal(videoModelCatalog.length, 28);
    assert.equal(new Set(videoModelCatalog.map(item => item.id)).size, 28);
    for (const info of videoModelCatalog) {
        const model = `oneyes-minimax::${info.id.startsWith("grok-") ? info.aliases[0] : info.id}`;
        const selected = { ...config, model, vquality: info.defaultResolution, size: info.ratios[0], videoSeconds: String(info.defaultSeconds), videoMode: info.modes[0] };
        assert.equal(getVideoModelInfo(selected)?.id, info.id);
        assert.equal(videoModelConfigError(selected), undefined, info.id);
        assert.ok(info.priceLines.length);
        assert.match(videoModelOptionName(selected, model), /¥/);
    }
});

test("labels never change submitted IDs and collapse only a model's aliases in the same channel", () => {
    const canonical = config.model;
    const alias = `${canonical} [480-1080p 2-30s ¥0.385/秒起]`;
    const options = [canonical, alias, "other::wan3.0-video"];
    assert.deepEqual(videoModelOptions(config, options, alias), [alias, options[2]]);
    assert.deepEqual(videoModelOptions(config, options), [alias, options[2]]);
    assert.match(videoModelOptionName(config, alias), /^wan3.0-video \[/);
    assert.equal(config.model, canonical);
});

test('discount capabilities match only audited exact IDs and keep reference-only parameters', () => {
    for (const info of videoModelCatalog.filter(model => model.id.includes('-discount'))) {
        for (const id of [info.id, ...info.aliases]) {
            const model = 'oneyes-minimax::' + id;
            const selected = { ...config, model, vquality: '720', videoSeconds: '4', size: '16:9', videoMode: 'reference' };
            assert.equal(getVideoModelInfo(selected)?.id, info.id);
            assert.equal(videoModelConfigError(selected, model, { imageCount: 9, videoCount: 0, audioCount: 0 }), undefined);
            assert.match(videoModelConfigError(selected, model, { imageCount: 10, videoCount: 0, audioCount: 0 })!, /最多支持 9.*图片/);
            assert.match(videoModelConfigError(selected, model, { imageCount: 1, videoCount: 1, audioCount: 0 })!, /最多支持 0.*视频/);
            assert.match(videoModelConfigError({ ...selected, videoMode: 'frames' })!, /仅支持参考模式/);
            assert.match(videoModelConfigError({ ...selected, vquality: '1080' })!, /720p.*保留原设置/);
        }
    }
    assert.equal(getVideoModelInfo(config, 'oneyes-minimax::seedance-2.0-fast-discount-new'), undefined);
    assert.equal(getVideoModelInfo(config, 'oneyes-minimax::seedance-2.0-fast-discount [720p ¥99/条]'), undefined);
});

test('bare Grok and priced aliases share bridge capabilities only in the OneYes Video group', () => {
    for (const info of videoModelCatalog.filter(model => model.id.startsWith('grok-'))) for (const id of [info.id, ...info.aliases]) {
        const model = 'oneyes-minimax::' + id;
        const selected = { ...config, model, videoMode: 'frames', vquality: '720' };
        assert.equal(getVideoModelInfo(selected)?.id, info.id);
        assert.equal(videoModelDefaultsKey(selected, model), 'oneyes-minimax::' + info.id);
        assert.match(videoModelConfigError(selected, model, { imageCount: 1, videoCount: 1, audioCount: 0 })!, /不支持参考视频、视频编辑/);
        assert.match(videoModelConfigError(selected, model, { imageCount: 1, videoCount: 0, audioCount: 1 })!, /上传参考音频/);
        assert.equal(getVideoModelInfo({ ...selected, channels: [{ ...selected.channels[0], baseUrl: 'https://other.example' }] }), undefined);
        assert.equal(getVideoModelInfo({ ...selected, channels: [{ ...selected.channels[0], models: [{ name: id, capability: 'video', script: 'return result' }] }] }), undefined);
        const linked = { ...selected, model: 'linked::' + id, channels: [{ ...selected.channels[0], id: 'linked', oneYes: { platform: 'grok' as const, groupId: 1, groupName: 'Video', keyId: 1, accountId: 1 } }] };
        assert.equal(getVideoModelInfo(linked)?.id, info.id);
    }
    const native = { ...config, channels: [{ ...config.channels[0], id: 'default' }] };
    assert.equal(getVideoModelInfo(native, 'default::grok-imagine-video'), undefined);
    assert.equal(getVideoModelInfo(native, 'default::grok-imagine-video-1.5'), undefined);
});

test('wan3.0 uses verified 10–30 seconds without modifying saved choices or the other Wan models', () => {
    const info = videoModelCatalog.find(model => model.id === 'wan3.0')!;
    for (const id of [info.id, ...info.aliases]) {
        const model = 'oneyes-minimax::' + id, selected = { ...config, model, videoMode: 'reference' };
        const before = JSON.stringify(selected);
        assert.equal(getVideoModelInfo(selected)?.duration.min, 10);
        assert.equal(minimumVideoModelDefaults(selected, model).videoSeconds, '10');
        for (const videoSeconds of ['5', '9', '10.5', '31']) assert.match(videoModelConfigError({ ...selected, videoSeconds })!, /10–30.*秒/);
        for (const videoSeconds of ['10', '30']) assert.equal(videoModelConfigError({ ...selected, videoSeconds }), undefined);
        assert.doesNotMatch(videoModelOptionName(selected, model), /5-30/);
        if (id !== info.id) assert.match(modelPickerOptions(selected, [model])[0].label, /10[-–]30/);
        assert.equal(JSON.stringify(selected), before);
    }
    for (const id of ['wan3.0-video', 'wan3.0-video-prime']) {
        const selected = { ...config, model: 'oneyes-minimax::' + id, videoSeconds: '2' };
        assert.equal(videoModelConfigError(selected), undefined);
        assert.equal(getVideoModelInfo(selected)?.duration.min, 2);
    }
});

test('only complete terminal square brackets become metadata; ordinary names stay verbatim', () => {
    for (const [value, name, information] of [
        ['中文视频模型【1080p 5–15秒 ￥2/秒】', '中文视频模型', '1080p 5–15秒 ￥2/秒'],
        ['new-video [720p 10s ¥0.5/秒]', 'new-video', '720p 10s ¥0.5/秒'],
        ['中文模型 [4K 6秒 3.2元/次]', '中文模型', '4K 6秒 3.2元/次'],
        ['name (720p ¥1)', 'name (720p ¥1)', ''], ['name（说明）', 'name（说明）', ''],
        ['name [info] extra', 'name [info] extra', ''], ['name [info】', 'name [info】', ''],
        ['name [unfinished', 'name [unfinished', ''], ['model[]', 'model[]', ''],
    ]) assert.deepEqual(splitModelInformation(value), { name, information });
});

test('discovered canonical/priced entries merge within their channel without changing selection or request IDs', () => {
    const canonical = 'oneyes-minimax::新视频-v2', alias = canonical + '【1080p 5–15秒 ￥2.5/秒】';
    const inputs = [canonical, canonical + ' [720p 5s]', alias, canonical + ' [720p 1元/次]', 'other::新视频-v2', 'oneyes-minimax::新视频-v2-pro', 'oneyes-minimax::name (info)'];
    const before = JSON.stringify(config);
    const plain = modelPickerOptions(config, inputs);
    assert.equal(plain.length, 2); assert.equal(plain[0].value, alias);
    assert.deepEqual(plain[0], { value: alias, label: '新视频-v2【1080p 5–15秒 ￥2.5/秒】', name: '新视频-v2', information: '1080p 5–15秒 ￥2.5/秒' });
    const selected = modelPickerOptions(config, inputs, canonical)[0];
    assert.equal(selected.value, alias); assert.equal(selected.information, plain[0].information);
    assert.equal(modelPickerOptions(config, [...inputs].reverse(), canonical)[0].name, '新视频-v2');
    assert.deepEqual(modelPickerOptions(config, [canonical], canonical), []);
    assert.equal(JSON.stringify(config), before);
});

test('server suffix wins over static display metadata while supplier and account details stay out of labels', () => {
    const alias = config.model + ' [1080p 6s ￥9/次]';
    assert.equal(videoModelOptionName(config, alias), 'wan3.0-video [1080p 6s ￥9/次]');
    const [entry] = modelPickerOptions(config, ['oneyes-minimax::中文模型 [720p ¥1/秒 智赢 88API https://private.invalid/path?token=secret 余额:999]']);
    assert.doesNotMatch(entry.label, /智赢|88API|private|secret|余额|999/);
    assert.match(entry.information, /720p ¥1\/秒/);
});

test('the audited display snapshot recommends 26 returned priced IDs without rewriting old selections or model parameters', () => {
    assert.equal(displayCatalog.length, 26);
    const names = displayCatalog.flatMap(model => [model.id, model.request_id]);
    names.unshift('veo-3.1-fast [720p 8s ¥0.165/秒]');
    const options = names.map(name => 'oneyes-minimax::' + name);
    const available = { ...config, channels: [{ ...config.channels[0], apiKey: 'fixture-key', models: names.map(name => ({ name, capability: 'video' as const })) }] };
    const before = JSON.stringify(available);
    for (const order of [options, [...options].reverse()]) {
        const offered = modelPickerOptions(available, order);
        assert.equal(offered.length, 26);
        assert.deepEqual(offered.map(entry => entry.value).sort(), displayCatalog.map(model => 'oneyes-minimax::' + model.request_id).sort());
        for (const model of displayCatalog) {
            const canonical = 'oneyes-minimax::' + model.id;
            const selected = modelPickerOptions(available, order, canonical).find(entry => entry.name === model.id)!;
            assert.equal(selected.name, model.id); assert.equal(selected.information, splitModelInformation(model.request_id).information);
        }
    }
    const old = 'oneyes-minimax::veo-3.1-fast [720p 8s ¥0.165/秒]';
    assert.equal(modelPickerOptions(available, options, old).find(entry => entry.name === 'veo-3.1-fast')?.information, '720p-4k 4/6/8s ¥0.165/秒起');
    assert.equal(JSON.stringify(available), before);
});

test('price filtering is scoped to Video; plain text/image models survive and unknown prices follow stable server order', () => {
    const channels = [{ ...config.channels[0], id: 'default', models: [
        { name: '文本模型', capability: 'text' as const }, { name: '文本模型 [说明]', capability: 'text' as const },
        { name: '图片模型', capability: 'image' as const },
    ] }, config.channels[0]];
    const options = ['default::文本模型', 'default::文本模型 [说明]', 'default::图片模型', 'oneyes-minimax::无价格视频', 'oneyes-minimax::未来视频 [720p ¥9/秒]', 'oneyes-minimax::未来视频 [720p ¥1/秒]'];
    assert.deepEqual(modelPickerOptions({ ...config, channels }, options).map(entry => entry.value), [options[0], options[1], options[2], options[4]]);
    const missing = 'oneyes-minimax::veo-3.1-fast [720p 8s ¥0.165/秒]';
    assert.equal(modelPickerOptions(config, [missing])[0].value, missing, 'the snapshot cannot invent a new alias not returned by this Key');
});

test("foreign endpoints and request scripts do not inherit OneYes prices or validation", () => {
    const foreign = { ...config, channels: [{ ...config.channels[0], baseUrl: "https://other.example" }] };
    assert.equal(getVideoModelInfo(foreign), undefined);
    const scripted = { ...config, channels: [{ ...config.channels[0], models: [{ name: "wan3.0-video", capability: "video" as const, script: "return result" }] }] };
    assert.equal(getVideoModelInfo(scripted), undefined);
    assert.equal(getVideoModelInfo(config, "deleted::wan3.0-video"), undefined);
    assert.equal(getVideoModelInfo(config, "oneyes-minimax::wan3.0-video-fake"), undefined);
});

test("invalid parameters are reported without silently changing saved settings", () => {
    const saved = { ...config, model: "oneyes-minimax::veo-3.1-fast", vquality: "1080", videoSeconds: "6" };
    const before = JSON.stringify(saved);
    assert.equal(videoModelConfigError(saved), undefined);
    assert.equal(JSON.stringify(saved), before);
    assert.match(videoModelConfigError({ ...saved, vquality: "480" })!, /720p/);
    assert.equal(videoModelConfigError({ ...config, model: "oneyes-minimax::wan3.0-video", videoSeconds: "2" }), undefined);
    assert.match(videoModelConfigError({ ...config, model: "oneyes-minimax::veo-3.1", videoSeconds: "5" })!, /4 \/ 6 \/ 8/);
    assert.equal(videoModelConfigError({ ...config, model: "oneyes-minimax::doubao-seedance-2.0", vquality: "4k" }), undefined);
});

test('Veo Fast audited capabilities accept the new alias and retain old IDs and saved choices', () => {
    const info = videoModelCatalog.find(model => model.id === 'veo-3.1-fast')!;
    for (const id of [info.id, ...info.aliases]) for (const vquality of ['720', '1080', '4k']) for (const videoSeconds of ['4', '6', '8']) {
        const selected = { ...config, model: 'oneyes-minimax::' + id, vquality, videoSeconds };
        const before = JSON.stringify(selected);
        assert.equal(getVideoModelInfo(selected)?.id, info.id);
        assert.equal(videoModelConfigError(selected, selected.model, { imageCount: 0, videoCount: 0, audioCount: 0 }), undefined);
        if (videoSeconds !== '8') assert.match(videoModelConfigError(selected, selected.model, { imageCount: 1, videoCount: 0, audioCount: 0 })!, /固定 8 秒/);
        assert.equal(JSON.stringify(selected), before);
    }
});
