import assert from 'node:assert/strict';
import test from 'node:test';
import { detailImages, detailImageIndex, imageAspectRatio } from './canvas-image-details';
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from '@/types/canvas';

const image = (id: string, content = '', storageKey?: string): CanvasNodeImage => ({ id, status: 'success', content, storageKey, naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' });
const node = (metadata: CanvasNodeData['metadata']): CanvasNodeData => ({ id: 'node', title: '作品', type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 200, height: 100, metadata });

test('batch details retain storage-only originals, skip empty tasks and open the selected or primary image', () => {
    const value = node({ primaryImageId: 'second', images: [image('pending'), image('first', '', 'local-original'), image('second', 'https://example.com/original')] });
    const before = structuredClone(value);
    assert.deepEqual(detailImages(value).map(item => item.id), ['first', 'second']);
    assert.equal(detailImageIndex(value, null), 1);
    assert.equal(detailImageIndex(value, 'first'), 0);
    assert.equal(detailImageIndex(value, 'deleted'), 0);
    assert.deepEqual(value, before, 'view selection does not change the primary image or task list');
});

test('single image dimensions come from original metadata, never from the resized canvas node', () => {
    const single = detailImages(node({ storageKey: 'original', resolutionWarning: '尺寸与请求不一致' }))[0];
    assert.equal(single.storageKey, 'original');
    assert.equal(single.naturalWidth, 0);
    assert.equal(single.naturalHeight, 0);
    assert.equal(single.resolutionWarning, '尺寸与请求不一致');
    assert.deepEqual(detailImages(node({ status: 'loading' })), []);
    assert.deepEqual(detailImages({ ...node({ content: 'text' }), type: CanvasNodeType.Text }), []);
});

test('aspect ratios preserve exact original pixel proportions', () => {
    assert.equal(imageAspectRatio(4096, 2048), '2:1');
    assert.equal(imageAspectRatio(240, 480), '1:2');
    assert.equal(imageAspectRatio(1023, 1000), '1023:1000');
    assert.equal(imageAspectRatio(0, 1000), '');
});
