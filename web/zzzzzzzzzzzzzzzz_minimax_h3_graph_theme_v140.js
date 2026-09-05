import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// VELVET VICE · MiniMax H3 Reactor Theme
// Visual-only layer. It does NOT change node size, widget layout, routing,
// sampling, model state, or execution state. The existing 1.4.1 design system
// remains the single owner of __vvExecutionState.

const STYLE_ID = "vv-h3-reactor-theme-test-v1";
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
let activeVisualNode = null;
let animationTimer = null;
let listenersInstalled = false;

const ROLE = Object.freeze({
  setup:   { a: "#4b2a6c", b: "#665580" },
  prompt:  { a: "#5e3d83", b: "#496fa0" },
  model:   { a: "#563a78", b: "#496f96" },
  video:   { a: "#3a5681", b: "#2e7e91" },
  preview: { a: "#376684", b: "#2e8d8c" },
  post:    { a: "#355e71", b: "#397f77" },
  output:  { a: "#4c6476", b: "#4f866a" },
  guide:   { a: "#3c424b", b: "#4d5660" },
  internal:{ a: "#30363d", b: "#3f474f" },
});

const ACTIVE_STOPS = Object.freeze([
  [0.00, "#32194f", "#54266f"], // dark violet
  [0.20, "#8446b6", "#b45ce2"], // lilac
  [0.40, "#356fa8", "#429edb"], // blue
  [0.60, "#118f8b", "#18c8b6"], // turquoise
  [0.80, "#55a814", "#7dff24"], // poison green
  [1.00, "#32194f", "#54266f"],
]);

function nodeType(node) { return String(node?.comfyClass ?? node?.type ?? ""); }
function titleOf(node) { return String(node?.title ?? ""); }
function nodes() { return app.graph?._nodes ?? []; }

function isZen(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function isMainH3(node) {
  return Boolean(node) && !isZen(node) && nodeType(node).startsWith("VelvetViceMiniMaxH3");
}

function graphIsH3() { return nodes().some(isMainH3); }

function roleFor(node) {
  const type = nodeType(node);
  const title = titleOf(node).toUpperCase();
  if (node?.properties?.vv_h3_internal || title.startsWith("H3 INTERNAL")) return "internal";
  if (/NOTE|LABEL|BOOKMARK/.test(type.toUpperCase()) || /GUIDE|REQUIREMENTS|DIAGNOSTICS|CONSTRAINTS|DEFAULTS/.test(title)) return "guide";
  if (/REFERENCE IMAGE|SOURCE FRAME/.test(title) || type === "LoadImage") return "setup";
  if (/PROMPT/.test(type.toUpperCase()) || /PROMPT/.test(title) || type.includes("OllamaRelease")) return "prompt";
  if (/LORA|TURBO|MODEL ROUTER|VAE ROUTER/.test(title) || type === "VelvetViceMiniMaxH3PowerLoraAV") return "model";
  if (/LIVE PREVIEW/.test(title) || type === "VelvetViceMiniMaxH3LivePreview") return "preview";
  if (/MINIMAX H3 ENGINE/.test(title) || type === "VelvetViceMiniMaxH3AudioGate") return "video";
  if (/OUTPUT STUDIO|OUTPUT \/ FINISHING HUB/.test(title) || type === "VelvetViceMiniMaxH3OutputHub" || type === "VelvetViceMiniMaxH3OutputStudio") return "output";
  if (/RIFE|GHOST|WATERMARK|ROUTER|CHECKPOINT|PRUNE|CLEANUP/.test(title)) return "post";
  return "setup";
}

function shellFor(node) {
  return node?.__vvh3Shell
    ?? node?.__vvH3PromptShell
    ?? node?.__vvH3FinalPromptShell
    ?? node?.__vvPowerLoraShell
    ?? node?.__vvOutputShell
    ?? node?.__vvWatermarkShell
    ?? node?.__vvH3MonitorShell
    ?? node?.__vvh3PreviewDisplay?.shell
    ?? null;
}

function stateFor(node) {
  const state = String(node?.__vvExecutionState ?? "idle").toLowerCase();
  if (["active", "error", "warning", "done", "idle", "queued"].includes(state)) return state;
  return "idle";
}

function markShell(node) {
  const shell = shellFor(node);
  if (!shell) return;
  shell.classList.add("vvh3-reactor");
  shell.dataset.h3Runtime = stateFor(node);
  shell.dataset.h3Role = roleFor(node);
}

function hexRgb(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}
function mixHex(a, b, t) {
  const aa = hexRgb(a), bb = hexRgb(b), q = Math.max(0, Math.min(1, t));
  const out = aa.map((v, i) => Math.round(v + (bb[i] - v) * q));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function activePaletteAt(ms) {
  const p = (ms % 5200) / 5200;
  let left = ACTIVE_STOPS[0], right = ACTIVE_STOPS[ACTIVE_STOPS.length - 1];
  for (let i = 0; i < ACTIVE_STOPS.length - 1; i += 1) {
    if (p >= ACTIVE_STOPS[i][0] && p <= ACTIVE_STOPS[i + 1][0]) {
      left = ACTIVE_STOPS[i]; right = ACTIVE_STOPS[i + 1]; break;
    }
  }
  const local = (p - left[0]) / Math.max(0.0001, right[0] - left[0]);
  return { title: mixHex(left[1], right[1], local), box: mixHex(left[2], right[2], local) };
}

function applyIdle(node) {
  if (!isMainH3(node)) return;
  const role = ROLE[roleFor(node)] ?? ROLE.setup;
  const state = stateFor(node);
  if (state === "error") {
    node.color = "#7b4450"; node.boxcolor = "#d07b89";
  } else if (state === "warning") {
    node.color = "#7b6244"; node.boxcolor = "#d2aa70";
  } else {
    node.color = role.a; node.boxcolor = role.b;
  }
  node.bgcolor = "#111a23";
  markShell(node);
  node.setDirtyCanvas?.(true, true);
}

function findActiveNode() {
  return nodes().find((node) => isMainH3(node) && stateFor(node) === "active") ?? null;
}

function syncState() {
  if (!graphIsH3()) return;
  const next = findActiveNode();
  if (activeVisualNode && activeVisualNode !== next) applyIdle(activeVisualNode);
  for (const node of nodes()) {
    if (isMainH3(node) && node !== next) applyIdle(node);
  }
  activeVisualNode = next;
  if (activeVisualNode) markShell(activeVisualNode);
}

function ensureAnimationTimer() {
  if (animationTimer != null || reducedMotion) return;
  animationTimer = setInterval(() => {
    if (!graphIsH3()) return;
    const next = findActiveNode();
    if (next !== activeVisualNode) syncState();
    if (!activeVisualNode || stateFor(activeVisualNode) !== "active") return;

    const pal = activePaletteAt(performance.now());
    activeVisualNode.color = pal.title;
    activeVisualNode.boxcolor = pal.box;
    // Body deliberately never color-cycles.
    activeVisualNode.bgcolor = "#111a23";
    markShell(activeVisualNode);
    activeVisualNode.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, false);
  }, 90);
}

function installCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .vvh3-reactor{
      --h3-idle-a:#4b2a6c;--h3-idle-b:#665580;
      color:#e9eef4!important;
      background:linear-gradient(150deg,#0f171f,#16212b)!important;
      border:1px solid rgba(103,126,145,.34)!important;
      box-shadow:0 10px 26px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.025)!important;
      animation:none!important;
      transition:border-color .16s ease,box-shadow .16s ease!important;
    }
    .vvh3-reactor[data-h3-role="prompt"]{--h3-idle-a:#5e3d83;--h3-idle-b:#496fa0}
    .vvh3-reactor[data-h3-role="model"]{--h3-idle-a:#563a78;--h3-idle-b:#496f96}
    .vvh3-reactor[data-h3-role="video"]{--h3-idle-a:#3a5681;--h3-idle-b:#2e7e91}
    .vvh3-reactor[data-h3-role="preview"]{--h3-idle-a:#376684;--h3-idle-b:#2e8d8c}
    .vvh3-reactor[data-h3-role="post"]{--h3-idle-a:#355e71;--h3-idle-b:#397f77}
    .vvh3-reactor[data-h3-role="output"]{--h3-idle-a:#4c6476;--h3-idle-b:#4f866a}
    .vvh3-reactor[data-h3-role="guide"]{--h3-idle-a:#3c424b;--h3-idle-b:#4d5660}
    .vvh3-reactor[data-h3-role="internal"]{--h3-idle-a:#30363d;--h3-idle-b:#3f474f}

    /* All idle surfaces are intentionally static. */
    .vvh3-reactor .vvh3-head,
    .vvh3-reactor .vvh3-preview-head,
    .vvh3-reactor .vvh3p-head,
    .vvh3-reactor .vv-head,
    .vvh3-reactor .vvh3m-head{
      position:relative!important;
      background:linear-gradient(112deg,var(--h3-idle-a),var(--h3-idle-b),#111922)!important;
      background-size:100% 100%!important;
      background-position:0 50%!important;
      animation:none!important;
      border-bottom:1px solid rgba(128,148,166,.24)!important;
    }

    /* Thin reactor energy line; active only. */
    .vvh3-reactor .vvh3-head::before,
    .vvh3-reactor .vvh3-preview-head::before,
    .vvh3-reactor .vvh3p-head::before,
    .vvh3-reactor .vv-head::before,
    .vvh3-reactor .vvh3m-head::before{
      content:"";position:absolute;left:0;right:0;top:0;height:3px;pointer-events:none;
      background:transparent;opacity:0;animation:none!important;
    }

    @keyframes vv-h3-reactor-line{
      0%{background-position:0% 50%}
      100%{background-position:250% 50%}
    }
    .vvh3-reactor[data-h3-runtime="active"] .vvh3-head::before,
    .vvh3-reactor[data-h3-runtime="active"] .vvh3-preview-head::before,
    .vvh3-reactor[data-h3-runtime="active"] .vvh3p-head::before,
    .vvh3-reactor[data-h3-runtime="active"] .vv-head::before,
    .vvh3-reactor[data-h3-runtime="active"] .vvh3m-head::before{
      opacity:1;
      background-image:linear-gradient(90deg,#32194f,#8446b6,#356fa8,#118f8b,#68d91b,#32194f,#8446b6,#356fa8,#118f8b,#68d91b,#32194f);
      background-size:250% 100%;
      animation:vv-h3-reactor-line 4.6s linear infinite!important;
      box-shadow:0 0 8px rgba(24,200,182,.28);
    }

    .vvh3-reactor[data-h3-runtime="active"]{
      border-color:rgba(24,200,182,.56)!important;
      box-shadow:0 0 0 1px rgba(132,70,182,.15),0 0 18px rgba(24,200,182,.15),0 10px 26px rgba(0,0,0,.30)!important;
    }

    /* Kill legacy idle motion without touching functionality. */
    .vvh3-reactor,.vvh3-reactor .vvh3m-head,.vvh3-reactor .vvh3m-button,
    .vvh3-reactor .vvh3-head,.vvh3-reactor .vv-head,.vvh3-reactor .vvh3p-head{
      animation:none!important;
    }
    .vvh3-reactor .vvh3m-button{background-position:0 50%!important}

    .vvh3-reactor[data-h3-runtime="error"]{border-color:rgba(208,123,137,.70)!important}
    .vvh3-reactor[data-h3-runtime="warning"]{border-color:rgba(210,170,112,.62)!important}

    @media (prefers-reduced-motion:reduce){
      .vvh3-reactor[data-h3-runtime="active"] .vvh3-head::before,
      .vvh3-reactor[data-h3-runtime="active"] .vvh3-preview-head::before,
      .vvh3-reactor[data-h3-runtime="active"] .vvh3p-head::before,
      .vvh3-reactor[data-h3-runtime="active"] .vv-head::before,
      .vvh3-reactor[data-h3-runtime="active"] .vvh3m-head::before{animation:none!important}
    }
  `;
  document.head.appendChild(style);
}

function deferredSync() { setTimeout(syncState, 0); }
function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  for (const name of ["execution_start", "executing", "progress", "executed", "execution_error", "execution_interrupted", "execution_success"]) {
    api.addEventListener(name, deferredSync);
  }
}

installCss();
installListeners();
ensureAnimationTimer();

app.registerExtension({
  name: "VelvetVice.MiniMaxH3.ReactorThemeTest",
  nodeCreated(node) {
    setTimeout(() => { if (isMainH3(node)) { applyIdle(node); syncState(); } }, 0);
  },
  loadedGraphNode(node) {
    setTimeout(() => { if (isMainH3(node)) { applyIdle(node); syncState(); } }, 0);
  },
  afterConfigureGraph() {
    setTimeout(syncState, 0);
    setTimeout(syncState, 300);
    setTimeout(syncState, 1200);
  },
});
