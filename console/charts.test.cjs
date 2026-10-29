'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function helpers() {
  const source = fs.readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8');
  return vm.runInNewContext(source.slice(source.indexOf('const finite ='), source.indexOf('function records('))
    + '\n({chartSegments, smoothPath})');
}
test('trend segments retain zero and break at missing values/minutes or out-of-order times', () => {
  const {chartSegments} = helpers();
  const rows = [{minute: 0, value: 0}, {minute: 60000, value: 2}, {minute: 120000, value: null},
    {minute: 180000, value: 3}, {minute: 300000, value: 4}, {minute: 240000, value: 9},
    {minute: 300000, value: 8}, {minute: 360000, value: -1}, {minute: 420000, value: Infinity}];
  assert.deepEqual(Array.from(chartSegments(rows, 'value'), part => Array.from(part, r => r.value)), [[0, 2], [3], [4]]);
});
test('smooth curves hit exact endpoints without invented peaks or negative values', () => {
  const {smoothPath} = helpers();
  for (const values of [[0], [0, 2], [0, 4, 0, 2, 0], [10, 10, 5, 5, 9], [8, 1, 7, 0, 4]]) {
    const result = smoothPath(values.map((y, x) => ({x, y})));
    assert.ok(!/NaN|Infinity/.test(result));
    const curves = [...result.matchAll(/ C([^ ]+) ([^ ]+) ([^ ]+)/g)];
    assert.equal(curves.length, values.length - 1);
    curves.forEach((curve, i) => {
      const a = curve[1].split(',').map(Number), b = curve[2].split(',').map(Number), end = curve[3].split(',').map(Number);
      assert.deepEqual(end, [i + 1, values[i + 1]]);
      for (let j = 0; j <= 100; j++) {
        const t = j / 100, u = 1 - t;
        const value = u ** 3 * values[i] + 3 * u ** 2 * t * a[1] + 3 * u * t ** 2 * b[1] + t ** 3 * end[1];
        assert.ok(value >= Math.min(values[i], values[i + 1]) - 1e-9 && value <= Math.max(values[i], values[i + 1]) + 1e-9);
      }
    });
  }
});

test('combined trend panels expose deep colors, line styles and readable independent legends', () => {
  const css = fs.readFileSync(path.join(__dirname, 'ui/app.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'ui/index.html'), 'utf8');
  assert.match(css, /--chart-red:#b32635/);
  assert.match(css, /\.chart-line\.color-2\{stroke-dasharray:7 4/);
  assert.match(css, /\.chart-legend\{/);
  assert.match(html, /class="panel trend-panel" aria-labelledby="request-chart-title"/);
  assert.match(html, /class="panel trend-panel" aria-labelledby="tokens-title"/);
});
