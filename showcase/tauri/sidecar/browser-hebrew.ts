import { translate } from './hebrew.js';
import { CARTESIA_VOICES } from './cartesia-speaker.js';

function localize(root: Node): void {
  if (root instanceof Element && root.closest('script,style,code,pre,textarea,[data-user-content]')) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const before = root.textContent ?? '', after = translate(before);
    if (after !== before) root.textContent = after;
  } else if (root instanceof Element) {
    for (const name of ['title', 'placeholder', 'aria-label', 'data-name']) {
      const before = root.getAttribute(name);
      if (before) { const after = translate(before); if (after !== before) root.setAttribute(name, after); }
    }
    // Keep credentials and code legible inside the right-to-left interface.
    if (root.matches('input[type="password"],input[type="email"],input[type="url"],kbd,.caps,.chords,.cmd')) root.setAttribute('dir', 'ltr');
    for (const child of root.childNodes) localize(child);
  }
}

export function main(): void {
  document.documentElement.lang = 'he'; document.documentElement.dir = 'rtl';
  localize(document.documentElement);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData' || record.type === 'attributes') localize(record.target);
      for (const node of record.addedNodes) localize(node);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'data-name'] });
}

function boot(): void {
  Object.assign(window, { ROAMIES_HE_VOICES: CARTESIA_VOICES, ROAMIES_HE: translate });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true }); else main();
}
boot();
