// 学习台 app 空壳入口（SPEC-v0.5.1-webapp §2.4）。不碰存储、不调 fetch、不改历史；iframe 建好后不改 src（安卓返回靠共同会话历史）。
// 往 iframe 只发一种消息：底部安全区 {type: 'pad', b}（targetOrigin 写死扩展源）。iframe 铺到屏幕底，下面那截由扩展页自己让。
// （真机反馈修 10-17，§11）没连上时显示等待画面（#wait）；首次没报到自动重载一次 = 换一个新 iframe（先删旧的再放新的：
//   新 iframe 的第一次载入不进会话历史，本机实测历史条数不变、返回照旧；改 src 会多一条）；页面在后台时停表；
//   卡上多一行可展开的「详情」（诊断：只在内存里，不存、不发）。
import { IFRAME_SRC, EXT_ORIGIN, ALLOW, THEME, THEME_DIM, parseMessage, createWatch, cardFor, cardModel, richParts, shellUrl, padFrom, padMsg, kbCut, mixHex, diagLines, edgeVersion } from './shell-core.js';

const doc = document;
const root = doc.documentElement;
const cardEl = doc.getElementById('card');
let frame = null;
let extInsets = null;
let sentPad = null;
let watch = null;
/** 诊断用的打开方式和前后台记录（只在内存里） */
const env = { navType: null, discarded: false, startHidden: false, shows: 0, lastShowAt: null, persisted: 0, resumes: 0 };

function el(tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 一段带 **路径** / 「…」 的字：加粗的、不断行的各包一层 span。 */
function rich(tag, cls, text) {
  const p = el(tag, cls);
  for (const t of richParts(text)) p.append(t.bold || t.keep ? el(t.bold ? 'b' : 'span', t.keep ? 'nw' : '', t.text) : t.text);
  return p;
}

function showCard(kind) {
  if (cardEl.dataset.card === kind) return;
  const m = cardModel(kind, { standalone: matchMedia('(display-mode: standalone)').matches, url: shellUrl(location) });
  const box = el('div', 'card');
  const icon = el('img', 'card__icon');
  icon.src = 'icons/icon-192.png';
  icon.alt = '';
  box.append(icon, rich('h1', 'card__title', m.title));
  if (m.body) box.append(rich('p', 'card__body', m.body));
  if (m.hint || m.url || m.after) {
    const note = el('div', 'card__note');
    if (m.hint) note.append(rich('p', 'card__hint', m.hint));
    if (m.url) note.append(el('p', 'card__url', m.url));
    if (m.after) note.append(rich('p', 'card__hint', m.after));
    box.append(note);
  }
  if (m.retry) {
    const b = el('button', 'card__retry', '重试');
    b.type = 'button';
    b.onclick = () => location.reload();
    box.append(b);
  }
  if (watch) box.append(diagBox());
  cardEl.setAttribute('role', 'alert');
  cardEl.dataset.card = kind;
  cardEl.replaceChildren(box);
  cardEl.hidden = false;
  if (frame) frame.inert = true;
}

/** 卡上的「详情」：灰小字，展开时按现在重算（「距今」是新的），整段可长按复制。 */
function diagBox() {
  const det = el('details', 'card__diag');
  const body = el('p', 'card__diag-body');
  det.append(el('summary', 'card__diag-sum', '详情'), body);
  const fill = () => {
    body.textContent = diagLines({
      ...watch.diag(),
      now: performance.now(),
      env: { ...env },
      edge: edgeVersion(navigator.userAgent, navigator.userAgentData?.brands),
      standalone: matchMedia('(display-mode: standalone)').matches,
    }).join('\n');
  };
  fill();
  det.addEventListener('toggle', () => det.open && fill());
  return det;
}

function render(s) {
  const kind = cardFor({ ua: navigator.userAgent, brands: navigator.userAgentData?.brands, ...s });
  if (kind) {
    showCard(kind);
  } else if (cardEl.dataset.card) {
    cardEl.hidden = true;
    delete cardEl.dataset.card;
    cardEl.replaceChildren();
    frame.inert = false;
  }
  const state = kind ? 'card' : s.hello && !s.waiting ? 'connected' : 'waiting';
  // 出卡、盖等待画面时状态栏不暗（扩展页的暗层看不见了；新载入的页会重新报）
  if (state !== 'connected') setDim(false);
  root.dataset.state = state;
}

// 状态栏跟着扩展页的暗层一起暗下去 / 亮回来（theme-color 按帧过渡：进 200 ms ease-out、出 240 ms ease-in，同抽屉暗层）；四周垫的那几条走 css
const meta = doc.querySelector('meta[name="theme-color"]');
let dimAt = 0;
let dimRaf = 0;
function setDim(on) {
  if ((root.dataset.dim === 'true') === on) return;
  if (on) root.dataset.dim = 'true';
  else delete root.dataset.dim;
  cancelAnimationFrame(dimRaf);
  const from = dimAt;
  const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : on ? 200 : 240;
  let t0 = null;
  const step = (now) => {
    t0 ??= now;
    const k = ms ? Math.min(1, (now - t0) / ms) : 1;
    dimAt = from + ((on ? 1 : 0) - from) * (on ? 1 - (1 - k) ** 2 : k * k);
    const c = mixHex(THEME, THEME_DIM, dimAt);
    if (meta && meta.content !== c) meta.content = c;
    if (k < 1) dimRaf = requestAnimationFrame(step);
  };
  dimRaf = requestAnimationFrame(step);
}

// 安全区：空壳自己量（隐藏探针），每边缺 max(0, 空壳 − 扩展页)：上、左、右由空壳垫（iframe 让开），下面告诉扩展页（iframe 铺到底）
function applyPad() {
  if (!extInsets) return;
  const p = el('div');
  p.id = 'sa';
  doc.body.append(p);
  const cs = getComputedStyle(p);
  const mine = { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft };
  p.remove();
  for (const k in mine) mine[k] = Number.parseFloat(mine[k]) || 0;
  const pad = padFrom(mine, extInsets);
  for (const k of ['t', 'r', 'l']) root.style.setProperty(`--pad-${k}`, `${pad[k]}px`);
  const msg = padMsg(pad, Number.parseFloat(root.style.getPropertyValue('--kb-cut')) || 0);
  if (sentPad === msg.b) return;
  sentPad = msg.b;
  root.dataset.padB = String(msg.b);
  frame?.contentWindow?.postMessage(msg, EXT_ORIGIN);
}

if (window.top !== window) {
  root.dataset.state = 'framed';
  showCard('framed');
} else {
  // 等待画面（图标 + 一行字）：data-state = waiting 时淡入，连上时 160 ms 淡出（shell.css）
  const wait = el('div');
  wait.id = 'wait';
  wait.setAttribute('role', 'status');
  const wi = el('img', 'wait__icon');
  wi.src = 'icons/icon-192.png';
  wi.alt = '';
  wait.append(wi, el('p', 'wait__text', '正在打开学习台…'));
  doc.body.append(wait);
  addEventListener('message', (e) => {
    const m = parseMessage(e, frame && frame.contentWindow);
    if (!m) return;
    if (m.type === 'dim') return setDim(m.on);
    extInsets = m.insets;
    if (m.type !== 'hello') return applyPad();
    // 报到 = 扩展页刚启动（新载入的一页没有开着的抽屉、也还没收到过 pad）
    setDim(false);
    sentPad = null;
    applyPad();
    Object.assign(root.dataset, { ext: m.ext, extLayout: m.layout, storage: m.storage });
    watch.hello(m);
  });
  // iframe：只在这里设 src。自动重试 = 换一个新的（旧的先删，新的第一次载入不进会话历史）；旧 iframe 的 load / 报到都不算
  const makeFrame = () => {
    const f = el('iframe');
    f.id = 'app';
    f.title = '学习台';
    f.setAttribute('allow', ALLOW);
    f.src = IFRAME_SRC;
    f.addEventListener('load', () => f === frame && watch.load());
    return f;
  };
  const retryFrame = () => {
    const old = frame;
    frame = makeFrame();
    old?.remove();
    doc.body.append(frame);
  };
  watch = createWatch({ onChange: render, onRetry: retryFrame });
  frame = makeFrame();
  doc.body.append(frame);
  watch.start();

  // 打开方式和前后台（诊断用）；页面到后台停表，回到前台重新计（后台冻结时计时器会攒到回前台一齐到点）
  env.navType = performance.getEntriesByType?.('navigation')?.[0]?.type ?? null;
  env.discarded = doc.wasDiscarded === true;
  env.startHidden = doc.visibilityState === 'hidden';
  if (env.startHidden) watch.pause();
  const shown = () => {
    env.lastShowAt = performance.now();
    watch.resume();
  };
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') return watch.pause();
    env.shows++;
    shown();
  });
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    env.persisted++;
    shown();
  });
  doc.addEventListener('resume', () => {
    env.resumes++;
    if (doc.visibilityState !== 'hidden') watch.resume();
  });

  addEventListener('resize', applyPad);
  const vv = window.visualViewport;
  const kb = () => {
    root.style.setProperty('--kb-cut', `${kbCut(innerHeight, vv)}px`);
    applyPad();
  };
  vv?.addEventListener('resize', kb);
  vv?.addEventListener('scroll', kb);

  try {
    navigator.serviceWorker?.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  } catch {
    // Cookie 屏蔽所有时会抛，不影响别的
  }
}
