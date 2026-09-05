import { app } from "../../scripts/app.js";

// Safe manual-resize bridge for the main Velvet Vice MiniMax H3 workflow.
//
// The original H3 panels correctly marked their LiteGraph node as resizable,
// but several DOM widgets still kept a fixed visual height. Dragging the node
// bottom edge therefore enlarged only the outer canvas node and left a useless
// empty strip below the real panel.
//
// This bridge deliberately does NOT change widget computeSize/getHeight,
// does NOT use ResizeObserver, and does NOT call setSize while dragging.
// It only makes the already-existing DOM surface consume the extra height the
// user gave the node. That avoids the feedback loop that previously caused
// runaway Output Studio heights and sluggish resizing.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.SafeSurfaceResizeV140";
const BIND_KEY = "__vvH3SafeSurfaceResizeV140";

const SPECS = Object.freeze({
  VelvetViceMiniMaxH3SystemHub: {
    widgetPrefix: "vvh3_system_surface",
    minWidth: 690,
    minNodeHeight: 850,
    minSurfaceHeight: 790,
  },
  VelvetViceMiniMaxH3Director: {
    widgetPrefix: "vvh3_director_surface",
    minWidth: 720,
    minNodeHeight: 690,
    minSurfaceHeight: 625,
  },
  VelvetViceMiniMaxH3OutputHub: {
    widgetPrefix: "vvh3_output_surface",
    minWidth: 700,
    minNodeHeight: 700,
    minSurfaceHeight: 625,
  },
  VelvetViceMiniMaxH3ProfileManager: {
    widgetPrefix: "vvh3_profile_surface",
    minWidth: 690,
    minNodeHeight: 450,
    minSurfaceHeight: 390,
  },
  VelvetViceMiniMaxH3PromptDirector: {
    widgetPrefix: "vv_h3_prompt_director_surface",
    minWidth: 840,
    minNodeHeight: 720,
    minSurfaceHeight: 650,
  },
  VelvetViceMiniMaxH3Preflight: {
    widgetPrefix: "vv_h3_preflight_surface",
    minWidth: 680,
    minNodeHeight: 405,
    minSurfaceHeight: 320,
  },
  VelvetViceMiniMaxH3RenderTimer: {
    widgetPrefix: "vv_h3_render_timer_surface",
    minWidth: 520,
    minNodeHeight: 285,
    minSurfaceHeight: 215,
  },
  VelvetViceMiniMaxH3PowerLoraAV: {
    widgetPrefix: "vv_power_lora_surface",
    minWidth: 750,
    minNodeHeight: 585,
    minSurfaceHeight: 525,
  },
  VelvetViceMiniMaxH3OutputStudio: {
    widgetPrefix: "vv_output_studio_surface",
    minWidth: 760,
    minNodeHeight: 700,
    minSurfaceHeight: 430,
    outputStudio: true,
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

function clampManualSize(node, size, spec) {
  const target = Array.isArray(size) ? size : node?.size;
  if (!Array.isArray(target)) return;

  target[0] = Math.max(spec.minWidth, Number(target[0] ?? spec.minWidth));
  target[1] = Math.max(spec.minNodeHeight, Number(target[1] ?? spec.minNodeHeight));

  // Most ComfyUI builds pass node.size itself. Keep the actual node synchronized
  // for builds that pass a temporary array instead. This is a direct value
  // clamp only; it intentionally does not invoke node.setSize().
  if (Array.isArray(node?.size)) {
    node.size[0] = target[0];
    node.size[1] = target[1];
  }
}

function applyVisualHeight(node, spec, size = node?.size) {
  const widget = widgetFor(node, spec.widgetPrefix);
  const element = elementFor(node, widget);
  if (!widget || !element) return false;

  const nodeHeight = Math.max(
    spec.minNodeHeight,
    Number(size?.[1] ?? node?.size?.[1] ?? spec.minNodeHeight),
  );
  const chrome = Math.max(0, spec.minNodeHeight - spec.minSurfaceHeight);
  const visualHeight = Math.max(spec.minSurfaceHeight, nodeHeight - chrome);
  const px = `${Math.round(visualHeight)}px`;
  const host = hostFor(element, widget);

  if (host?.style) {
    host.style.setProperty("height", px, "important");
    host.style.setProperty("min-height", `${spec.minSurfaceHeight}px`, "important");
    host.style.setProperty("max-height", "none", "important");
  }

  if (spec.outputStudio) {
    // Output Studio calculates its own final-video geometry from intrinsic
    // content height. Forcing the shell height while a video is visible would
    // contaminate that measurement and recreate the old runaway-height loop.
    // While idle, however, filling the shell is safe and removes the useless
    // bottom strip. As soon as the video is visible, native Studio geometry is
    // allowed to be the sole authority again.
    const hasVisibleVideo = Boolean(
      element.querySelector?.(".vv-video-frame.visible, video[src]")
    );
    if (hasVisibleVideo) {
      element.style.removeProperty("height");
      element.style.removeProperty("min-height");
    } else {
      element.style.setProperty("height", px, "important");
      element.style.setProperty("min-height", `${spec.minSurfaceHeight}px`, "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow-y", "auto", "important");
    }
    return true;
  }

  element.style.setProperty("height", px, "important");
  element.style.setProperty("min-height", `${spec.minSurfaceHeight}px`, "important");
  element.style.setProperty("max-height", "none", "important");
  element.style.setProperty("overflow-y", "auto", "important");
  return true;
}

function bindNode(node) {
  if (!node || isZenNode(node)) return false;
  const spec = SPECS[nodeType(node)];
  if (!spec) return false;

  const widget = widgetFor(node, spec.widgetPrefix);
  const element = elementFor(node, widget);
  if (!widget || !element) return false;

  node.resizable = true;

  if (!node[BIND_KEY]) {
    node[BIND_KEY] = true;
    const previousResize = typeof node.onResize === "function" ? node.onResize : null;

    node.onResize = function(size) {
      clampManualSize(this, size, spec);

      let result;
      if (previousResize) {
        try {
          result = previousResize.apply(this, arguments);
        } catch (error) {
          console.warn("[VELVET VICE] Existing H3 onResize handler failed", error);
        }
      }

      // Pure DOM sizing only. No canvas invalidation is needed here: ComfyUI is
      // already repainting while the user drags the node boundary.
      applyVisualHeight(this, spec, size);
      return result;
    };
  }

  clampManualSize(node, node.size, spec);
  applyVisualHeight(node, spec, node.size);
  return true;
}

function bindAll() {
  for (const node of app.graph?._nodes ?? []) bindNode(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  nodeCreated(node) {
    // Other H3 extensions create their DOM surface during node setup. A pair
    // of one-shot retries covers both old and new frontend ordering without a
    // polling loop or permanent timer.
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
