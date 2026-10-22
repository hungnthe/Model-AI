import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataset, toPoints, readAnalysis } from '../src/dataset.js';

test('object data excludes metadata and preserves input without mutation', () => {
  const dataset = parseDataset(JSON.stringify({ data: [
    { id: 1, timestamp: 100, value: 20, label: 'ok' },
    { id: 2, timestamp: 101, value: 21, label: 'ok' },
    { id: 3, timestamp: 102, value: 90, label: 'check' },
  ] }));
  assert.deepEqual(dataset.fields, ['value']);
  assert.deepEqual(toPoints(dataset, ['value']), [[20], [21], [90]]);
  assert.equal(dataset.rows[2].label, 'check');
});

test('matrix data supports field subsets and UTF-8 BOM', () => {
  const dataset = parseDataset('\uFEFF[[1,2],[3,4],[5,6]]');
  assert.deepEqual(toPoints(dataset, ['x2']), [[2], [4], [6]]);
});

test('rejects bad structure, ragged vectors and ambiguous field values', () => {
  for (const text of ['{', 'null', '{}', '[]', '[1,2,3]', '[[1],[2,3],[4]]']) {
    assert.throws(() => parseDataset(text));
  }
  const dataset = parseDataset('[{"x":1},{"x":null},{"x":3}]');
  assert.throws(() => toPoints(dataset, ['x']), /2/);
  assert.throws(() => toPoints(dataset, []));
  assert.throws(() => toPoints(parseDataset('[[1],[2],[1e101]]'), ['x1']));
});

test('NDJSON handles partial UTF-8 chunks and progress before result', async () => {
  const bytes = new TextEncoder().encode('{"type":"progress","stage":"score","message":"điểm"}\n{"type":"result","data":{"total":3}}');
  const chunks = [bytes.slice(0, 60), bytes.slice(60, 62), bytes.slice(62)];
  const progress = [];
  const stream = new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } });
  const result = await readAnalysis(new Response(stream), (event) => progress.push(event));
  assert.equal(result.total, 3);
  assert.equal(progress[0].message, 'điểm');
});

test('server errors and interrupted results are surfaced', async () => {
  await assert.rejects(() => readAnalysis(new Response('{"type":"error","message":"bad data"}\n'), () => {}), /bad data/);
  await assert.rejects(() => readAnalysis(new Response(''), () => {}), /chưa trả kết quả/);
  await assert.rejects(() => readAnalysis(new Response('{"error":"busy"}', { status: 429 }), () => {}), /busy/);
});
