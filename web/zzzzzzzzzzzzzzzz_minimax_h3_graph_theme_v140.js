import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// MiniMax H3 visual runtime aligned with the proven Velvet Vice KREA model:
// one execution-state owner, static idle nodes, and a color sweep only on the
// node that is actually active. This file never changes execution state.

const STYLE_ID = "velvet-vice-h3-krea-style-runtime-v142-test";
const H3_MARKERS = new Set([
  "VelvetViceMiniMaxH3SystemHub",
  "VelvetViceMiniMaxH3Director",
  "VelvetViceMiniMaxH3PromptDirector",
  "VelvetViceMiniMaxH3OutputHub",
  "VelvetViceMiniMaxH3Preflight",
  "VelvetViceMiniMaxH3RenderTimer",
]);

const BASE = Object.freeze({
  setup:    { title: "#605276", body: "#10212b", box: "#9b86b1" },
  source:   { title: "#526a82", body: "#10212b", box: "#7897b2" },
  prompt:   { title: "#5b718a", body: "#10212b", box: "#7fa0bd" },
  model:    { title: "#69557d", body: "#10212b", box: "#a087b2" },
  video:    { title: "#4f6b88", body: "#10212b", box: "#7894c7" },
  preview:  { title: "#587a94", body: "#10212b", box: "#78a9c0" },
  post:     { title: "#50727a", body: "#10212b", box: "#79a9aa" },
  output:   { title: "#6d587f", body: "#10212b", box: "#aa8abc" },
  guide:    { title: "#444d58", body: "#111b24", box: "#6c7782" },
  internal: { title: "#39434d", body: "#0d171f", box: "#555f69" },
});

const ACTIVE_STOPS = Object.freeze([
  [0.00, "#32194f", "#54266f"], // dark violet
  [0.20, "#8446b6", "#b45ce2"], // lilac
  [0.40, "#356fa8", "#429edb"], // blue
  [0.60, "#118f8b", "#18c8b6"], // turquoise
  [0.80, "#55a814", "#7dff24"], // poison green
  [1.00, "#32194f", "#54266f"],
]);

const ERROR = Object.freeze({ title: "#7b4450", body: "#25181c", box: "#d07b89" });
const WARNING = Object.freeze({ title: "#7b6244", body: "#241e17", box: "#d2aa70" });

let visualActiveNode = null;
let animationFrame = null;
let lastPaint = 0;
let listenersInstalled = false;
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function nodeType(node) { return String(node?.comfyClass ?? node?.type ?? ""); }
function titleOf(node) { return String(node?.title ?? ""); }
function currentGraphNodes() { return app.graph?._nodes ?? []; }

function isZenNode(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function isH3Graph() {
  return currentGraphNodes().some((node) =>
    !isZenNode(node)
    && (H3_MARKERS.has(nodeType(node)) || nodeType(node).startsWith("VelvetViceMiniMaxH3"))
  );
}

function roleFor(node) {
  const type = nodeType(node);
  const title = titleOf(node).toUpperCase();
  if (node?.properties?.vv_h3_internal || title.startsWith("H3 INTERNAL")) return "internal";
  if (/NOTE|LABEL|BOOKMARK/.test(type.toUpperCase()) || /GUIDE|REQUIREMENTS|DIAGNOSTICS|CONSTRAINTS|DEFAULTS/.test(title)) return "guide";
  if (/REFERENCE IMAGE|SOURCE FRAME/.test(title) || type === "LoadImage") return "source";
  if (/PROMPT/.test(type.toUpperCase()) || /PROMPT/.test(title) || type.includes("OllamaRelease")) return "prompt";
  if (type === "VelvetViceMiniMaxH3PowerLoraAV" || /LORA|TURBO|MODEL ROUTER|VAE ROUTER/.test(title)) return "model";
  if (type === "VelvetViceMiniMaxH3LivePreview" || /LIVE PREVIEW/.test(title)) return "preview";
  if (/MINIMAX H3 ENGINE/.test(title) || type === "VelvetViceMiniMaxH3AudioGate") return "video";
  if (type === "VelvetViceMiniMaxH3OutputHub" || type === "VelvetViceMiniMaxH3OutputStudio" || /OUTPUT STUDIO|OUTPUT \/ FINISHING HUB/.test(title)) return "output";
  if (/RIFE|GHOST|WATERMARK|ROUTER|CHECKPOINT|PRUNE|CLEANUP/.test(title) || ["RIFEInterpolation", "ComfySwitchNode", "VHS_PruneOutputs"].includes(type)) return "post";
  return "setup";
}

function baseFor(node) { return BASE[roleFor(node)] ?? BASE.setup; }

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
  return String(node?.__vvExecutionState ?? "idle").toLowerCase();
}

function setShellState(node, state = stateFor(node)) {
  const shell = shellFor(node);
  if (!shell) return;
  shell.classList.add("vvh3-unified-modern");
  shell.dataset.h3Runtime = state;
  shell.dataset.h3Role = roleFor(node);
}

function hexRgb(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((x) => x + x).join("") : clean.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function mixHex(a, b, t) {
  const aa = hexRgb(a), bb = hexRgb(b), q = Math.max(0, Math.min(1, Number(t) || 0));
  const out = aa.map((v, i) => Math.round(v + (bb[i] - v) * q));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function activePaletteAt(ms) {
  const p = (ms % 5200) / 5200;
  let left = ACTIVE_STOPS[0];
  let right = ACTIVE_STOPS[ACTIVE_STOPS.length - 1];
  for (let i = 0; i < ACTIVE_STOPS.length - 1; i += 1) {
    if (p >= ACTIVE_STOPS[i][0] && p <= ACTIVE_STOPS[i + 1][0]) {
      left = ACTIVE_STOPS[i]; right = ACTIVE_STOPS[i + 1]; break;
    }
  }
  const local = (p - left[0]) / Math.max(0.0001, right[0] - left[0]);
  return { title: mixHex(left[1], right[1], local), box: mixHex(left[2], right[2], local) };
}

function restoreStatic(node, state = stateFor(node)) {
  if (!node || isZenNode(node)) return;
  const base = baseFor(node);
  const special = state === "error" ? ERROR : state === "warning" ? WARNING : null;
  node.color = special?.title ?? base.title;
  node.bgcolor = special?.body ?? base.body;
  node.boxcolor = special?.box ?? base.box;
  setShellState(node, state);
  node.setDirtyCanvas?.(true, true);
}

function stopAnimation() {
  if (animationFrame != null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  lastPaint = 0;
}

function runActiveAnimation() {
  if (animationFrame != null || reducedMotion || !visualActiveNode) return;
  const tick = (now) => {
    const node = visualActiveNode;
    if (!node || !isH3Graph() || stateFor(node) !== "active") {
      if (node) restoreStatic(node, stateFor(node));
      visualActiveNode = null;
      stopAnimation();
      return;
    }

    // KREA principle: repaint only the active node. The body remains static;
    // node.color / boxcolor feed only the H3 canvas header and active border.
    if (!lastPaint || now - lastPaint >= 80) {
      lastPaint = now;
      const pal = activePaletteAt(now);
      node.color = pal.title;
      node.boxcolor = pal.box;
      node.bgcolor = baseFor(node).body;
      setShellState(node, "active");
      node.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, false);
    }
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function syncRuntime() {
  if (!isH3Graph()) {
    if (visualActiveNode) restoreStatic(visualActiveNode, stateFor(visualActiveNode));
    visualActiveNode = null;
    stopAnimation();
    return;
  }

  let nextActive = null;
  for (const node of currentGraphNodes()) {
    if (isZenNode(node)) continue;
    const state = stateFor(node);
    setShellState(node, state);
    if (state === "active" && !nextActive) nextActive = node;
    else if (node !== visualActiveNode) restoreStatic(node, state);
  }

  if (visualActiveNode && visualActiveNode !== nextActive) {
    restoreStatic(visualActiveNode, stateFor(visualActiveNode));
  }

  visualActiveNode = nextActive;
  if (visualActiveNode) runActiveAnimation();
  else stopAnimation();
}

function internalizeH3Watermark() {
  const wm = currentGraphNodes().find((item) => nodeType(item) === "VelvetViceMiniMaxH3WatermarkOverlay");
  if (!wm) return;
  wm.title = "H3 INTERNAL · WATERMARK APPLY";
  wm.flags ??= {};
  wm.flags.collapsed = true;
  wm.properties ??= {};
  wm.properties.vv_h3_internal = true;
  wm.__vvSuppressCanvasChromeV1115 = true;
  const dom = wm.widgets?.find((item) => item?.name === "vv_watermark_surface_v100");
  if (dom) {
    dom.hidden = true;
    dom.computeSize = () => [0, -4];
    dom.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0, maxWidth: 0 });
  }
  const shell = wm.__vvWatermarkShell;
  if (shell) shell.style.display = "none";
  wm.setSize?.([540, 60]);
}

function applyGroups() {
  if (!isH3Graph()) return;
  const colors = {
    "00": "#2b2734", "01": "#23303a", "02": "#30283a", "03": "#26333e",
    "04": "#2d2835", "05": "#29332e", "06": "#2b2d35", "07": "#222a32", "08": "#263136",
  };
  for (const group of app.graph?._groups ?? []) {
    const key = String(group.title ?? "").slice(0, 2);
    group.color = colors[key] ?? "#2a2c39";
    if (Number.isFinite(group.font_size)) group.font_size = Math.max(17, Math.min(24, group.font_size));
  }
}

function installCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .vvh3-themed-shell,.vvh3-themed-preview,.vv-h3-prompt-surface,.vv-h3-final-prompt,.vv-h3-output-studio,.vv-h3-power-lora,.vv-h3-watermark,.vvh3-monitor{
      --h3-dark:#32194f;--h3-lilac:#8446b6;--h3-blue:#356fa8;--h3-turq:#118f8b;--h3-poison:#68d91b;
      --h3-a:#605276;--h3-b:#526a82;--h3-soft:rgba(104,158,199,.28);--h3-glow:rgba(75,139,190,.13);
      animation:none!important;
      transition:border-color .16s ease,box-shadow .16s ease;
    }
    [data-h3-role="prompt"]{--h3-a:#5b718a;--h3-b:#7fa0bd}
    [data-h3-role="model"]{--h3-a:#69557d;--h3-b:#a087b2}
    [data-h3-role="video"]{--h3-a:#4f6b88;--h3-b:#7894c7}
    [data-h3-role="preview"]{--h3-a:#587a94;--h3-b:#78a9c0}
    [data-h3-role="post"]{--h3-a:#50727a;--h3-b:#79a9aa}
    [data-h3-role="output"]{--h3-a:#6d587f;--h3-b:#aa8abc}
    [data-h3-role="guide"]{--h3-a:#444d58;--h3-b:#6c7782}
    [data-h3-role="internal"]{--h3-a:#39434d;--h3-b:#555f69}

    /* Idle = KREA principle: strong but completely static header. */
    .vvh3-themed-shell .vvh3-head,
    .vvh3-themed-preview .vvh3-preview-head,
    .vv-h3-prompt-surface .vvh3p-head,
    .vv-h3-output-studio .vv-head,
    .vv-h3-power-lora .vv-head,
    .vv-h3-final-prompt .vv-head,
    .vvh3-monitor .vvh3m-head,
    .vvh3-unified-modern .vvh3-head,
    .vvh3-unified-modern .vvh3-preview-head,
    .vvh3-unified-modern .vvh3p-head,
    .vvh3-unified-modern .vv-head,
    .vvh3-unified-modern .vvh3m-head{
      background:linear-gradient(112deg,var(--h3-a),var(--h3-b),#121c25)!important;
      background-size:100% 100%!important;
      background-position:0 50%!important;
      animation:none!important;
    }

    /* Active = only this header receives the Velvet Vice sweep. */
    @keyframes vv-h3-krea-sweep{0%{background-position:0% 50%}100%{background-position:250% 50%}}
    [data-h3-runtime="active"] .vvh3-head,
    [data-h3-runtime="active"] .vvh3-preview-head,
    [data-h3-runtime="active"] .vvh3p-head,
    [data-h3-runtime="active"] .vv-head,
    [data-h3-runtime="active"] .vvh3m-head{
      background-image:linear-gradient(90deg,#32194f,#8446b6,#356fa8,#118f8b,#68d91b,#32194f,#8446b6,#356fa8,#118f8b,#68d91b,#32194f)!important;
      background-size:250% 100%!important;
      animation:vv-h3-krea-sweep 4.6s linear infinite!important;
    }

    /* No permanent monitor/director/button animations while idle. */
    .vvh3-monitor,.vvh3m-head,.vvh3m-button,
    .vvh3-director-shell,.vvh3-director-shell .vvh3-head::after,
    .vv-h3-output-studio,.vv-h3-power-lora,.vv-h3-final-prompt{
      animation:none!important;
    }
    [data-h3-runtime="active"].vvh3-unified-modern,
    [data-h3-runtime="active"].vvh3-themed-shell,
    [data-h3-runtime="active"].vvh3-themed-preview,
    [data-h3-runtime="active"].vv-h3-output-studio,
    [data-h3-runtime="active"].vv-h3-power-lora,
    [data-h3-runtime="active"].vv-h3-prompt-surface,
    [data-h3-runtime="active"].vvh3-monitor{
      border-color:rgba(24,200,182,.62)!important;
      box-shadow:0 0 0 1px rgba(132,70,182,.16),0 0 18px rgba(24,200,182,.18),0 10px 26px rgba(0,0,0,.30)!important;
    }

    .vvh3-unified-modern{
      color:#e8eef4!important;
      background:linear-gradient(145deg,#101923,#16232d)!important;
      border:1px solid rgba(52,188,169,.40)!important;
      border-radius:12px!important;
      overflow:hidden!important;
      box-shadow:0 10px 28px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.025)!important;
    }
    .vvh3-unified-modern .vvh3-section,.vvh3-unified-modern .vvh3p-section,.vvh3-unified-modern .vv-status,.vvh3-unified-modern .vv-module-card,.vvh3-unified-modern .vv-pass-card,.vvh3-unified-modern .vvh3-preview-stage,.vvh3-unified-modern .vv-video-frame,.vvh3-unified-modern .vvh3m-card,.vvh3-unified-modern .vvh3m-status{
      background:linear-gradient(145deg,#111c26,#152330)!important;
      border-color:rgba(74,156,178,.22)!important;
      border-radius:9px!important;
    }
    .vvh3-unified-modern input,.vvh3-unified-modern select,.vvh3-unified-modern textarea{
      background:#0e1821!important;color:#e8eef4!important;border-color:rgba(71,159,181,.30)!important;border-radius:8px!important;
    }

    [data-h3-runtime="warning"]{border-color:rgba(210,170,112,.55)!important}
    [data-h3-runtime="error"]{border-color:rgba(208,123,137,.68)!important;box-shadow:0 0 16px rgba(208,123,137,.15)!important}

    @media (prefers-reduced-motion:reduce){
      [data-h3-runtime="active"] .vvh3-head,[data-h3-runtime="active"] .vvh3-preview-head,[data-h3-runtime="active"] .vvh3p-head,[data-h3-runtime="active"] .vv-head,[data-h3-runtime="active"] .vvh3m-head{animation:none!important}
    }
  `;
  document.head.appendChild(style);
}

function installRuntimeSync() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  const deferredSync = () => setTimeout(syncRuntime, 0);

  // These listeners never assign execution state; the earlier H3 design system
  // owns that state exactly like KREA. We only repaint after it has updated.
  api.addEventListener("execution_start", deferredSync);
  api.addEventListener("executing", deferredSync);
  api.addEventListener("progress", deferredSync);
  api.addEventListener("executed", deferredSync);
  api.addEventListener("execution_error", deferredSync);
  api.addEventListener("execution_interrupted", deferredSync);
  api.addEventListener("execution_success", deferredSync);
}

function applyAll() {
  if (!isH3Graph()) return;
  for (const node of currentGraphNodes()) {
    if (isZenNode(node)) continue;
    restoreStatic(node, stateFor(node));
  }
  internalizeH3Watermark();
  applyGroups();
  syncRuntime();
  app.graph?.setDirtyCanvas?.(true, true);
}

installCss();
installRuntimeSync();

app.registerExtension({
  name: "VelvetVice.MiniMaxH3.KreaStyleRuntimeV142Test",
  nodeCreated(node) {
    setTimeout(() => { if (isH3Graph() && !isZenNode(node)) { restoreStatic(node, stateFor(node)); syncRuntime(); } }, 0);
  },
  loadedGraphNode(node) {
    setTimeout(() => { if (isH3Graph() && !isZenNode(node)) { restoreStatic(node, stateFor(node)); syncRuntime(); } }, 0);
  },
  afterConfigureGraph() {
    setTimeout(applyAll, 0);
    setTimeout(applyAll, 250);
    setTimeout(applyAll, 1200);
  },
});
