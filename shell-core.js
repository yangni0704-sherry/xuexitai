// 学习台 app 空壳：常量和纯函数（SPEC-v0.5.1-webapp §2）
export const EXT_ID = 'hggnapidaihcdcoomhfdelladogpjfck';
export const EXT_ORIGIN = 'chrome-extension://' + EXT_ID;
export const IFRAME_SRC = EXT_ORIGIN + '/pages/library.html';
export const ALLOW = 'microphone; autoplay; fullscreen; screen-wake-lock; clipboard-write';
export const NS = 'xuexitai';
// 握手计时（真机反馈修 10-17：先显示等待画面、自动重载一次、再出卡；页面在后台时不计时）。扩展页载入后 ≤ 1.5 s 必报到（存储探针最多等 1.5 s）。
/** 首次：最早这时自动重载一次 iframe（给冷启动时还没加载完的扩展留时间） */
export const RETRY_MS = 4000;
/** 首次：iframe 载入完这么久还没报到 = 载入的是错误页，可以重载（存储探针最多 1.5 s，慢手机留余量）。一直没载入完的不重载（见 createWatch） */
export const SETTLE_MS = 3000;
/** 首次：这时还没报到 → 出卡 */
export const FIRST_MS = 12000;
/** 连上以后某次载入：这么久没报到 → 盖上等待画面 */
export const LOAD_WAIT_MS = 3000;
/** ……这么久还没有 → 出卡（lost） */
export const LOAD_MS = 8000;
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

// 握手状态机。输出 {hello, timedOut, waiting}：timedOut = false | 'first'（首次 12 s 没报到）| 'lost'（连上后某次 load 8 s 没报到）；
// waiting = 该盖等待画面（首次报到前；连上后某次 load 3 s 没报到起）。报到可能在 load 前或后到：前到的记 early，load 时抵掉。
// 首次自动重载一次（onRetry，由空壳换一个新 iframe）：最早 4 s，且这次 iframe 载入完已 3 s 还没报到（= 错误页）。
// 一直没载入完的不重载、等到 12 s 出卡：扩展页 <head> 引了 Google Fonts 样式表，网慢时它挡住 load 和报到；换 iframe 只会让样式表重下、更慢。
// pause / resume：页面到后台就停表，回到前台从现在起重新给完整的等待时间（后台冻结时计时器会攒到回前台一齐到点）。
// 诊断（diag）只记在内存里；since = 出卡那次从哪儿起算：open 打开 · resume 最近一次回到前台 · load 这次载入。
export function createWatch({ set = setTimeout, clear = clearTimeout, now = () => performance.now(), onChange = () => {}, onRetry = () => {} } = {}) {
  let hello = null, timedOut = false, waiting = true, ever = false, early = 0, awaiting = false, paused = false;
  let base = 0, baseBy = 'open', loadAt = null, loadBy = 'load', frameLoadAt = null;
  const d = { start: 0, loads: 0, retriedAt: null, hellos: 0, helloAt: null, firstHelloAt: null, cardAt: null, waited: null, since: null, pauses: 0 };
  const timers = new Map();
  const disarm = (k) => {
    if (timers.has(k)) clear(timers.get(k));
    timers.delete(k);
  };
  const arm = (k, at, fn) => {
    disarm(k);
    timers.set(k, set(() => { timers.delete(k); fn(); }, Math.max(0, at - now())));
  };
  const emit = () => onChange({ hello, timedOut, waiting });
  const card = (kind) => {
    const first = kind === 'first';
    timedOut = kind;
    waiting = false;
    d.cardAt = now();
    d.waited = d.cardAt - (first ? base : loadAt);
    d.since = first ? baseBy : loadBy;
    emit();
  };
  /** 该重载的时刻；还没载入完 → null（不重载） */
  const retryAt = () => (frameLoadAt === null ? null : Math.max(base + RETRY_MS, frameLoadAt + SETTLE_MS));
  function retry() {
    if (ever || timedOut || d.retriedAt !== null) return;
    d.retriedAt = now();
    early = 0;
    awaiting = false;
    frameLoadAt = null;
    onRetry();
  }
  function planFirst() {
    if (ever || paused || timedOut) return;
    arm('first', base + FIRST_MS, () => card('first'));
    const at = retryAt();
    if (d.retriedAt === null && at !== null && at < base + FIRST_MS) arm('retry', at, retry);
    else disarm('retry');
  }
  function planLost() {
    if (paused || !ever || !awaiting || timedOut || loadAt === null) return;
    if (!waiting) arm('wait', loadAt + LOAD_WAIT_MS, () => { if (awaiting && !timedOut) { waiting = true; emit(); } });
    arm('lost', loadAt + LOAD_MS, () => { if (awaiting) card('lost'); });
  }
  return {
    start() {
      base = d.start = now();
      baseBy = 'open';
      planFirst();
    },
    hello(msg) {
      hello = msg;
      d.hellos++;
      d.helloAt = now();
      if (awaiting) {
        awaiting = false;
        disarm('wait');
        disarm('lost');
      } else early++;
      if (!ever) {
        ever = true;
        d.firstHelloAt = d.helloAt;
        disarm('first');
        disarm('retry');
      }
      timedOut = false;
      waiting = false;
      emit();
    },
    load() {
      d.loads++;
      frameLoadAt = now();
      if (early) { early = 0; awaiting = false; return; }
      awaiting = true;
      if (!ever) return planFirst();
      loadAt = frameLoadAt;
      loadBy = 'load';
      planLost();
    },
    pause() {
      if (paused) return;
      paused = true;
      d.pauses++;
      for (const k of [...timers.keys()]) disarm(k);
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (!ever) {
        base = now();
        baseBy = 'resume';
        planFirst();
      } else if (awaiting && !timedOut) {
        loadAt = now();
        loadBy = 'resume';
        planLost();
      }
    },
    state: () => ({ hello, timedOut, waiting }),
    diag: () => ({ ...d, timedOut, paused, hello: hello && { ext: hello.ext, page: hello.page, storage: hello.storage, layout: hello.layout } }),
  };
}

/** 一段时长（ms）→「4.0 秒」「1 分 12 秒」「1 小时 2 分」。 */
export function fmtDur(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${Math.floor(s % 60)} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

/** UA 里的 Edge 版本（EdgA/ 或 Edg/；UA 被改时看 brands）；不是 Edge → null。 */
export function edgeVersion(ua = '', brands = []) {
  const m = /\bEdgA?\/([\d.]+)/.exec(ua);
  if (m) return m[1];
  const b = Array.isArray(brands) ? brands.find((x) => x?.brand === 'Microsoft Edge') : null;
  return b ? String(b.version) : null;
}

const NAV = { navigate: '冷启动（navigate）', reload: '重新载入（reload）', back_forward: '前进后退（back_forward）', prerender: '预载（prerender）' };

/** 卡上「详情」的几行（纯函数）：d = watch.diag() + {now, env, edge, standalone}。只在内存里，不存、不发。 */
export function diagLines(d = {}) {
  const env = d.env ?? {};
  const now = Number(d.now) || 0;
  const ago = (t) => `${fmtDur(now - t)}前`;
  // 回到前台会重新计时：写清「等了几秒」是从哪儿起算的（后台的时间不算在里面；从打开算起的总时长看「已开」）
  const from = d.since === 'resume' ? '从最近一次回到前台算起' : d.timedOut === 'lost' ? '从这次载入算起' : '从打开算起';
  const head =
    d.timedOut === 'first'
      ? `${from}等了 ${fmtDur(d.waited)}，学习台一直没报到`
      : d.timedOut === 'lost'
        ? `连上过；${from}等了 ${fmtDur(d.waited)}没报到`
        : `学习台报到了：存储 ${d.hello?.storage ?? '—'}`;
  const nav = [`打开方式：${NAV[env.navType] ?? `未知（${env.navType ?? '—'}）`}`];
  if (env.discarded) nav.push('被系统回收后重开');
  if (env.persisted) nav.push(`从往返缓存恢复 ${env.persisted} 次`);
  if (env.startHidden) nav.push('打开时在后台');
  nav.push(`已开 ${fmtDur(now - (d.start ?? 0))}`);
  const back = [`回到前台 ${env.shows ?? 0} 次${env.lastShowAt != null ? `，最近一次 ${ago(env.lastShowAt)}` : ''}`];
  if (env.resumes) back.push(`解冻 ${env.resumes} 次`);
  if (d.paused) back.push('现在在后台');
  const h = d.hello;
  return [
    head,
    `iframe 载入 ${d.loads ?? 0} 次 · 自动重试：${d.retriedAt == null ? '没有' : `第 ${fmtDur(d.retriedAt - (d.start ?? 0))}重试过`}`,
    nav.join(' · '),
    back.join(' · '),
    `上次报到：${h ? `${h.ext} · ${h.page} · ${ago(d.helloAt)}` : '从没报到'}${(d.hellos ?? 0) > 1 ? `（共 ${d.hellos} 次）` : ''}`,
    `${d.edge ? `Edge ${d.edge}` : 'UA 里没有 Edge'} · ${d.standalone ? 'app 打开' : '浏览器标签页'}`,
  ];
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
