// 学习台 app 空壳入口（SPEC-v0.5.1-webapp §2.4）。不碰存储、不调 fetch、不改历史；iframe 建好后不改 src（安卓返回靠共同会话历史）。
// 往 iframe 只发一种消息：底部安全区 {type: 'pad', b}（targetOrigin 写死扩展源）。iframe 铺到屏幕底，下面那截由扩展页自己让。
import { IFRAME_SRC, EXT_ORIGIN, ALLOW, THEME, THEME_DIM, parseMessage, createWatch, cardFor, cardModel, richParts, shellUrl, padFrom, padMsg, kbCut, mixHex } from './shell-core.js';

const doc = document;
const root = doc.documentElement;
const cardEl = doc.getElementById('card');
let frame = null;
let extInsets = null;
let sentPad = null;

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
  cardEl.setAttribute('role', 'alert');
  cardEl.dataset.card = kind;
  cardEl.replaceChildren(box);
  cardEl.hidden = false;
  if (frame) frame.inert = true;
}

function render(s) {
  const kind = cardFor({ ua: navigator.userAgent, brands: navigator.userAgentData?.brands, ...s });
  if (kind) {
    showCard(kind);
    setDim(false);
  } else if (cardEl.dataset.card) {
    cardEl.hidden = true;
    delete cardEl.dataset.card;
    cardEl.replaceChildren();
    frame.inert = false;
  }
  root.dataset.state = kind ? 'card' : s.hello ? 'connected' : 'waiting';
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
  const watch = createWatch({ onChange: render });
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
  frame = el('iframe');
  frame.id = 'app';
  frame.title = '学习台';
  frame.setAttribute('allow', ALLOW);
  frame.src = IFRAME_SRC;
  frame.addEventListener('load', () => watch.load());
  doc.body.append(frame);
  watch.start();

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
