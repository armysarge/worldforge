const fs = require('fs'), assert = require('assert'), path = require('path');
const terrain = fs.readFileSync(path.join(__dirname, 'js', 'terrain.js'), 'utf8');
new Function(terrain);
const start = terrain.indexOf("  const shape = val('shape') === 'random'");
const end = terrain.indexOf('  const ranges = [], mainBlobs', start);
const code = terrain.slice(start, end);
const shapes = ['hook', 'inlets', 'headlands'];
const make = new Function('name', 'seed', `let state=seed; const R=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296}; const $=()=>({value:name}), val=()=>name; const SHAPES=['hook','inlets','headlands'], pick=a=>a[Math.floor(R()*a.length)], LAND_FRAC=.4, MAINLAND={}; const F=(x,y)=>Math.sin(x*1.3+y*.7)*.3; const sstep=(a,b,x)=>{x=Math.max(0,Math.min(1,(x-a)/(b-a)));return x*x*(3-2*x)}; ${code} return {off, shapeAt, add};`);
for (const shape of shapes) {
  const a=make(shape,42), b=make(shape,42); let land=0;
  assert(a.add.some(v=>v.rx>=.1), shape+' has mountain placement area');
  for(let y=0;y<96;y++) for(let x=0;x<96;x++) { const value=a.shapeAt(x/95,y/95)+a.off; assert(Number.isFinite(value)); land+=value>0; }
  assert(Math.abs(land/9216-.4)<.01, shape+' land calibration');
  assert.strictEqual(a.shapeAt(.31,.47), b.shapeAt(.31,.47), shape+' is deterministic');
}
console.log('Three new shapes: deterministic, finite and calibrated to 40% land; JavaScript syntax OK');
