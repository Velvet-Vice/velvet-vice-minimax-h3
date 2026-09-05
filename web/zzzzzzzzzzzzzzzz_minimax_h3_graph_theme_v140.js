import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STYLE_ID = "velvet-vice-h3-graph-theme-v141-active-only";
const H3_MARKERS = new Set([
  "VelvetViceMiniMaxH3SystemHub",
  "VelvetViceMiniMaxH3Director",
  "VelvetViceMiniMaxH3PromptDirector",
  "VelvetViceMiniMaxH3OutputHub",
  "VelvetViceMiniMaxH3Preflight",
  "VelvetViceMiniMaxH3RenderTimer",
]);

const RUNAWAY_HEIGHT_RECOVERY = Object.freeze({
  VelvetViceMiniMaxH3SystemHub: 850,
  VelvetViceMiniMaxH3Director: 690,
  VelvetViceMiniMaxH3PromptDirector: 780,
  VelvetViceMiniMaxH3OutputHub: 700,
  VelvetViceMiniMaxH3ProfileManager: 450,
  VelvetViceMiniMaxH3LivePreview: 620,
  VelvetViceMiniMaxH3PowerLoraAV: 650,
  VelvetViceMiniMaxH3OutputStudio: 700,
  VelvetViceMiniMaxH3Preflight: 405,
  VelvetViceMiniMaxH3RenderTimer: 285,
});

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

const RUNTIME = Object.freeze({
  warning: { title: "#7b6244", body: "#241e17", box: "#d2aa70" },
  error:   { title: "#7b4450", body: "#25181c", box: "#d07b89" },
});

let activeNode = null;
let h3Active = false;
let activeAnimationFrame = null;
let activeAnimationLastPaint = 0;
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

function topNodeId(detail) {
  const raw = detail == null ? "" : typeof detail === "object" ? String(detail.node ?? "") : String(detail);
  const top = raw.split(":")[0];
  return Number.isFinite(Number(top)) ? Number(top) : null;
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

function shellFor(node) {
  return node?.__vvh3Shell
    ?? node?.__vvH3PromptShell
    ?? node?.__vvH3FinalPromptShell
    ?? node?.__vvPowerLoraShell
    ?? node?.__vvOutputShell
    ?? node?.__vvWatermarkShell
    ?? node?.__vvH3MonitorShell
    ?? null;
}

function baseFor(node) { return BASE[roleFor(node)] ?? BASE.setup; }

function setShellState(node, state, role) {
  const shell = shellFor(node);
  if (!shell) return;
  shell.classList.add("vvh3-unified-modern");
  shell.dataset.h3Runtime = state;
  shell.dataset.h3Role = role;
  if (nodeType(node) === "VelvetViceMiniMaxH3WatermarkOverlay") shell.classList.add("vv-h3-watermark");
}

function recoverRunawayHeight(node) {
  const normalHeight = RUNAWAY_HEIGHT_RECOVERY[nodeType(node)];
  const currentHeight = Number(node?.size?.[1] ?? 0);
  if (!normalHeight || currentHeight < 2200 || node.__vvH3RunawayHeightRecovered) return;
  node.__vvH3RunawayHeightRecovered = true;
  const width = Math.max(320, Number(node?.size?.[0] ?? 0));
  node.setSize?.([width, normalHeight]);
  console.warn(`[VELVET VICE] Recovered runaway H3 node height: ${nodeType(node)} ${currentHeight}px -> ${normalHeight}px`);
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

function activePaletteAt(ms, internal = false) {
  const cycle = 6200;
  const p = (ms % cycle) / cycle;
  const stops = internal ? [
    [0.00, "#4b535a", "#66717a"],
    [0.44, "#475863", "#627985"],
    [0.70, "#536056", "#77866f"],
    [1.00, "#4b535a", "#66717a"],
  ] : [
    [0.00, "#32194f", "#54266f"],
    [0.20, "#8446b6", "#b45ce2"],
    [0.40, "#356fa8", "#429edb"],
    [0.60, "#118f8b", "#18c8b6"],
    [0.80, "#55a814", "#7dff24"],
    [1.00, "#32194f", "#54266f"],
  ];
  let left = stops[0], right = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (p >= stops[i][0] && p <= stops[i + 1][0]) {
      left = stops[i]; right = stops[i + 1]; break;
    }
  }
  const local = (p - left[0]) / Math.max(0.0001, right[0] - left[0]);
  return { title: mixHex(left[1], right[1], local), box: mixHex(left[2], right[2], local) };
}

function stopActiveAnimation() {
  if (activeAnimationFrame != null) cancelAnimationFrame(activeAnimationFrame);
  activeAnimationFrame = null;
  activeAnimationLastPaint = 0;
}

function startActiveAnimation() {
  if (activeAnimationFrame != null || !h3Active || reducedMotion || !activeNode) return;
  const tick = (now) => {
    if (!h3Active || !isH3Graph() || !activeNode || activeNode.__vvH3GraphRuntime !== "active") {
      stopActiveAnimation();
      return;
    }

    if (!activeAnimationLastPaint || now - activeAnimationLastPaint >= 100) {
      activeAnimationLastPaint = now;
      const item = activeNode;
      const role = roleFor(item);
      const base = baseFor(item);
      const pal = activePaletteAt(now * 1.08, role === "internal");
      item.color = mixHex(base.title, pal.title, 0.94);
      item.bgcolor = mixHex(base.body, pal.title, 0.12);
      item.boxcolor = mixHex(base.box, pal.box, 0.96);
      app.graph?.setDirtyCanvas?.(true, false);
    }
    activeAnimationFrame = requestAnimationFrame(tick);
  };
  activeAnimationFrame = requestAnimationFrame(tick);
}

function applyNodeState(node, state = "idle") {
  if (!node || !h3Active || isZenNode(node)) return;
  recoverRunawayHeight(node);
  const effectiveState = state === "done" ? "idle" : state;
  const role = roleFor(node);
  const base = baseFor(node);
  const runtime = RUNTIME[effectiveState] ?? null;

  node.__vvSuppressCanvasChromeV1115 = Boolean(shellFor(node));
  if (node?.flags?.allow_interaction !== false) node.resizable = true;
  node.title_text_color = "#e9edf3";
  try {
    if (globalThis.LiteGraph?.ROUND_SHAPE != null) node.shape = globalThis.LiteGraph.ROUND_SHAPE;
  } catch (_) {}

  node.color = runtime?.title ?? base.title;
  node.bgcolor = runtime?.body ?? base.body;
  node.boxcolor = runtime?.box ?? base.box;
  node.__vvH3GraphRuntime = effectiveState;
  setShellState(node, effectiveState, role);
  node.setDirtyCanvas?.(true, true);
}

function finishActiveNode(state = "done") {
  if (!activeNode) return;
  const node = activeNode;
  activeNode = null;
  stopActiveAnimation();
  applyNodeState(node, state);
}

function markActive(node) {
  if (!node || !h3Active || isZenNode(node)) return;

  // Subgraph execution can report the same outer H3 engine many times. Never
  // restart the palette when that exact node is already active.
  if (activeNode === node && node.__vvH3GraphRuntime === "active") return;

  if (activeNode && activeNode !== node) finishActiveNode("done");
  activeNode = node;
  applyNodeState(node, "active");
  startActiveAnimation();
}

function internalizeH3Watermark(node = null) {
  if (!h3Active) return;
  const wm = node ?? currentGraphNodes().find((item) => nodeType(item) === "VelvetViceMiniMaxH3WatermarkOverlay");
  if (!wm || nodeType(wm) !== "VelvetViceMiniMaxH3WatermarkOverlay") return;
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
  if (!h3Active) return;
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

function applyAll() {
  h3Active = isH3Graph();
  if (!h3Active) {
    stopActiveAnimation();
    return;
  }
  for (const node of currentGraphNodes()) {
    if (!isZenNode(node)) applyNodeState(node, node === activeNode ? "active" : "idle");
  }
  internalizeH3Watermark();
  applyGroups();
  app.graph?.setDirtyCanvas?.(true, true);
  if (activeNode) startActiveAnimation();
}

function resetRuntime() {
  stopActiveAnimation();
  activeNode = null;
  for (const node of currentGraphNodes()) applyNodeState(node, "idle");
  applyGroups();
}

function installCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .vvh3-themed-shell,.vvh3-themed-preview,.vv-h3-prompt-surface,.vv-h3-final-prompt,.vv-h3-output-studio,.vv-h3-power-lora,.vv-h3-watermark{
      --h3-dark:#32194f;--h3-lilac:#8446b6;--h3-blue:#356fa8;--h3-turq:#118f8b;--h3-poison:#68d91b;
      --h3-a:#8446b6;--h3-b:#356fa8;--h3-fel:#68d91b;--h3-soft:rgba(104,158,199,.34);--h3-glow:rgba(75,139,190,.17);
      transition:border-color .20s ease,box-shadow .20s ease,background .20s ease;
      animation:none!important;
    }
    [data-h3-role="prompt"]{--h3-a:#8446b6;--h3-b:#356fa8;--h3-soft:rgba(114,145,188,.31);--h3-glow:rgba(89,151,178,.15)}
    [data-h3-role="video"],[data-h3-role="preview"]{--h3-a:#8446b6;--h3-b:#356fa8;--h3-soft:rgba(116,119,191,.31);--h3-glow:rgba(82,139,180,.17)}
    [data-h3-role="post"]{--h3-a:#356fa8;--h3-b:#118f8b;--h3-soft:rgba(91,146,159,.28);--h3-glow:rgba(79,151,147,.14)}
    [data-h3-role="output"]{--h3-a:#8446b6;--h3-b:#356fa8;--h3-soft:rgba(174,134,199,.31);--h3-glow:rgba(122,109,181,.16)}
    [data-h3-runtime="warning"]{--h3-a:#b18457;--h3-b:#8c705d;--h3-soft:rgba(213,159,101,.34);--h3-glow:rgba(195,133,75,.18)}
    [data-h3-runtime="error"]{--h3-a:#b65f73;--h3-b:#81586c;--h3-soft:rgba(215,100,122,.38);--h3-glow:rgba(190,77,101,.20)}

    @keyframes vv-h3-active-frame{
      0%,100%{border-color:rgba(50,25,79,.78);box-shadow:0 0 18px rgba(74,36,105,.20)}
      20%{border-color:rgba(132,70,182,.70);box-shadow:0 0 20px rgba(132,70,182,.20)}
      40%{border-color:rgba(53,111,168,.70);box-shadow:0 0 20px rgba(53,111,168,.20)}
      60%{border-color:rgba(17,143,139,.74);box-shadow:0 0 22px rgba(17,143,139,.21)}
      80%{border-color:rgba(104,217,27,.80);box-shadow:0 0 24px rgba(104,217,27,.22)}
    }
    @keyframes vv-h3-active-head{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}

    [data-h3-runtime="active"].vvh3-themed-shell,
    [data-h3-runtime="active"].vvh3-themed-preview,
    [data-h3-runtime="active"].vv-h3-prompt-surface,
    [data-h3-runtime="active"].vv-h3-final-prompt,
    [data-h3-runtime="active"].vv-h3-output-studio,
    [data-h3-runtime="active"].vv-h3-power-lora{
      animation:vv-h3-active-frame 4.8s ease-in-out infinite!important;
    }

    .vvh3-themed-shell .vvh3-head,.vvh3-themed-preview .vvh3-preview-head,.vv-h3-prompt-surface .vvh3p-head,.vv-h3-output-studio .vv-head,.vv-h3-power-lora .vv-head,.vv-h3-final-prompt .vv-head,
    .vvh3-unified-modern .vvh3-head,.vvh3-unified-modern .vvh3-preview-head,.vvh3-unified-modern .vvh3p-head,.vvh3-unified-modern .vv-head,.vvh3-unified-modern .vvh3m-head{
      background-image:linear-gradient(105deg,var(--h3-a),var(--h3-b))!important;
      background-size:100% 100%!important;
      background-position:50% 50%!important;
      animation:none!important;
    }

    [data-h3-runtime="active"] .vvh3-head,[data-h3-runtime="active"] .vvh3-preview-head,[data-h3-runtime="active"] .vvh3p-head,[data-h3-runtime="active"] .vv-head,[data-h3-runtime="active"] .vvh3m-head{
      background-image:linear-gradient(105deg,#32194f,#8446b6,#356fa8,#118f8b,#68d91b,#32194f)!important;
      background-size:320% 100%!important;
      animation:vv-h3-active-head 5.2s ease-in-out infinite!important;
    }

    .vvh3-themed-shell{border:1px solid var(--h3-soft)!important;box-shadow:0 0 18px var(--h3-glow)}
    .vvh3-themed-shell .vvh3-head{border-bottom:1px solid var(--h3-soft)!important;position:relative}
    .vvh3-themed-shell .vvh3-title,.vvh3-themed-shell .vvh3-section-title{color:color-mix(in srgb,var(--h3-a) 60%,#dce6ee)!important}
    .vvh3-themed-shell .vvh3-section{border-color:color-mix(in srgb,var(--h3-soft) 70%,transparent)!important}
    .vvh3-themed-preview{border:1px solid var(--h3-soft)!important;background:linear-gradient(145deg,#111b25,#172531)!important;box-shadow:0 0 20px var(--h3-glow)!important}
    .vv-h3-prompt-surface,.vv-h3-output-studio,.vv-h3-power-lora,.vv-h3-final-prompt{border-color:var(--h3-soft)!important;box-shadow:0 0 19px var(--h3-glow)!important}
    .vv-h3-output-studio .vv-progress{background:linear-gradient(90deg,#32194f,#8446b6,#356fa8,#118f8b,#68d91b)!important}
    .vv-h3-output-studio[data-h3-runtime="active"] .vv-progress{background-size:220% 100%!important;animation:vv-h3-active-head 4.6s ease-in-out infinite!important}

    [data-h3-role="internal"]{--h3-a:#56616b;--h3-b:#4c5b65;--h3-fel:#718068;--h3-soft:rgba(106,119,129,.20);--h3-glow:rgba(67,82,91,.08)}

    .vvh3-unified-modern{
      color:#e8eef4!important;
      background:linear-gradient(145deg,#101923,#16232d)!important;
      border:1px solid rgba(52,188,169,.50)!important;
      border-radius:12px!important;
      overflow:hidden!important;
      box-shadow:0 0 0 1px rgba(59,159,209,.10),0 0 24px rgba(21,188,150,.13),0 12px 30px rgba(0,0,0,.35)!important;
    }
    .vvh3-unified-modern .vvh3-section,.vvh3-unified-modern .vvh3p-section,.vvh3-unified-modern .vv-status,.vvh3-unified-modern .vv-module-card,.vvh3-unified-modern .vv-pass-card,.vvh3-unified-modern .vvh3-preview-stage,.vvh3-unified-modern .vv-video-frame,.vvh3-unified-modern .vvh3m-card,.vvh3-unified-modern .vvh3m-status{
      background:linear-gradient(145deg,#111c26,#152330)!important;
      border-color:rgba(74,156,178,.27)!important;
      border-radius:9px!important;
    }
    .vvh3-unified-modern input,.vvh3-unified-modern select,.vvh3-unified-modern textarea{
      background:#0e1821!important;color:#e8eef4!important;border-color:rgba(71,159,181,.30)!important;border-radius:8px!important;
    }
    .vvh3-unified-modern .vvh3-status,.vvh3-unified-modern .vvh3-summary,.vvh3-unified-modern .vv-status-detail,.vvh3-unified-modern .vv-foot{
      background-color:rgba(11,23,31,.72)!important;border-color:rgba(42,169,159,.24)!important;
    }

    @media (prefers-reduced-motion:reduce){
      [data-h3-runtime="active"].vvh3-themed-shell,[data-h3-runtime="active"].vvh3-themed-preview,[data-h3-runtime="active"].vv-h3-prompt-surface,[data-h3-runtime="active"].vv-h3-final-prompt,[data-h3-runtime="active"].vv-h3-output-studio,[data-h3-runtime="active"].vv-h3-power-lora,
      [data-h3-runtime="active"] .vvh3-head,[data-h3-runtime="active"] .vvh3-preview-head,[data-h3-runtime="active"] .vvh3p-head,[data-h3-runtime="active"] .vv-head,[data-h3-runtime="active"] .vvh3m-head{animation:none!important}
    }
  `;
  document.head.appendChild(style);
}

function installListeners() {
  api.addEventListener("execution_start", () => {
    if (!isH3Graph()) return;
    h3Active = true;
    resetRuntime();
  });

  api.addEventListener("executing", ({ detail }) => {
    if (!isH3Graph()) return;
    h3Active = true;
    const id = topNodeId(detail);
    if (id == null) {
      finishActiveNode("done");
      return;
    }
    const node = app.graph?.getNodeById?.(id);
    if (node) markActive(node);
  });

  api.addEventListener("execution_error", () => finishActiveNode("error"));
  api.addEventListener("execution_interrupted", () => finishActiveNode("warning"));
  api.addEventListener("execution_success", () => finishActiveNode("done"));
}

installCss();
installListeners();

app.registerExtension({
  name: "VelvetVice.MiniMaxH3.GraphThemeV141ActiveOnly",
  nodeCreated(node) {
    setTimeout(() => {
      if (!isH3Graph()) return;
      h3Active = true;
      applyNodeState(node, "idle");
      internalizeH3Watermark(node);
      applyGroups();
    }, 0);
  },
  loadedGraphNode(node) {
    setTimeout(() => {
      if (!isH3Graph()) return;
      h3Active = true;
      applyNodeState(node, "idle");
      internalizeH3Watermark(node);
      applyGroups();
    }, 0);
  },
  afterConfigureGraph() {
    setTimeout(applyAll, 0);
    setTimeout(applyAll, 250);
    setTimeout(applyAll, 1200);
  },
});
