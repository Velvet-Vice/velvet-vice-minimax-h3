import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Static Midnight-Violet / Obsidian theme for the standalone MiniMax H3 workflow.
// No requestAnimationFrame, no setInterval, no hue cycling and no animated CSS.
// This layer is visual only: it never changes widget values, model routing,
// sampler settings, VAE/audio behavior or node sizes.

const STYLE_ID = "velvet-vice-h3-static-midnight-v140";
const EXTENSION_NAME = "VelvetVice.MiniMaxH3.StaticMidnightV140";

const PALETTE = Object.freeze({
  setup:   { title: "#4b216f", body: "#0b1722", box: "#7652a6" },
  source:  { title: "#233f68", body: "#0b1722", box: "#4779a8" },
  prompt:  { title: "#43236d", body: "#0b1722", box: "#7552a6" },
  model:   { title: "#3d2766", body: "#0b1722", box: "#6d55a2" },
  video:   { title: "#213f6f", body: "#0b1722", box: "#3d72aa" },
  preview: { title: "#164760", body: "#0b1722", box: "#2d7f96" },
  post:    { title: "#214b56", body: "#0b1722", box: "#3b7c83" },
  output:  { title: "#412568", body: "#0b1722", box: "#7655a3" },
  guide:   { title: "#283746", body: "#0d1720", box: "#4c6073" },
  internal:{ title: "#202b36", body: "#09121a", box: "#394958" },
});

const ACTIVE = Object.freeze({ title: "#234f77", box: "#28cfc6" });
const WARNING = Object.freeze({ title: "#72532e", box: "#d9a75d" });
const ERROR = Object.freeze({ title: "#703247", box: "#d5687d" });

let activeNode = null;
let h3Present = false;

function nodeType(node) {
  return String(node?.comfyClass ?? node?.type ?? "");
}
function titleOf(node) {
  return String(node?.title ?? "");
}
function isZenNode(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}
function isMainH3Node(node) {
  return Boolean(node) && !isZenNode(node) && (
    nodeType(node).startsWith("VelvetViceMiniMaxH3")
    || Boolean(node?.properties?.vv_design_system)
    || Boolean(node?.properties?.vv_design)
  );
}
function graphNodes() {
  return app.graph?._nodes ?? [];
}
function detectGraph() {
  h3Present = graphNodes().some((node) =>
    !isZenNode(node) && nodeType(node).startsWith("VelvetViceMiniMaxH3")
  );
  return h3Present;
}
function roleFor(node) {
  const type = nodeType(node);
  const title = titleOf(node).toUpperCase();

  if (node?.properties?.vv_h3_internal || title.startsWith("H3 INTERNAL")) return "internal";
  if (/NOTE|LABEL|BOOKMARK|REROUTE/.test(type.toUpperCase())
      || /GUIDE|REQUIREMENTS|DIAGNOSTICS|CONSTRAINTS|DEFAULTS/.test(title)) return "guide";
  if (/REFERENCE IMAGE|SOURCE FRAME/.test(title) || type === "LoadImage") return "source";
  if (/PROMPT/.test(type.toUpperCase()) || /PROMPT/.test(title) || type.includes("OllamaRelease")) return "prompt";
  if (type === "VelvetViceMiniMaxH3PowerLoraAV" || /LORA|TURBO|MODEL ROUTER|VAE ROUTER/.test(title)) return "model";
  if (type === "VelvetViceMiniMaxH3LivePreview" || /LIVE PREVIEW/.test(title)) return "preview";
  if (/MINIMAX H3 ENGINE/.test(title) || type === "VelvetViceMiniMaxH3AudioGate") return "video";
  if (type === "VelvetViceMiniMaxH3OutputHub" || type === "VelvetViceMiniMaxH3OutputStudio"
      || /OUTPUT STUDIO|OUTPUT \/ FINISHING HUB/.test(title)) return "output";
  if (/RIFE|GHOST|WATERMARK|ROUTER|CHECKPOINT|PRUNE|CLEANUP/.test(title)
      || ["RIFEInterpolation", "ComfySwitchNode", "VHS_PruneOutputs"].includes(type)) return "post";
  return "setup";
}
function baseFor(node) {
  return PALETTE[roleFor(node)] ?? PALETTE.setup;
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
function setShellState(node, state) {
  const shell = shellFor(node);
  if (!shell) return;
  shell.classList.add("vvh3-static-midnight");
  shell.dataset.h3StaticState = state;
  shell.dataset.h3Role = roleFor(node);
}
function paintNode(node, state = "idle") {
  if (!isMainH3Node(node) || !h3Present) return;
  const base = baseFor(node);

  let title = base.title;
  let box = base.box;
  if (state === "active-static") {
    title = ACTIVE.title;
    box = ACTIVE.box;
  } else if (state === "warning") {
    title = WARNING.title;
    box = WARNING.box;
  } else if (state === "error") {
    title = ERROR.title;
    box = ERROR.box;
  }

  // Do not touch size, widgets or connections.
  node.color = title;
  node.bgcolor = base.body;
  node.boxcolor = box;
  node.title_text_color = "#eef3fa";
  node.__vvH3StaticState = state;

  // Override the early design system's time-based active state before the
  // browser repaints. "active-static" still communicates activity but is not
  // recognized by its former animation timer/sweep.
  node.__vvExecutionState = state === "active-static" ? "active-static" : state;
  setShellState(node, state);
  node.setDirtyCanvas?.(true, true);
}
function topNodeId(detail) {
  const raw = detail == null
    ? ""
    : typeof detail === "object"
      ? String(detail.node ?? detail.node_id ?? detail.id ?? "")
      : String(detail);
  const top = raw.split(":")[0];
  return top || null;
}
function resolveTopNode(detail) {
  const id = topNodeId(detail);
  if (!id) return null;
  return app.graph?.getNodeById?.(Number(id))
    ?? graphNodes().find((node) => String(node?.id) === String(id))
    ?? null;
}
function resetActive(next = null) {
  if (activeNode && activeNode !== next) paintNode(activeNode, "idle");
  activeNode = next;
}
function markActive(detail) {
  if (!detectGraph()) return;
  const node = resolveTopNode(detail);
  if (!node || isZenNode(node)) return;

  resetActive(node);
  paintNode(node, "active-static");
}
function markDone(detail) {
  if (!detectGraph()) return;
  const node = resolveTopNode(detail);
  if (node) paintNode(node, "idle");
  if (activeNode === node) activeNode = null;
}
function resetAll() {
  if (!detectGraph()) return;
  activeNode = null;
  for (const node of graphNodes()) {
    if (isMainH3Node(node)) paintNode(node, "idle");
  }
}
function markError(detail) {
  if (!detectGraph()) return;
  const node = resolveTopNode(detail) ?? activeNode;
  if (node) paintNode(node, "error");
  activeNode = null;
}
function markInterrupted() {
  if (!detectGraph()) return;
  if (activeNode) paintNode(activeNode, "warning");
  activeNode = null;
}
function applyGroups() {
  if (!h3Present) return;
  const colors = {
    "00": "#241f31",
    "01": "#172739",
    "02": "#271d34",
    "03": "#172a3b",
    "04": "#251f31",
    "05": "#19302f",
    "06": "#222632",
    "07": "#171f29",
    "08": "#182b32",
  };
  for (const group of app.graph?._groups ?? []) {
    const key = String(group.title ?? "").slice(0, 2);
    group.color = colors[key] ?? "#1d2631";
    if (Number.isFinite(group.font_size)) {
      group.font_size = Math.max(17, Math.min(24, group.font_size));
    }
  }
}
function installCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root{
      --vvh3-bg:#08131f;
      --vvh3-bg2:#0d1b29;
      --vvh3-card:#0d1a28;
      --vvh3-card2:#122335;
      --vvh3-violet:#4b216f;
      --vvh3-violet2:#34245f;
      --vvh3-blue:#173d70;
      --vvh3-cyan:#28cfc6;
      --vvh3-border:#31597f;
      --vvh3-border-soft:rgba(61,98,144,.38);
      --vvh3-text:#eef3fa;
      --vvh3-muted:#93a7bd;
      --vvh3-ready:#62dca4;
    }

    /* Absolute static rule: no CSS animation in any H3 DOM surface. */
    .vvh3-shell,.vvh3-shell *, .vv-shell,.vv-shell *,
    .vv-h3-prompt-surface,.vv-h3-prompt-surface *,
    .vv-h3-final-prompt,.vv-h3-final-prompt *,
    .vv-h3-output-studio,.vv-h3-output-studio *,
    .vv-h3-power-lora,.vv-h3-power-lora *,
    .vvh3-monitor,.vvh3-monitor *,
    .vvh3-preview-shell,.vvh3-preview-shell *,
    .vvh3-themed-preview,.vvh3-themed-preview *{
      animation:none!important;
    }
    .vvh3-shell::before,.vvh3-shell::after,.vvh3-shell *::before,.vvh3-shell *::after,
    .vv-shell::before,.vv-shell::after,.vv-shell *::before,.vv-shell *::after{
      animation:none!important;
    }

    /* Shared Midnight-Violet / Obsidian body. No height rules here: resize
       remains owned by each node and the dedicated safe resize bridge. */
    .vvh3-shell,.vv-shell,.vv-h3-prompt-surface,.vv-h3-final-prompt,
    .vv-h3-output-studio,.vv-h3-power-lora,.vvh3-monitor,
    .vvh3-preview-shell,.vvh3-themed-preview{
      color:var(--vvh3-text)!important;
      background:linear-gradient(145deg,var(--vvh3-bg),var(--vvh3-bg2))!important;
      border:1px solid var(--vvh3-border-soft)!important;
      border-radius:11px!important;
      box-shadow:0 8px 22px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.025)!important;
    }

    /* Static title treatment matching the approved visual reference. */
    .vvh3-head,.vv-head,.vvh3-preview-head,.vvh3p-head,.vvh3m-head{
      position:relative!important;
      color:var(--vvh3-text)!important;
      background:linear-gradient(105deg,var(--vvh3-violet),var(--vvh3-violet2) 48%,var(--vvh3-blue))!important;
      background-size:100% 100%!important;
      background-position:0 0!important;
      border-bottom:1px solid rgba(72,111,170,.68)!important;
      box-shadow:inset 0 -1px 0 rgba(40,207,198,.22)!important;
    }
    .vvh3-head::after,.vv-head::after,.vvh3-preview-head::after,.vvh3p-head::after,.vvh3m-head::after{
      content:""!important;
      position:absolute!important;
      left:0!important;right:0!important;bottom:0!important;height:1px!important;
      background:linear-gradient(90deg,#7052a8,#3569a2,var(--vvh3-cyan),transparent)!important;
      transform:none!important;
      opacity:.82!important;
    }

    /* Static active state: cyan edge only, never a moving color. */
    [data-h3-static-state="active-static"]{
      border-color:rgba(40,207,198,.72)!important;
      box-shadow:0 0 0 1px rgba(40,207,198,.14),0 8px 22px rgba(0,0,0,.28)!important;
    }
    [data-h3-static-state="active-static"] .vvh3-head,
    [data-h3-static-state="active-static"] .vv-head,
    [data-h3-static-state="active-static"] .vvh3-preview-head,
    [data-h3-static-state="active-static"] .vvh3p-head,
    [data-h3-static-state="active-static"] .vvh3m-head{
      box-shadow:inset 0 -2px 0 rgba(40,207,198,.70)!important;
    }

    [data-h3-static-state="warning"]{border-color:rgba(217,167,93,.68)!important}
    [data-h3-static-state="error"]{border-color:rgba(213,104,125,.76)!important}

    /* Cards / grouped sections. */
    .vvh3-section,.vvh3p-section,.vv-panel,.vv-status,.vv-module-card,
    .vv-pass-card,.vvh3-preview-stage,.vv-player-shell,.vv-video-frame,
    .vvh3m-card,.vvh3m-status,.vvh3-details,.vvh3-resolution-panel,
    .vvh3-output-readout,.vvh3-ready,.vv-empty,.vv-advanced{
      background:linear-gradient(145deg,var(--vvh3-card),var(--vvh3-card2))!important;
      border-color:var(--vvh3-border-soft)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.018)!important;
    }

    .vvh3-section-title,.vvh3p-section-title,.vv-label,
    .vvh3-step-title,.vv-brand,.vvh3-title{
      color:#c6a9ef!important;
    }

    /* Inputs stay crisp and calm. */
    .vvh3-shell input,.vvh3-shell select,.vvh3-shell textarea,
    .vv-shell input,.vv-shell select,.vv-shell textarea,
    .vv-input,.vv-textarea,.vv-mini,.vvh3-profile-name{
      background:#07131f!important;
      color:var(--vvh3-text)!important;
      border-color:rgba(58,91,132,.68)!important;
      box-shadow:none!important;
    }
    .vvh3-shell input:focus,.vvh3-shell select:focus,.vvh3-shell textarea:focus,
    .vv-shell input:focus,.vv-shell select:focus,.vv-shell textarea:focus{
      border-color:#6c55a8!important;
      box-shadow:0 0 0 2px rgba(108,85,168,.14)!important;
    }

    /* Controls use violet only as a static functional accent. */
    .vv-segment.active,.vvh3-segment.active,.vv-button.vv-primary,
    .vv-switch.on,.vvh3-button.primary,.vv-run{
      background:linear-gradient(135deg,#5b3388,#334f7d)!important;
      border-color:rgba(137,101,190,.62)!important;
      box-shadow:none!important;
    }
    input[type="checkbox"],input[type="radio"]{accent-color:#7652a6!important}

    /* Ready/error information is semantic, not decorative animation. */
    .vv-dot.ok,.vvh3-decoder-dot,.vvh3-ready-dot{background:var(--vvh3-ready)!important}
    .vvh3-decoder-status.installed,.vv-ready,.vvh3-ready{
      border-color:rgba(98,220,164,.28)!important;
      background:#0a1b1a!important;
      color:#9ce9c6!important;
    }

    /* Remove animated/hover transforms that can feel like flicker. */
    .vv-button:hover,.vv-segment:hover,.vvh3-button:hover,.vvh3-segment:hover{
      transform:none!important;
    }
  `;
  document.head.appendChild(style);
}
function applyAll() {
  if (!detectGraph()) return;
  installCss();
  for (const node of graphNodes()) {
    if (isMainH3Node(node)) {
      const state = node === activeNode ? "active-static"
        : node.__vvH3StaticState === "error" ? "error"
        : node.__vvH3StaticState === "warning" ? "warning"
        : "idle";
      paintNode(node, state);
    }
  }
  applyGroups();
  app.graph?.setDirtyCanvas?.(true, true);
}
function installListeners() {
  api.addEventListener("execution_start", () => resetAll());
  api.addEventListener("executing", ({ detail }) => {
    if (detail?.node == null && detail == null) {
      if (activeNode) paintNode(activeNode, "idle");
      activeNode = null;
      return;
    }
    markActive(detail);
  });
  api.addEventListener("progress", ({ detail }) => markActive(detail));
  api.addEventListener("executed", ({ detail }) => markDone(detail));
  api.addEventListener("execution_error", ({ detail }) => markError(detail));
  api.addEventListener("execution_interrupted", () => markInterrupted());
  api.addEventListener("execution_success", () => resetAll());
}

installCss();
installListeners();

app.registerExtension({
  name: EXTENSION_NAME,
  nodeCreated(node) {
    setTimeout(() => {
      if (!detectGraph() || !isMainH3Node(node)) return;
      paintNode(node, "idle");
    }, 0);
  },
  loadedGraphNode(node) {
    setTimeout(() => {
      if (!detectGraph() || !isMainH3Node(node)) return;
      paintNode(node, "idle");
    }, 0);
  },
  afterConfigureGraph() {
    setTimeout(applyAll, 0);
    setTimeout(applyAll, 250);
  },
});
