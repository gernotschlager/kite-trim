/* Trimwerk – Großansicht für Bilder auf der ganzen Seite
   Klick auf ein Bild (in <figure>) öffnet es groß.
   Weiter: Pfeiltasten ← →, Wischen links/rechts, Pfeil-Knöpfe. Schließen: Esc, ✕, Hintergrund, nach unten wischen.
   Einbinden: <script src="../lib/lightbox.js" defer></script>
   Optional: data-lightbox="<css-selector>" am <script>, Standard: "main figure img". */
(function () {
  const me = document.currentScript;
  const sel = (me && me.dataset.lightbox) || 'main figure img';

  const css = `
.twlb{position:fixed;inset:0;z-index:100;background:rgba(5,9,13,.97);display:flex;align-items:center;justify-content:center;touch-action:pan-y}
.twlb[hidden]{display:none!important}
.twlb img{max-width:100vw;max-height:calc(100vh - 110px);object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
.twlb .twlb-bar{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 16px;display:flex;justify-content:space-between;gap:12px;color:var(--ink-2,#9aabb8);font-size:14px}
.twlb .twlb-bar b{color:var(--ink,#e7edf2);font-weight:600;white-space:nowrap}
.twlb button{position:absolute;background:rgba(17,29,39,.85);color:var(--ink,#e7edf2);border:1px solid var(--rule,#24333f);border-radius:999px;width:52px;height:52px;font-size:26px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.twlb button:hover{border-color:var(--accent,#ff7a2e);color:var(--accent-ink,#ff9a5c)}
.twlb .twlb-x{top:14px;right:14px;width:46px;height:46px;font-size:22px}
.twlb .twlb-p{left:14px;top:50%;transform:translateY(-50%)}.twlb .twlb-n{right:14px;top:50%;transform:translateY(-50%)}
@media (max-width:600px){.twlb .twlb-p,.twlb .twlb-n{width:42px;height:42px;font-size:20px;top:auto;bottom:52px;transform:none}}
${sel.split(',').map(s => s.trim() + '{cursor:zoom-in}').join('')}`;

  function init() {
    const imgs = [...document.querySelectorAll(sel)];
    if (!imgs.length) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('div');
    box.className = 'twlb'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Bildansicht');
    box.innerHTML = '<img alt=""><button class="twlb-x" aria-label="Schließen">✕</button><button class="twlb-p" aria-label="Vorheriges Bild">‹</button><button class="twlb-n" aria-label="Nächstes Bild">›</button><div class="twlb-bar"><span></span><b></b></div>';
    document.body.appendChild(box);
    const big = box.querySelector('img'), cap = box.querySelector('.twlb-bar span'), no = box.querySelector('.twlb-bar b');
    const prev = box.querySelector('.twlb-p'), next = box.querySelector('.twlb-n');
    const srcOf = im => { const a = im.closest('a'); return a && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(a.href) ? a.href : (im.currentSrc || im.src); };
    const capOf = im => { const f = im.closest('figure'); const c = f && f.querySelector('figcaption'); return (c ? c.textContent : im.alt || '').trim(); };
    let i = 0, last = null;

    function show(k) {
      const n = imgs.length; i = (k + n) % n;
      big.src = srcOf(imgs[i]); big.alt = imgs[i].alt || '';
      cap.textContent = capOf(imgs[i]);
      no.textContent = n > 1 ? (i + 1) + ' / ' + n : '';
      prev.hidden = next.hidden = n < 2;
      [1, -1].forEach(d => { new Image().src = srcOf(imgs[(i + d + n) % n]); });
    }
    function open(k) { last = document.activeElement; box.hidden = false; document.body.style.overflow = 'hidden'; show(k); box.querySelector('.twlb-x').focus(); }
    function close() { box.hidden = true; document.body.style.overflow = ''; if (last && last.focus) last.focus(); }

    imgs.forEach((im, k) => {
      const target = im.closest('a') || im;
      target.addEventListener('click', e => { e.preventDefault(); open(k); });
    });
    box.querySelector('.twlb-x').onclick = close;
    prev.onclick = e => { e.stopPropagation(); show(i - 1); };
    next.onclick = e => { e.stopPropagation(); show(i + 1); };
    box.addEventListener('click', e => { if (e.target === box) close(); });
    document.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'ArrowRight') { show(i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(i - 1); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    let tx = null, ty = null;
    box.addEventListener('touchstart', e => { if (e.touches.length === 1) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } }, { passive: true });
    box.addEventListener('touchend', e => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) show(i + (dx < 0 ? 1 : -1));
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
