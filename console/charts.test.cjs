'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function helpers() {
  const source = fs.readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8');
  return vm.runInNewContext(source.slice(source.indexOf('const kinds ='), source.indexOf('function records('))
    + '\n({chartSegments, smoothPath, chartMinute, minuteDetails, tooltipPosition, histogramRows, rankedErrors})');
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

test('pointer maps to exact minute, not the nearest observed bucket', () => {
 const {chartMinute,minuteDetails}=helpers(), fields=[['inputTokens','input'],['outputTokens','output']];
 const series=[{minute:0,inputTokens:0,outputTokens:null},{minute:120000,inputTokens:12,outputTokens:4}];
 assert.equal(chartMinute(series,0,0,200),0); assert.equal(chartMinute(series,100,0,200),60000);
 assert.equal(chartMinute(series,250,0,200),120000); assert.equal(chartMinute([series[1]],0,0,200),120000);
 assert.equal(chartMinute([],0,0,200),null);
 assert.equal(minuteDetails(series,0,fields).rows[0][1],'0');
 assert.equal(minuteDetails(series,0,fields).rows[1][1],'未观测');
 assert.match(minuteDetails(series,60000,fields).message,/无该分钟观测/);
 assert.equal(minuteDetails([{...series[0],inputTokens:9}],0,fields).rows[0][1],'9');
 assert.match(minuteDetails([series[1]],0,fields).message,/已移出/);
});
test('tooltip flips and clamps at all chart edges', () => {
 const {tooltipPosition}=helpers();
 for(const x of [0,100,300])for(const y of [0,100,340]){
  const p=tooltipPosition(x,y,320,360,180,140);
  assert(p.left>=8 && p.left+180<=312);assert(p.top>=8 && p.top+140<=352);
 }
 const p=tooltipPosition(300,340,320,360,180,140);assert(p.left<300 && p.top<340);
});

test('distribution keeps all eight real bins with exact counts and shares, rejecting inconsistent samples', () => {
 const {histogramRows}=helpers(),hist={boundsMs:[100,500,1000,3000,10000,30000,60000],counts:[1,0,1,0,0,0,0,0],count:2,sumMs:1000};
 const rows=histogramRows(hist);assert.equal(rows.length,8);assert.equal(rows[0].count,1);assert.equal(rows[0].share,50);assert.equal(rows[1].share,0);
 assert.match(rows[7].label,/> 60,000 ms/);assert.equal(rows.reduce((a,b)=>a+b.count,0),hist.count);
 for(const invalid of [null,{...hist,count:3},{...hist,sumMs:-1},{...hist,counts:[.5,0,1.5,0,0,0,0,0]},{...hist,boundsMs:[100,100,1000,3000,10000,30000,60000]}])assert.equal(histogramRows(invalid).length,0);
});
test('error ranking sorts measured occurrences and bounds untrusted labels', () => {
 const {rankedErrors}=helpers(),malicious='<img src=x onerror=alert(1)>';
 const rows=rankedErrors({[malicious]:2,rateLimit:1,transport:5,negative:-1,unknown:null});
 assert.deepEqual(Array.from(rows,r=>r.count),[5,2,1]);assert.equal(rows[1].label,malicious);assert.equal(rows[0].share,62.5);
 assert.equal(rankedErrors(null).length,0);assert.equal(rankedErrors({zero:0}).length,0);
 assert(rankedErrors({['x'.repeat(1000)]:1})[0].label.length<=80);
});
