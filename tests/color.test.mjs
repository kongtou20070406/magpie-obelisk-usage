import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const css = fs.readFileSync('page/style.css', 'utf8');
const palette = [...css.matchAll(/--series-(\d): light-dark\(oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\), oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)\)/g)].map(m => ({ index: +m[1], light: [+m[2] / 100, +m[3], +m[4]], dark: [+m[5] / 100, +m[6], +m[7]] }));
function rgb([L, C, h]) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s].map(v => Math.max(0, Math.min(1, v <= .0031308 ? 12.92*v : 1.055*v ** (1/2.4) - .055)));
}
function luminance(channels) { return channels.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
function fromHex(hex) { return hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255); }
function labL(hex) { const [r,g,b] = fromHex(hex).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2104542553 * Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b) + .793617785 * Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b) - .0040720468 * Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b); }

test('series colors have contrast against both card backgrounds', () => {
  assert.equal(palette.length, 8);
  for (const color of palette) for (const [theme, card] of [['light', 'f6f6f7'], ['dark', '232328']]) {
    const a = luminance(rgb(color[theme])), b = luminance(fromHex(card));
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 3, `${theme} series ${color.index}`);
  }
});
test('fixed mappings are distinct and other names are stable', () => {
  const window = { setInterval() {} }, document = { getElementById() { return null; }, documentElement: { style: {} } };
  vm.runInNewContext(fs.readFileSync('page/app.js', 'utf8'), { window, document });
  const color = window.obeliskChart.seriesColor;
  const mapping = { codex: 0, claude: 1, omp: 2, deepseek: 6, 'codexhost-antigravity': 7, query: 0, attune: 3 };
  for (const [name, index] of Object.entries(mapping)) assert.equal(color(name), `var(--series-${index})`);
  assert.equal(color('unknown'), 'var(--series-unknown)');
  assert.equal(color('other'), color('other'));
  const fixed = [0,1,2,6,7];
  for (const theme of ['light', 'dark']) for (let i=0; i<fixed.length; i++) for (let j=i+1; j<fixed.length; j++) {
    const a = palette[fixed[i]][theme], b = palette[fixed[j]][theme], delta = Math.abs(a[2]-b[2]);
    assert.ok(Math.min(delta, 360-delta) >= 30 || Math.abs(a[0]-b[0])*100 >= 8);
  }
});
test('heat levels are separated in OKLab lightness', () => {
  const mixes = [0, ...[1,2,3].map(n => { const match = css.match(new RegExp(`--heat-${n}: color-mix\\(in oklab, var\\(--series-0\\) (\\d+)%`)); assert.ok(match); return +match[1] / 100; }), 1];
  assert.deepEqual(mixes, [0,.24,.44,.68,1]);
  for (const [theme, card, fg] of [['light','f6f6f7','25252a'], ['dark','232328','ededf0']]) {
    const base = .93 * labL(card) + .07 * labL(fg), main = palette[0][theme][0];
    const levels = mixes.map(p => base * (1-p) + main*p);
    for (let i=1; i<levels.length; i++) assert.ok(Math.abs(levels[i]-levels[i-1])*100 >= 6, `${theme} levels ${i-1}/${i}`);
  }
});
