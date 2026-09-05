import { app } from "../../scripts/app.js";

// MiniMax H3 native DOM-resize compatibility layer.
//
// Modern ComfyUI/LiteGraph classifies widgets that expose computeSize() as
// fixed-height. DOM widgets without computeSize(), but with computeLayoutSize(),
// are growable and receive the node's free height through widget.computedHeight.
//
// The H3 UI historically supplied both APIs. That made the outer node resize
// while the DOM surface stayed fixed, leaving dead space. Earlier attempts to
// compensate by rewriting node.size/onResize caused feedback and runaway
// vertical growth. This layer does the opposite: it removes only the legacy
// fixed-height callback on modern DOM widgets and lets ComfyUI own resizing.
//
// No setSize() is called from onResize. No ResizeObserver. No timers/polling.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.NativeDOMResizeV140";
const BIND_KEY = "__vvH3NativeDOMResizeV140";
const RECORD_KEY = "__vvH3NativeDOMResizeRecordV140";

const SPECS = Object.freeze({
  VelvetViceMiniMaxH3SystemHub:       { prefix: "vvh3_system_surface", minWidth: 690, minHeight: 790 },
  VelvetViceMiniMaxH3Director:        { prefix: "vvh3_director_surface", minWidth: 720, minHeight: 625 },
  VelvetViceMiniMaxH3OutputHub:       { prefix: "vvh3_output_surface", minWidth: 700, minHeight: 625 },
  VelvetViceMiniMaxH3ProfileManager:  { prefix: "vvh3_profile_surface", minWidth: 690, minHeight: 390 },
  VelvetViceMiniMaxH3PromptDirector:  { prefix: "vv_h3_prompt_director_surface", minWidth: 840, minHeight: 610 },
  VelvetViceMiniMaxH3Preflight:       { prefix: "vv_h3_preflight_surface", minWidth: 680, minHeight: 320 },
  VelvetViceMiniMaxH3RenderTimer:     { prefix: "vv_h3_render_timer_surface", minWidth: 520, minHeight: 215 },
  VelvetViceMiniMaxH3PowerLoraAV:     { prefix: "vv_power_lora_surface", minWidth: 750, minHeight: 525 },
  VelvetViceMiniMaxH3OutputStudio:    { prefix: "vv_output_studio_surface", minWidth: 760, minHeight: 430, intrinsicShell: true },
  VelvetViceMiniMaxH3LivePreview:     { prefix: "vvh3_combined_live_preview", minWidth: 720, minHeight: 560 },
});

function nodeType(node) {
  return String(node?.comfyClass ?? node?.type ?? "");
}

function isZenNode(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function widgetFor(node, prefix) {
  return (node?.widgets ?? []).find((item) =>
    !item?.hidden && String(item?.name ?? "").startsWith(prefix)
  ) ?? null;
}

function elementFor(node, widget) {
  return node?.__vvh3Shell
    ?? node?.__vvH3PromptShell
    ?? node?.__vvPowerLoraShell
    ?? node?.__vvOutputShell
    ?? node?.__vvH3MonitorShell
    ?? node?.__vvh3PreviewDisplay?.shell
    ?? widget?.element
    ?? widget?.inputEl
    ?? null;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLayout(node, widget, element, spec) {
  if (!widget || !element || typeof widget.computeLayoutSize !== "function") {
    return false;
  }

  let record = widget[RECORD_KEY];
  if (!record) {
    record = { wrapper: null, baseLayout: null };
    record.wrapper = function(layoutNode = node) {
      let base = {};
      try { base = record.baseLayout?.(layoutNode) ?? {}; } catch (_) {}
      return {
        ...base,
        minHeight: Math.max(spec.minHeight, finite(base?.minHeight, spec.minHeight)),
        maxHeight: Infinity,
        minWidth: Math.max(0, spec.minWidth - 20, finite(base?.minWidth, 0)),
        maxWidth: Infinity,
      };
    };
    widget[RECORD_KEY] = record;
  }

  if (widget.computeLayoutSize !== record.wrapper) {
    record.baseLayout = widget.computeLayoutSize.bind(widget);
    widget.computeLayoutSize = record.wrapper;
  }

  if (widget.computeSize) widget.computeSize = undefined;

  widget.options ??= {};
  const oldMin = widget.options.getMinHeight;
  if (!widget.options.__vvH3NativeMinWrapped) {
    widget.options.__vvH3NativeMinWrapped = true;
    widget.options.getMinHeight = () => {
      let nativeMin = spec.minHeight;
      try {
        const value = oldMin?.();
        if (Number.isFinite(Number(value))) nativeMin = Math.max(nativeMin, Number(value));
      } catch (_) {}
      return nativeMin;
    };
    widget.options.getMaxHeight = () => Infinity;
  }

  element.style.setProperty("width", "100%", "important");
  element.style.setProperty("max-width", "none", "important");
  element.style.setProperty("max-height", "none", "important");

  if (spec.intrinsicShell) {
    element.style.removeProperty("height");
    element.style.removeProperty("min-height");
  } else {
    element.style.setProperty("height", "100%", "important");
    element.style.setProperty("min-height", "0", "important");
    element.style.setProperty("overflow-y", "auto", "important");
  }

  node.resizable = true;
  return true;
}

function bindNode(node) {
  if (!node || isZenNode(node)) return false;
  const spec = SPECS[nodeType(node)];
  if (!spec) return false;

  const widget = widgetFor(node, spec.prefix);
  const element = elementFor(node, widget);
  if (!widget || !element) return false;

  normalizeLayout(node, widget, element, spec);

  if (!node[BIND_KEY]) {
    node[BIND_KEY] = true;
    const previousResize = typeof node.onResize === "function" ? node.onResize : null;
    node.onResize = function(size) {
      let result;
      if (previousResize) {
        try { result = previousResize.apply(this, arguments); }
        catch (error) { console.warn("[VELVET VICE] H3 native onResize failed", error); }
      }
      const currentWidget = widgetFor(this, spec.prefix) ?? widget;
      const currentElement = elementFor(this, currentWidget) ?? element;
      normalizeLayout(this, currentWidget, currentElement, spec);
      return result;
    };
  }

  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function bindAll() {
  for (const node of app.graph?._nodes ?? []) bindNode(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  nodeCreated(node) {
    setTimeout(() => bindNode(node), 0);
    setTimeout(() => bindNode(node), 250);
  },
  loadedGraphNode(node) {
    setTimeout(() => bindNode(node), 0);
    setTimeout(() => bindNode(node), 300);
  },
  afterConfigureGraph() {
    setTimeout(bindAll, 0);
    setTimeout(bindAll, 350);
  },
});
