import { app } from "../../scripts/app.js";

// Full-panel quality guard for the main MiniMax H3 workflow.
// These nodes already draw their own DOM header and controls. Suppress the
// native LiteGraph title/chrome so a second empty bar cannot sit above or on
// top of the real panel. This file never changes node values or render logic.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.FullPanelQualityGuardV140";
const GUARD_KEY = "__vvH3FullPanelQualityGuardV140";

const FULL_DOM_TYPES = new Set([
  "VelvetViceMiniMaxH3SystemHub",
  "VelvetViceMiniMaxH3Director",
  "VelvetViceMiniMaxH3ProfileManager",
  "VelvetViceMiniMaxH3OutputHub",
  "VelvetViceMiniMaxH3PromptDirector",
  "VelvetViceMiniMaxH3PowerLoraAV",
  "VelvetViceMiniMaxH3OutputStudio",
  "VelvetViceMiniMaxH3LivePreview",
  "VelvetViceMiniMaxH3Preflight",
  "VelvetViceMiniMaxH3RenderTimer",
]);

function nodeType(node) {
  return String(node?.comfyClass ?? node?.type ?? "");
}

function isZenNode(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function suppressNativePanelChrome(node) {
  if (!node || isZenNode(node) || !FULL_DOM_TYPES.has(nodeType(node))) return false;

  node.__vvSuppressCanvasChromeV1115 = true;
  node.__vvSuppressCanvasChromeV1114 = true;

  if (!node.__vvDisplayTitle) {
    node.__vvDisplayTitle = String(node.title ?? nodeType(node) ?? "VELVET VICE");
  }

  if (!node[GUARD_KEY]) {
    node[GUARD_KEY] = true;
    if (!node.__vvOriginalGetTitleV100 && typeof node.getTitle === "function") {
      node.__vvOriginalGetTitleV100 = node.getTitle.bind(node);
    }
    node.getTitle = function() { return "\u200b"; };
  }

  node.title_text_color = "rgba(0,0,0,0)";
  const noTitle = globalThis.LiteGraph?.NO_TITLE ?? 1;
  try {
    Object.defineProperty(node, "title_mode", {
      value: noTitle,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {}

  node.setDirtyCanvas?.(true, true);
  return true;
}

function applyAll() {
  for (const node of app.graph?._nodes ?? []) suppressNativePanelChrome(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  nodeCreated(node) {
    suppressNativePanelChrome(node);
    setTimeout(() => suppressNativePanelChrome(node), 0);
    setTimeout(() => suppressNativePanelChrome(node), 300);
  },
  loadedGraphNode(node) {
    suppressNativePanelChrome(node);
    setTimeout(() => suppressNativePanelChrome(node), 0);
    setTimeout(() => suppressNativePanelChrome(node), 350);
  },
  afterConfigureGraph() {
    applyAll();
    setTimeout(applyAll, 250);
    setTimeout(applyAll, 900);
  },
});
