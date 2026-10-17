// 学习台 app 空壳：常量和纯函数（SPEC-v0.5.1-webapp §2）
export const EXT_ID = 'hggnapidaihcdcoomhfdelladogpjfck';
export const EXT_ORIGIN = 'chrome-extension://' + EXT_ID;
export const IFRAME_SRC = EXT_ORIGIN + '/pages/library.html';
export const ALLOW = 'microphone; autoplay; fullscreen; screen-wake-lock; clipboard-write';
export const NS = 'xuexitai';
export const FIRST_MS = 5000;
export const LOAD_MS = 3000;
/** 状态栏色：平时 = 学习台底色；抽屉暗层开着 = 底色压上 32% 墨色（同扩展 --color-scrim） */
export const THEME = '#eceef0';
export const THEME_DIM = '#a7a9ac';

const SIDES = ['t', 'r', 'b', 'l'];
const plain = (o) => o !== null && typeof o === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const num = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 200;

/** 源、发送方、形状都对才收，否则 null。type：hello · insets · dim。 */
export function parseMessage(e, frameWin) {
  if (!e || e.origin !== EXT_ORIGIN || !frameWin || e.source !== frameWin) return null;
  const d = e.data;
  if (!plain(d) || d.ns !== NS || d.v !== 1) return null;
  if (d.type === 'dim') return typeof d.on === 'boolean' ? { type: 'dim', on: d.on } : null;
  if (!plain(d.insets) || !SIDES.every((k) => num(d.insets[k]))) return null;
  const insets = { t: d.insets.t, r: d.insets.r, b: d.insets.b, l: d.insets.l };
  if (d.type === 'insets') return { type: 'insets', insets };
  if (d.type !== 'hello' || !['library', 'study', 'vocab'].includes(d.page) || !['ok', 'blocked', 'split'].includes(d.storage)) return null;
  if (!['phone', 'desktop', 'desktop-site'].includes(d.layout) || typeof d.ext !== 'string' || !/^\d{1,4}(\.\d{1,5}){1,3}$/.test(d.ext)) return null;
  return { type: 'hello', page: d.page, ext: d.ext, storage: d.storage, layout: d.layout, insets };
}

// 握手状态机。timedOut = false | 'first'（首次 5 s 没报到）| 'lost'（连上后某次 load 3 s 没报到）。
// 报到可能在 load 前或后到：前到的记 early，load 时抵掉。
export function createWatch({ set = setTimeout, clear = clearTimeout, onChange = () => {} } = {}) {
  let hello = null, timedOut = false, ever = false, early = 0, awaiting = false, t1 = null, t2 = null;
  const emit = () => onChange({ hello, timedOut });
  return {
    start() {
      t1 = set(() => { t1 = null; if (!ever) { timedOut = 'first'; emit(); } }, FIRST_MS);
    },
    hello(msg) {
      hello = msg;
      if (awaiting) { awaiting = false; clear(t2); t2 = null; } else early++;
      if (!ever) { ever = true; clear(t1); t1 = null; }
      timedOut = false;
      emit();
    },
    load() {
      if (early) { early = 0; awaiting = false; return; }
      awaiting = true;
      if (!ever) return;
      clear(t2);
      t2 = set(() => { t2 = null; if (awaiting) { timedOut = 'lost'; emit(); } }, LOAD_MS);
    },
    state: () => ({ hello, timedOut }),
  };
}

/** 出哪张卡（null = 不出）：存储 → 内置浏览器 → 不是 Edge → 没连上。 */
export function cardFor({ ua = '', brands = [], hello = null, timedOut = false } = {}) {
  if (hello?.storage === 'blocked') return 'storage-blocked';
  if (hello?.storage === 'split') return 'storage-split';
  if (!timedOut) return null;
  if (timedOut === 'lost') return 'no-extension';
  if (/; wv\)/.test(ua)) return 'webview';
  const edge = /\bEdgA?\//.test(ua) || (Array.isArray(brands) && brands.some((b) => b?.brand === 'Microsoft Edge'));
  return edge ? 'no-extension' : 'not-edge';
}

// 卡上的字。**…** = 要点的路径（加粗）；「…」和 **…** 都不在中间断行（richParts）。hint / after 放在灰底块里（同学习台麦克风提示）。
export const CARD_TEXT = {
  'storage-blocked': {
    title: 'Edge 的 Cookie 设成了「屏蔽所有」',
    body: '这样 app 里读不到你的书和进度。数据都还在，没丢。',
    hint: '打开 **Edge Canary 设置 › 隐私和安全 › Cookie**，改成「屏蔽第三方 Cookie」或「允许」，再点重试。',
    retry: true,
  },
  'storage-split': {
    title: 'app 里看不到你的书',
    body: '这版 Edge 把 app 里的学习台和浏览器里的分开存了。书和进度都在浏览器里，没丢。',
    hint: '先在 Edge Canary 里用学习台（**≡ → 扩展 → 学习台**），别在 app 里重新导入。',
  },
  webview: { title: '要在 Edge 里打开', body: '这是别的应用里的内置浏览器，连不上学习台。', hint: '点右上角菜单 **「用浏览器打开」**，选 Edge Canary。' },
  'not-edge': {
    title: '要用 Edge Canary 打开',
    body: '学习台扩展装在 Edge Canary 里，别的浏览器打不开它。',
    hint: '在 Edge Canary 里打开这个网址：',
    url: true,
    after: '再点菜单 **≡ →「添加到手机」**。',
  },
  'no-extension': {
    title: '没连上学习台扩展',
    body: '在 Edge Canary 的「扩展」里看一眼：学习台装着、开着，版本 0.5.1 或更新。',
    tab: '从别的应用点开的链接，先点右上角 **「在 Edge 中打开」**。',
    retry: true,
  },
  framed: { title: '请直接打开这个网址', url: true },
};

/** 一段字拆成 [{text, bold, keep}]：**…** 加粗；「…」、路径里的每一段（只在 › / → 前后断）、「学习台」「Edge Canary」不在中间断行。纯函数。 */
export function richParts(s) {
  return String(s || '')
    .split(/(\*\*[^*]+\*\*|「[^」]*」|学习台|Edge Canary)/)
    .filter(Boolean)
    .flatMap((t) => {
      if (!t.startsWith('**')) return [{ text: t, bold: false, keep: t.startsWith('「') || t === '学习台' || t === 'Edge Canary' }];
      return t
        .slice(2, -2)
        .split(/(\s?[›→]\s?)/)
        .filter(Boolean)
        .map((p) => ({ text: p, bold: true, keep: !/^\s?[›→]\s?$/.test(p) }));
    });
}

/** 卡上的字：tab 那句只在不是 app 打开时出。 */
export function cardModel(kind, { standalone = false, url = '' } = {}) {
  const c = CARD_TEXT[kind];
  if (!c) return null;
  const hint = c.tab ? (standalone ? '' : c.tab) : c.hint || '';
  return { kind, title: c.title, body: c.body || '', hint, url: c.url ? url : '', after: c.after || '', retry: Boolean(c.retry) };
}

export const shellUrl = (loc) => (loc.host + loc.pathname).replace(/\/(index\.html)?$/, '');

/** 每边 max(0, 空壳量到的 − 扩展页量到的)。 */
export function padFrom(shell, ext) {
  const out = {};
  for (const k of SIDES) out[k] = Math.max(0, Math.round(Number(shell?.[k]) || 0) - Math.round(Number(ext?.[k]) || 0));
  return out;
}

/** 给扩展页的底部安全区（iframe 铺到屏幕底，下面那截由扩展页自己让）：键盘兜底缩了 iframe 时是 0。 */
export const padMsg = (pad, cut) => ({ ns: NS, v: 1, type: 'pad', b: cut > 0 ? 0 : Math.max(0, Math.round(Number(pad?.b) || 0)) });

/** 键盘兜底：没认 resizes-content 时 iframe 缩矮多少。 */
export function kbCut(innerH, vv) {
  if (!vv || Math.abs((Number(vv.scale) || 1) - 1) > 0.01) return 0;
  const d = innerH - vv.height - (Number(vv.offsetTop) || 0);
  return d > 120 ? Math.round(d) : 0;
}

/** 两个 #rrggbb 之间取 t（0–1）。 */
export function mixHex(a, b, t) {
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k).toString(16).padStart(2, '0')).join('');
}
