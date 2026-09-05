import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Static Midnight-Violet / Obsidian theme for Velvet Vice MiniMax H3.
// No requestAnimationFrame, no interval, no animated gradients.
const STYLE_ID = "velvet-vice-h3-static-midnight-ui-audit-v140";
const ACTIVE = { title: "#234f77", body: "#0b1722", box: "#28cfc6" };
const WARNING = { title: "#72532e", body: "#17130e", box: "#d9a75d" };
const ERROR = { title: "#703247", body: "#190f14", box: "#d5687d" };
const PALETTE = Object.freeze({
  setup: { title: "#4b216f", body: "#0b1722", box: "#7652a6" },
  source: { title: "#233f68", body: "#0b1722", box: "#4779a8" },
  prompt: { title: "#43236d", body: "#0b1722", box: "#7552a6" },
  model: { title: "#3d2766", body: "#0b1722", box: "#6d55a2" },
  video: { title: "#213f6f", body: "#0b1722", box: "#3d72aa" },
  preview: { title: "#164760", body: "#0b1722", box: "#2d7f96" },
  post: { title: "#214b56", body: "#0b1722", box: "#3b7c83" },
  output: { title: "#412568", body: "#0b1722", box: "#7655a3" },
  guide: { title: "#283746", body: "#0d1720", box: "#4c6073" },
  internal: { title: "#202b36", body: "#09121a", box: "#394958" },
});

let activeNode = null;
let listenersInstalled = false;

function nodeType(node) { return String(node?.comfyClass ?? node?.type ?? ""); }
function titleOf(node) { return String(node?.title ?? ""); }
function nodes() { return app.graph?._nodes ?? []; }
function isZen(node) {
  const p = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3") || p.vv_zen_h3_scope === true || String(p.vv_closed_system ?? "").startsWith("ZEN_H3");
}
function isH3(node) {
  return node && !isZen(node) && (nodeType(node).startsWith("VelvetViceMiniMaxH3") || Boolean(node?.properties?.vv_design_system) || Boolean(node?.properties?.vv_design));
}
function role(node) {
  const type = nodeType(node); const title = titleOf(node).toUpperCase();
  if (node?.properties?.vv_h3_internal || title.startsWith("H3 INTERNAL")) return "internal";
  if (/NOTE|LABEL|BOOKMARK|REROUTE/.test(type.toUpperCase()) || /GUIDE|REQUIREMENTS|DIAGNOSTICS|CONSTRAINTS|DEFAULTS/.test(title)) return "guide";
  if (/REFERENCE IMAGE|SOURCE FRAME/.test(title) || type === "LoadImage") return "source";
  if (/PROMPT/.test(type.toUpperCase()) || /PROMPT/.test(title) || type.includes("OllamaRelease")) return "prompt";
  if (/LORA|TURBO|MODEL ROUTER|VAE ROUTER/.test(title) || type === "VelvetViceMiniMaxH3PowerLoraAV") return "model";
  if (/LIVE PREVIEW/.test(title) || type === "VelvetViceMiniMaxH3LivePreview") return "preview";
  if (/MINIMAX H3 ENGINE/.test(title) || type === "VelvetViceMiniMaxH3AudioGate") return "video";
  if (/OUTPUT STUDIO|OUTPUT \/ FINISHING HUB/.test(title) || ["VelvetViceMiniMaxH3OutputHub","VelvetViceMiniMaxH3OutputStudio"].includes(type)) return "output";
  if (/RIFE|GHOST|WATERMARK|ROUTER|CHECKPOINT|PRUNE|CLEANUP/.test(title)) return "post";
  return "setup";
}
function shell(node) {
  return node?.__vvh3Shell ?? node?.__vvH3PromptShell ?? node?.__vvH3FinalPromptShell ?? node?.__vvPowerLoraShell ?? node?.__vvOutputShell ?? node?.__vvWatermarkShell ?? node?.__vvH3MonitorShell ?? node?.__vvh3PreviewDisplay?.shell ?? null;
}
function statePalette(node, state) {
  if (state === "active") return ACTIVE;
  if (state === "warning") return WARNING;
  if (state === "error") return ERROR;
  return PALETTE[role(node)] ?? PALETTE.setup;
}
function paint(node, state = "idle") {
  if (!isH3(node)) return;
  const p = statePalette(node, state);
  node.color = p.title; node.bgcolor = p.body; node.boxcolor = p.box;
  const s = shell(node);
  if (s) {
    s.classList.add("vvh3-static-midnight");
    s.dataset.h3StaticState = state;
    s.dataset.h3Role = role(node);
  }
  node.setDirtyCanvas?.(true, true);
}
function topNodeId(detail) {
  const raw = detail?.node ?? detail?.node_id ?? detail;
  if (raw == null) return null;
  const id = Number(String(raw).split(":")[0]);
  return Number.isFinite(id) ? id : null;
}
function reset() {
  for (const n of nodes()) if (isH3(n)) paint(n, "idle");
  activeNode = null;
}

function installCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .vvh3-static-midnight,.vvh3-static-midnight *{box-sizing:border-box}
    .vvh3-static-midnight,.vvh3-themed-shell,.vvh3-themed-preview,.vv-h3-prompt-surface,.vv-h3-final-prompt,.vv-h3-output-studio,.vv-h3-power-lora,.vv-h3-watermark,.vvh3-monitor{animation:none!important}
    .vvh3-static-midnight{color:#eef3fa!important;background:linear-gradient(145deg,#09131d,#0e1c29)!important;border:1px solid rgba(74,104,165,.48)!important;border-radius:12px!important;box-shadow:0 10px 26px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.025)!important}
    .vvh3-static-midnight .vvh3-head,.vvh3-static-midnight .vvh3-preview-head,.vvh3-static-midnight .vvh3p-head,.vvh3-static-midnight .vv-head,.vvh3-static-midnight .vvh3m-head{animation:none!important;background:linear-gradient(105deg,#4b216f 0%,#31265f 46%,#183d68 100%)!important;background-size:100% 100%!important;border-bottom:1px solid rgba(64,177,194,.34)!important;color:#f3effa!important;box-shadow:inset 0 -2px 0 rgba(33,191,190,.28)!important}
    .vvh3-static-midnight[data-h3-static-state="active"]{border-color:rgba(40,207,198,.72)!important;box-shadow:0 0 0 1px rgba(40,207,198,.12),0 10px 26px rgba(0,0,0,.30)!important}
    .vvh3-static-midnight[data-h3-static-state="warning"]{border-color:rgba(217,167,93,.62)!important}
    .vvh3-static-midnight[data-h3-static-state="error"]{border-color:rgba(213,104,125,.72)!important}
    .vvh3-static-midnight .vvh3-section,.vvh3-static-midnight .vvh3p-section,.vvh3-static-midnight .vv-status,.vvh3-static-midnight .vv-module-card,.vvh3-static-midnight .vv-pass-card,.vvh3-static-midnight .vvh3-preview-stage,.vvh3-static-midnight .vv-video-frame,.vvh3-static-midnight .vvh3m-card,.vvh3-static-midnight .vvh3m-status{background:linear-gradient(145deg,#0e1a27,#122234)!important;border-color:rgba(69,105,163,.30)!important;border-radius:9px!important}
    .vvh3-static-midnight input,.vvh3-static-midnight select,.vvh3-static-midnight textarea{background:#08131d!important;color:#eef3fa!important;border-color:rgba(67,105,165,.42)!important;border-radius:8px!important}
    .vvh3-static-midnight button,.vvh3-static-midnight .vvh3-segment.active,.vvh3-static-midnight .vv-segment.active{animation:none!important;background:linear-gradient(135deg,#4d2f80,#2d5685)!important;background-size:100% 100%!important;border-color:rgba(111,100,188,.58)!important;color:#f4effb!important}
    .vvh3-monitor,.vvh3m-head,.vvh3m-button,.vvh3-director-shell .vvh3-head::after{animation:none!important}
    .vvh3-director-shell .vvh3-head::after{transform:none!important;opacity:.55!important}
  `;
  document.head.appendChild(style);
}
function installListeners() {
  if (listenersInstalled) return; listenersInstalled = true;
  api.addEventListener("execution_start", reset);
  api.addEventListener("executing", ({detail}) => {
    const id = topNodeId(detail);
    if (activeNode && activeNode.__vvExecutionState === "active") { activeNode.__vvExecutionState = "done"; paint(activeNode, "idle"); }
    activeNode = id == null ? null : app.graph?.getNodeById?.(id) ?? null;
    if (activeNode && isH3(activeNode)) { activeNode.__vvExecutionState = "active"; paint(activeNode, "active"); }
  });
  api.addEventListener("executed", ({detail}) => { const id = topNodeId(detail); const n = id == null ? null : app.graph?.getNodeById?.(id); if (n && isH3(n)) { n.__vvExecutionState = "done"; paint(n, "idle"); } });
  api.addEventListener("execution_error", ({detail}) => { const id = topNodeId(detail); const n = (id == null ? null : app.graph?.getNodeById?.(id)) ?? activeNode; if (n && isH3(n)) { n.__vvExecutionState = "error"; paint(n, "error"); } activeNode = null; });
  api.addEventListener("execution_interrupted", () => { if (activeNode && isH3(activeNode)) { activeNode.__vvExecutionState = "warning"; paint(activeNode, "warning"); } activeNode = null; });
  api.addEventListener("execution_success", () => { if (activeNode && isH3(activeNode)) paint(activeNode, "idle"); activeNode = null; });
}

installCss(); installListeners();
app.registerExtension({
  name: "VelvetVice.MiniMaxH3.StaticMidnightUIAuditV140",
  nodeCreated(node) { setTimeout(() => { if (isH3(node)) paint(node, "idle"); }, 0); },
  loadedGraphNode(node) { setTimeout(() => { if (isH3(node)) paint(node, "idle"); }, 0); },
  afterConfigureGraph() { setTimeout(() => { installCss(); reset(); }, 100); },
});
