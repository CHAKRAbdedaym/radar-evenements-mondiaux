// French typography pass on rendered text: a no-break space before « : » and « » », after « « »,
// and a narrow no-break space before ; ? ! — so punctuation never starts a line.
// Runs on text nodes (not inside code/pre/inputs/RTL text); idempotent, so the observer never loops.

const NBSP = " ";
const NNBSP = " ";
const SKIP = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "INPUT"]);
const RE_COLON = new RegExp(`[ ${NNBSP}]([:»])`, "g");
const RE_NARROW = new RegExp(`[ ${NBSP}]([;?!])`, "g");
const RE_OPEN = new RegExp(`«[ ${NNBSP}]`, "g");

function fix(node: Text) {
  const p = node.parentElement;
  if (!p || SKIP.has(p.tagName) || p.closest("code, pre, [dir=rtl]")) return;
  const v = node.data;
  if (!/[:;?!«»]/.test(v)) return;
  const out = v.replace(RE_COLON, `${NBSP}$1`).replace(RE_NARROW, `${NNBSP}$1`).replace(RE_OPEN, `«${NBSP}`);
  if (out !== v) node.data = out;
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return fix(root as Text);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = it.nextNode())) fix(n as Text);
}

export function startFrenchTypography(root: HTMLElement) {
  walk(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") walk(m.target);
      else m.addedNodes.forEach((n) => walk(n));
    }
  }).observe(root, { subtree: true, childList: true, characterData: true });
}
