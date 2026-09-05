import { app } from "../../scripts/app.js";

// Late H3-only layout adapter.
// Some Velvet Vice panels historically declared node.resizable=true while
// their DOM widget still reported one fixed height. ComfyUI could then stretch
// only the outer node and leave a useless empty strip below the real panel.
// Keep every panel's original minimum, but let the visible surface follow the
// actual node size chosen by the user.

const EXTENSION_NAME = "VelvetVice.MiniMaxH3.FreeResizeV141";
const BIND_KEY = "__vvH3FreeResizeV141";
const WIDGET_KEY = "__vvH3FreeResizeWidgetV141";

function nodeType(node) {
  return String(node?.comfyClass ?? node?.type ?? "");
}

function isZenNode(node) {
  const props = node?.properties ?? {};
  return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
    || props.vv_zen_h3_scope === true
    || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
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

function isVisibleH3Node(node) {
  if (!node || isZenNode(node)) return false;
  if (node?.properties?.vv_h3_internal) return false;
  if (String(node?.title ?? "").toUpperCase().startsWith("H3 INTERNAL")) return false;
  return nodeType(node).startsWith("VelvetViceMiniMaxH3") || Boolean(shellFor(node));
}

function isDOMWidget(widget) {
  if (!widget) return false;
  const name = String(widget.name ?? "");
  if (/^(vv|vvh3)/i.test(name)) return true;
  if (widget.element || widget.inputEl) return true;
  return String(widget.type ?? "").toLowerCase().includes("dom");
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function reportedMinimum(widget, node) {
  const values = [];
  try { values.push(finitePositive(widget?.options?.getMinHeight?.())); } catch (_) {}
  try { values.push(finitePositive(widget?.computeLayoutSize?.()?.minHeight)); } catch (_) {}
  try { values.push(finitePositive(widget?.getHeight?.())); } catch (_) {}
  try { values.push(finitePositive(widget?.computeSize?.(Number(node?.size?.[0] ?? 640))?.[1])); } catch (_) {}
  return values.filter(Boolean)[0] ?? 30;
}

function widgetElement(widget, node) {
  return widget?.element ?? widget?.inputEl ?? shellFor(node) ?? null;
}

function patchWidget(node, widget) {
  if (!isDOMWidget(widget)) return null;

  let record = widget[WIDGET_KEY];
  if (!record) {
    const minHeight = Math.max(30, reportedMinimum(widget, node));
    const nodeHeight = Math.max(minHeight + 34, finitePositive(node?.size?.[1]) ?? minHeight + 70);
    const chrome = Math.max(34, Math.min(130, nodeHeight - minHeight));
    record = { minHeight, chrome };
    widget[WIDGET_KEY] = record;
  }

  const element = widgetElement(widget, node);
  if (element?.style) {
    element.style.width = "100%";
    element.style.minHeight = `${record.minHeight}px`;
    element.style.maxHeight = "none";
    if (element.style.overflow === "hidden") element.style.overflowY = "auto";
  }

  const apply = (size = node?.size) => {
    const width = Math.max(120, Number(size?.[0] ?? node?.size?.[0] ?? 640));
    const nodeHeight = Math.max(record.minHeight + record.chrome, Number(size?.[1] ?? node?.size?.[1] ?? 0));
    const height = Math.max(record.minHeight, nodeHeight - record.chrome);

    widget.computeSize = () => [width, height];
    widget.computeLayoutSize = () => ({
      minHeight: record.minHeight,
      maxHeight: Infinity,
      minWidth: 0,
      maxWidth: Infinity,
    });
    widget.getHeight = () => height;
    widget.options ??= {};
    widget.options.getMinHeight = () => record.minHeight;
    widget.options.getMaxHeight = () => Infinity;
    widget.options.getHeight = () => height;

    if (element?.style) element.style.height = `${height}px`;
  };

  apply();
  return apply;
}

function bindNode(node) {
  if (!isVisibleH3Node(node)) return;

  node.resizable = true;

  const applyWidgets = (size = node.size) => {
    const patched = [];
    for (const widget of node.widgets ?? []) {
      const apply = patchWidget(node, widget);
      if (apply) patched.push(apply);
    }
    for (const apply of patched) apply(size);

    const shell = shellFor(node);
    if (shell?.style) {
      shell.style.width = "100%";
      shell.style.height = "100%";
      shell.style.maxHeight = "none";
    }

    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
  };

  if (!node[BIND_KEY]) {
    node[BIND_KEY] = true;
    const previousResize = typeof node.onResize === "function" ? node.onResize.bind(node) : null;
    node.onResize = function(size) {
      // Let node-specific preview/player geometry update first. The adapter
      // then makes the DOM widget consume the actual remaining node height.
      try { previousResize?.(size); } catch (_) {}
      try { applyWidgets(size); } catch (error) {
        console.warn("[VELVET VICE] H3 free-resize adapter failed", error);
      }
    };
  }

  applyWidgets(node.size);
}

function bindAll() {
  for (const node of app.graph?._nodes ?? []) bindNode(node);
  app.graph?.setDirtyCanvas?.(true, true);
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
    bindAll();
    for (const delay of [250, 1000, 3000, 7000, 13000]) setTimeout(bindAll, delay);
  },
});
