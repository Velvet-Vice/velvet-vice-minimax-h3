import { app } from "../../scripts/app.js";

// MiniMax H3 manual-resize bridge.
//
// Goal: when the user drags a full H3 DOM node taller, the actual DOM widget
// receives the extra height instead of leaving a dead strip below the panel.
// The bridge is deliberately event driven: no ResizeObserver, no polling loop,
// and no node.setSize() from inside onResize. This avoids the feedback loops
// that previously caused runaway Output Studio heights and sluggish dragging.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.SurfaceResizeAuditV140";
const BIND_KEY = "__vvH3SurfaceResizeAuditV140";
const WIDGET_KEY = "__vvH3SurfaceResizeWidgetV140";
const BOTTOM_PAD = 8;

const SPECS = Object.freeze({
  VelvetViceMiniMaxH3SystemHub: {
    widgetPrefix: "vvh3_system_surface",
    minWidth: 690,
    minNodeHeight: 850,
    minSurfaceHeight: 790,
    fallbackTop: 52,
  },
  VelvetViceMiniMaxH3Director: {
    widgetPrefix: "vvh3_director_surface",
    minWidth: 720,
    minNodeHeight: 690,
    minSurfaceHeight: 625,
    fallbackTop: 57,
  },
  VelvetViceMiniMaxH3OutputHub: {
    widgetPrefix: "vvh3_output_surface",
    minWidth: 700,
    minNodeHeight: 700,
    minSurfaceHeight: 625,
    fallbackTop: 67,
  },
  VelvetViceMiniMaxH3ProfileManager: {
    widgetPrefix: "vvh3_profile_surface",
    minWidth: 690,
    minNodeHeight: 450,
    minSurfaceHeight: 390,
    fallbackTop: 52,
  },
  VelvetViceMiniMaxH3PromptDirector: {
    widgetPrefix: "vv_h3_prompt_director_surface",
    minWidth: 840,
    minNodeHeight: 720,
    minSurfaceHeight: 650,
    fallbackTop: 62,
  },
  VelvetViceMiniMaxH3Preflight: {
    widgetPrefix: "vv_h3_preflight_surface",
    minWidth: 680,
    minNodeHeight: 405,
    minSurfaceHeight: 320,
    fallbackTop: 77,
  },
  VelvetViceMiniMaxH3RenderTimer: {
    widgetPrefix: "vv_h3_render_timer_surface",
    minWidth: 520,
    minNodeHeight: 285,
    minSurfaceHeight: 215,
    fallbackTop: 62,
  },
  VelvetViceMiniMaxH3PowerLoraAV: {
    widgetPrefix: "vv_power_lora_surface",
    minWidth: 750,
    minNodeHeight: 585,
    minSurfaceHeight: 525,
    fallbackTop: 52,
  },
  VelvetViceMiniMaxH3OutputStudio: {
    widgetPrefix: "vv_output_studio_surface",
    minWidth: 760,
    minNodeHeight: 700,
    minSurfaceHeight: 430,
    fallbackTop: 62,
    preserveIntrinsicShell: true,
  },
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
    String(item?.name ?? "").startsWith(prefix)
  ) ?? null;
}

function elementFor(node, widget) {
  return node?.__vvh3Shell
    ?? node?.__vvH3PromptShell
    ?? node?.__vvPowerLoraShell
    ?? node?.__vvOutputShell
    ?? node?.__vvH3MonitorShell
    ?? widget?.element
    ?? widget?.inputEl
    ?? null;
}

function hostFor(element, widget) {
  return element?.closest?.(".dom-widget")
    ?? widget?.element?.closest?.(".dom-widget")
    ?? widget?.inputEl?.closest?.(".dom-widget")
    ?? null;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampManualSize(node, size, spec) {
  const target = Array.isArray(size) ? size : node?.size;
  if (!Array.isArray(target)) return;

  target[0] = Math.max(spec.minWidth, finite(target[0], spec.minWidth));
  target[1] = Math.max(spec.minNodeHeight, finite(target[1], spec.minNodeHeight));

  // Directly clamp the size supplied by LiteGraph. Do not call setSize() here:
  // doing so from onResize can recurse through the frontend layout engine.
  if (Array.isArray(node?.size)) {
    node.size[0] = target[0];
    node.size[1] = target[1];
  }
}

function originalPreferredHeight(record, width) {
  let height = record.spec.minSurfaceHeight;
  try {
    const measured = record.originalComputeSize?.(width);
    if (Array.isArray(measured) && Number.isFinite(Number(measured[1]))) {
      height = Math.max(height, Number(measured[1]));
    }
  } catch (_) {}
  try {
    const layout = record.originalComputeLayoutSize?.();
    if (Number.isFinite(Number(layout?.minHeight))) {
      height = Math.max(height, Number(layout.minHeight));
    }
  } catch (_) {}
  try {
    const minHeight = record.originalOptionGetMinHeight?.();
    if (Number.isFinite(Number(minHeight))) {
      height = Math.max(height, Number(minHeight));
    }
  } catch (_) {}
  return height;
}

function widgetTop(record) {
  const nodeHeight = finite(record.node?.size?.[1], record.spec.minNodeHeight);
  const lastY = Number(record.widget?.last_y);
  if (Number.isFinite(lastY) && lastY >= 0 && lastY <= nodeHeight - 20) {
    return lastY;
  }
  return record.spec.fallbackTop;
}

function desiredHeight(record, width = finite(record.node?.size?.[0], record.spec.minWidth)) {
  const nodeHeight = Math.max(
    record.spec.minNodeHeight,
    finite(record.node?.size?.[1], record.spec.minNodeHeight),
  );
  const available = Math.max(
    record.spec.minSurfaceHeight,
    nodeHeight - widgetTop(record) - BOTTOM_PAD,
  );
  return Math.max(originalPreferredHeight(record, width), available);
}

function installWidgetSizing(record) {
  const { widget, spec } = record;

  widget.computeSize = (width) => {
    let resolvedWidth = Math.max(spec.minWidth, finite(width, spec.minWidth));
    try {
      const original = record.originalComputeSize?.(width);
      if (Array.isArray(original) && Number.isFinite(Number(original[0]))) {
        resolvedWidth = Math.max(resolvedWidth, Number(original[0]));
      }
    } catch (_) {}
    return [resolvedWidth, desiredHeight(record, resolvedWidth)];
  };

  widget.computeLayoutSize = () => {
    let base = {};
    try { base = record.originalComputeLayoutSize?.() ?? {}; } catch (_) {}
    let originalMin = spec.minSurfaceHeight;
    if (Number.isFinite(Number(base?.minHeight))) {
      originalMin = Math.max(originalMin, Number(base.minHeight));
    }
    return {
      ...base,
      minHeight: originalMin,
      maxHeight: Infinity,
      minWidth: Number.isFinite(Number(base?.minWidth)) ? Number(base.minWidth) : 0,
      maxWidth: Infinity,
    };
  };

  if (typeof record.originalGetHeight === "function" || "getHeight" in widget) {
    widget.getHeight = () => desiredHeight(record);
  }

  widget.options ??= {};
  widget.options.getMinHeight = () => {
    let minHeight = spec.minSurfaceHeight;
    try {
      const original = record.originalOptionGetMinHeight?.();
      if (Number.isFinite(Number(original))) minHeight = Math.max(minHeight, Number(original));
    } catch (_) {}
    return minHeight;
  };
  widget.options.getMaxHeight = () => Infinity;
  widget.options.getHeight = () => desiredHeight(record);
}

function applyVisualHeight(record) {
  const { node, widget, element, spec } = record;
  const width = Math.max(spec.minWidth, finite(node?.size?.[0], spec.minWidth));
  const height = desiredHeight(record, width);
  const px = `${Math.round(height)}px`;
  const host = hostFor(element, widget);

  if (host?.style) {
    host.style.setProperty("height", px, "important");
    host.style.setProperty("min-height", `${spec.minSurfaceHeight}px`, "important");
    host.style.setProperty("max-height", "none", "important");
    host.style.setProperty("min-width", "0", "important");
  }

  element.style.setProperty("width", "100%", "important");
  element.style.setProperty("max-height", "none", "important");

  if (spec.preserveIntrinsicShell) {
    // Output Studio measures shell.scrollHeight when video metadata arrives.
    // Forcing the shell itself to the node height would pollute that intrinsic
    // measurement. The DOM host grows with the node, while the Studio keeps
    // ownership of its player/shell geometry.
    element.style.removeProperty("height");
    element.style.removeProperty("min-height");
  } else {
    element.style.setProperty("height", "100%", "important");
    element.style.setProperty("min-height", `${spec.minSurfaceHeight}px`, "important");
    element.style.setProperty("overflow-y", "auto", "important");
  }
}

function makeRecord(node, widget, element, spec) {
  const existing = widget[WIDGET_KEY];
  if (existing) return existing;

  const options = widget.options ?? {};
  const record = {
    node,
    widget,
    element,
    spec,
    originalComputeSize: typeof widget.computeSize === "function" ? widget.computeSize.bind(widget) : null,
    originalComputeLayoutSize: typeof widget.computeLayoutSize === "function" ? widget.computeLayoutSize.bind(widget) : null,
    originalGetHeight: typeof widget.getHeight === "function" ? widget.getHeight.bind(widget) : null,
    originalOptionGetMinHeight: typeof options.getMinHeight === "function" ? options.getMinHeight.bind(options) : null,
  };
  widget[WIDGET_KEY] = record;
  installWidgetSizing(record);
  return record;
}

function bindNode(node) {
  if (!node || isZenNode(node)) return false;
  const spec = SPECS[nodeType(node)];
  if (!spec) return false;

  const widget = widgetFor(node, spec.widgetPrefix);
  const element = elementFor(node, widget);
  if (!widget || !element) return false;

  node.resizable = true;
  const record = makeRecord(node, widget, element, spec);

  if (!node[BIND_KEY]) {
    node[BIND_KEY] = true;
    const previousResize = typeof node.onResize === "function" ? node.onResize : null;

    node.onResize = function(size) {
      clampManualSize(this, size, spec);
      let result;
      if (previousResize) {
        try { result = previousResize.apply(this, arguments); }
        catch (error) { console.warn("[VELVET VICE] Existing H3 onResize handler failed", error); }
      }
      applyVisualHeight(record);
      return result;
    };
  }

  clampManualSize(node, node.size, spec);
  applyVisualHeight(record);
  return true;
}

function bindAll() {
  for (const node of app.graph?._nodes ?? []) bindNode(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  nodeCreated(node) {
    setTimeout(() => bindNode(node), 0);
    setTimeout(() => bindNode(node), 200);
    setTimeout(() => bindNode(node), 700);
  },
  loadedGraphNode(node) {
    setTimeout(() => bindNode(node), 0);
    setTimeout(() => bindNode(node), 250);
    setTimeout(() => bindNode(node), 800);
  },
  afterConfigureGraph() {
    setTimeout(bindAll, 0);
    setTimeout(bindAll, 250);
    setTimeout(bindAll, 900);
  },
});
