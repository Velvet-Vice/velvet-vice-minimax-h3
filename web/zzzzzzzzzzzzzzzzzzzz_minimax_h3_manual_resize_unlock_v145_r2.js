import { app } from "../../scripts/app.js";

// VELVET VICE MiniMax H3 — manual resize unlock
//
// Purpose:
// - Every node shipped in the H3 workflow may be resized with the mouse.
// - Full DOM-panel nodes receive a small bottom-right drag handle so the DOM
//   overlay can never steal the native LiteGraph resize gesture.
// - DOM content scrolls instead of forcing the node back to a hard-coded size.
// - No ResizeObserver, no continuous auto-layout, no size feedback loop.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.ManualResizeUnlockV145R2";
const FLAG = "vv_h3_manual_resize";
const GRIP_CLASS = "vv-h3-manual-resize-grip-v145-r2";
const STYLE_ID = "vv-h3-manual-resize-style-v145-r2";
const BIND_KEY = "__vvH3ManualResizeV145R2";

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${GRIP_CLASS}{
      position:sticky;
      float:right;
      right:2px;
      bottom:2px;
      width:17px;
      height:17px;
      margin-top:-19px;
      margin-right:1px;
      border-right:2px solid rgba(170,150,198,.72);
      border-bottom:2px solid rgba(170,150,198,.72);
      border-radius:0 0 4px 0;
      cursor:nwse-resize;
      pointer-events:auto!important;
      z-index:2147483000;
      opacity:.58;
      box-sizing:border-box;
      touch-action:none;
      user-select:none;
    }
    .${GRIP_CLASS}:hover{opacity:1;border-color:rgba(202,184,226,.95)}
  `;
  document.head.appendChild(style);
}

function typeOf(node) {
  return String(node?.comfyClass ?? node?.type ?? "");
}

function isH3WorkflowNode(node) {
  if (!node) return false;
  if (node?.properties?.[FLAG] === true) return true;
  const type = typeOf(node);
  if (type.startsWith("VelvetViceMiniMaxH3")) return true;
  const title = String(node?.title ?? "").toUpperCase();
  return title.startsWith("VELVET VICE · H3")
    || title.startsWith("H3 INTERNAL")
    || title.includes("MINIMAX H3");
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nodeMinimum(node) {
  const type = typeOf(node);
  if (type === "VelvetViceMiniMaxH3RenderTimer") return [220, 120];
  if (type.includes("Preflight")) return [260, 140];
  if (type.includes("ProfileManager")) return [280, 160];
  if (type === "PreviewImage") return [220, 160];
  if (type === "MarkdownNote") return [220, 120];
  return [260, 140];
}

function relaxDomWidget(widget, element, minWidth, minHeight) {
  if (!widget || !element) return;

  // Make the DOM widget genuinely growable. This intentionally replaces any
  // earlier high minimum returned by the legacy fixed-height surface.
  if ("computeSize" in widget) widget.computeSize = undefined;
  widget.computeLayoutSize = () => ({
    minHeight: Math.max(80, minHeight - 36),
    maxHeight: Infinity,
    minWidth: Math.max(100, minWidth - 30),
    maxWidth: Infinity,
  });
  widget.options ??= {};
  widget.options.getMinHeight = () => Math.max(80, minHeight - 36);
  widget.options.getMaxHeight = () => Infinity;

  element.style.setProperty("width", "100%", "important");
  element.style.setProperty("height", "100%", "important");
  element.style.setProperty("min-width", "0", "important");
  element.style.setProperty("min-height", "0", "important");
  element.style.setProperty("max-width", "none", "important");
  element.style.setProperty("max-height", "none", "important");
  element.style.setProperty("overflow-y", "auto", "important");
  element.style.setProperty("overflow-x", "hidden", "important");
  if (!element.style.position) element.style.position = "relative";
}

function domSurface(node) {
  return node?.__vvh3Shell
    ?? node?.__vvH3PromptShell
    ?? node?.__vvPowerLoraShell
    ?? node?.__vvOutputShell
    ?? node?.__vvH3MonitorShell
    ?? node?.__vvh3PreviewDisplay?.shell
    ?? null;
}

function domWidgets(node) {
  return (node?.widgets ?? []).filter((w) => {
    const element = w?.element ?? w?.inputEl;
    return !!element && !w?.hidden;
  });
}

function currentScale() {
  return Math.max(0.05, finite(app?.canvas?.ds?.scale, 1));
}

function installGrip(node, surface) {
  if (!surface || surface.querySelector?.(`.${GRIP_CLASS}`)) return;
  const grip = document.createElement("div");
  grip.className = GRIP_CLASS;
  grip.title = "Drag to resize this H3 node";
  grip.setAttribute("aria-label", "Resize H3 node");
  grip.style.pointerEvents = "auto";
  surface.appendChild(grip);

  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const [minW, minH] = nodeMinimum(node);
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = finite(node.size?.[0], minW);
    const startH = finite(node.size?.[1], minH);
    const pointerId = event.pointerId;
    grip.setPointerCapture?.(pointerId);

    const move = (ev) => {
      const scale = currentScale();
      const nextW = Math.max(minW, Math.round(startW + (ev.clientX - startX) / scale));
      const nextH = Math.max(minH, Math.round(startH + (ev.clientY - startY) / scale));
      node.setSize?.([nextW, nextH]);
      if (node.size) {
        node.size[0] = nextW;
        node.size[1] = nextH;
      }
      node.properties ??= {};
      node.properties[FLAG] = true;
      node.properties.vv_h3_last_manual_size = [nextW, nextH];
      node.graph?.setDirtyCanvas?.(true, true);
      node.setDirtyCanvas?.(true, true);
      app.canvas?.setDirty?.(true, true);
    };

    const finish = () => {
      grip.releasePointerCapture?.(pointerId);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      node.graph?.setDirtyCanvas?.(true, true);
      app.canvas?.setDirty?.(true, true);
    };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }, { capture: true });
}

function bind(node) {
  if (!isH3WorkflowNode(node)) return false;
  installStyle();

  node.resizable = true;
  node.properties ??= {};
  node.properties[FLAG] = true;

  const [minW, minH] = nodeMinimum(node);
  const widgets = domWidgets(node);
  for (const widget of widgets) {
    const element = widget.element ?? widget.inputEl;
    relaxDomWidget(widget, element, minW, minH);
  }

  const surface = domSurface(node) ?? widgets[0]?.element ?? widgets[0]?.inputEl ?? null;
  if (surface) {
    relaxDomWidget(widgets[0], surface, minW, minH);
    installGrip(node, surface);
  }

  if (!node[BIND_KEY]) {
    node[BIND_KEY] = true;
    const oldResize = typeof node.onResize === "function" ? node.onResize : null;
    node.onResize = function(size) {
      let result;
      if (oldResize) {
        try { result = oldResize.apply(this, arguments); }
        catch (error) { console.warn("[VELVET VICE] H3 manual resize callback warning", error); }
      }
      this.resizable = true;
      const [w, h] = nodeMinimum(this);
      const localWidgets = domWidgets(this);
      for (const localWidget of localWidgets) {
        relaxDomWidget(localWidget, localWidget.element ?? localWidget.inputEl, w, h);
      }
      const localSurface = domSurface(this) ?? localWidgets[0]?.element ?? localWidgets[0]?.inputEl ?? null;
      if (localSurface) installGrip(this, localSurface);
      return result;
    };
  }

  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function bindAll() {
  for (const node of app.graph?._nodes ?? []) bind(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  setup() { installStyle(); },
  nodeCreated(node) {
    bind(node);
    setTimeout(() => bind(node), 0);
    setTimeout(() => bind(node), 250);
  },
  loadedGraphNode(node) {
    bind(node);
    setTimeout(() => bind(node), 0);
    setTimeout(() => bind(node), 300);
  },
  afterConfigureGraph() {
    bindAll();
    setTimeout(bindAll, 0);
    setTimeout(bindAll, 400);
    setTimeout(bindAll, 900);
  },
});
