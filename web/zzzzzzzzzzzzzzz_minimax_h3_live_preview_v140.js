import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DISPLAY_TYPE = "VelvetViceMiniMaxH3LivePreview";
const EVENT_NAME = "velvet_vice.h3_live_preview";
const VERSION = "1.4.3-native-resize";
const DEFAULT_NODE_WIDTH = 980;
const DEFAULT_NODE_HEIGHT = 620;
const MIN_NODE_WIDTH = 720;
const MIN_NODE_HEIGHT = 420;
const CHROME_VERTICAL = 86;
const displays = new Set();
let listenersInstalled = false;

function nodeType(node) {
    return String(node?.comfyClass ?? node?.type ?? "");
}

function installStyle() {
    if (document.getElementById("vvh3-preview-runtime2-style")) return;
    const style = document.createElement("style");
    style.id = "vvh3-preview-runtime2-style";
    style.textContent = `
      .vvh3-preview-shell{height:100%;box-sizing:border-box;padding:8px 8px 7px;background:#1a2630;border-radius:8px;display:flex;flex-direction:column;gap:7px;overflow:hidden;color:#dce6ed;font-family:Arial,sans-serif}
      .vvh3-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:24px}.vvh3-preview-title{font-weight:800;font-size:11px;letter-spacing:.02em}.vvh3-preview-badge{font-size:9px;font-weight:800;padding:3px 7px;border-radius:999px;background:#15351f;color:#b6f5c6;white-space:nowrap}.vvh3-preview-badge.warn{background:#443819;color:#ffe29a}.vvh3-preview-badge.error{background:#4a1f25;color:#ffb5bd}
      .vvh3-preview-stage{position:relative;flex:1;min-height:320px;background:#05090c;border:1px solid #263844;border-radius:7px;overflow:hidden;display:flex;align-items:center;justify-content:center}.vvh3-preview-stage img{width:100%;height:100%;object-fit:contain;display:none;image-rendering:auto}.vvh3-preview-empty{max-width:82%;text-align:center;color:#9fadb7;font-size:10px;line-height:1.55;white-space:pre-line}
      .vvh3-preview-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#8996a2;font-size:8.5px;line-height:1.3}.vvh3-preview-foot span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.appendChild(style);
}

function hideWidget(widget) {
    if (!widget || widget.__vvh3PreviewHidden) return;
    widget.__vvh3PreviewHidden = true;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
}

function stopAnimator(display) {
    if (display.animationId != null) cancelAnimationFrame(display.animationId);
    display.animationId = null;
    display.lastTick = 0;
}

function revokeCurrent(display) {
    stopAnimator(display);
    for (const url of display.frameUrls ?? []) {
        if (url && url.startsWith("blob:")) {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }
    }
    display.frameUrls = [];
    if (display.currentUrl && display.currentUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(display.currentUrl); } catch (_) {}
    }
    display.currentUrl = null;
}

function stopWatchdog(display) {
    if (display.watchdogId != null) clearTimeout(display.watchdogId);
    display.watchdogId = null;
}

function setBadge(display, text, kind = "normal") {
    display.badge.textContent = text;
    display.badge.classList.toggle("warn", kind === "warn");
    display.badge.classList.toggle("error", kind === "error");
}

function clearDisplay(display, message = "Queue a render to start the MiniMax H3 live preview.", badge = "READY") {
    stopWatchdog(display);
    revokeCurrent(display);
    display.image.removeAttribute("src");
    display.image.style.display = "none";
    display.empty.style.display = "block";
    display.empty.textContent = message;
    display.title.textContent = "MINIMAX H3 · LIVE SAMPLER PREVIEW";
    setBadge(display, badge);
    display.details.textContent = "whole-shot H3 preview · buffered RGB frame set";
    display.counter.textContent = `v${VERSION}`;
    display.lastStage = badge;
    display.frameIndex = 0;
    display.targetFps = 24;
    display.actualFps = 0;
    display.frozen = false;
}

function dataToBlobUrl(data, mime) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function matchesDisplay(display, detail) {
    const target = detail?.node_id;
    if (target == null || target === "") return true;
    return String(target) === String(display.node?.id);
}

function applyStatus(display, detail) {
    const stage = String(detail?.stage || "STATUS").toUpperCase();
    const message = String(detail?.message || stage);
    display.lastStage = stage;
    display.empty.style.display = display.image.src ? "none" : "block";
    if (!display.image.src) display.empty.textContent = message;
    display.details.textContent = message;

    const errorStages = new Set(["NO_PREVIEW_DECODER", "UNPACK_FAILED", "PREVIEW_ERROR", "NO_CALLBACK"]);
    const warnStages = new Set(["DISABLED", "NO_CALLBACK", "LATENT2RGB_FALLBACK", "TAEH3V_FALLBACK"]);
    if (errorStages.has(stage)) setBadge(display, stage, stage === "NO_CALLBACK" ? "warn" : "error");
    else if (warnStages.has(stage)) setBadge(display, stage, "warn");
    else setBadge(display, stage);
}

function showFrame(display, index) {
    if (!display.frameUrls?.length) return;
    const count = display.frameUrls.length;
    const safe = ((Number(index) % count) + count) % count;
    display.frameIndex = safe;
    display.image.src = display.frameUrls[safe];
    display.image.style.display = "block";
    display.empty.style.display = "none";
}

function refreshFpsLabel(display) {
    const target = Number(display.targetFps || 0);
    const actual = Number(display.actualFps || 0);
    const suffix = display.frozen ? " · FROZEN" : "";
    display.counter.textContent = `TARGET ${target.toFixed(0)} FPS · ACTUAL ${actual.toFixed(1)} FPS${suffix}`;
}

function startAnimator(display) {
    stopAnimator(display);
    display.frozen = false;
    display.actualFps = 0;
    display.fpsWindowStart = performance.now();
    display.fpsFrames = 0;
    const tick = (timestamp) => {
        if (display.frozen || !display.frameUrls?.length) {
            display.animationId = null;
            return;
        }
        const target = Math.max(1, Number(display.targetFps || 24));
        const interval = 1000 / target;
        if (!display.lastTick) display.lastTick = timestamp;
        const elapsed = timestamp - display.lastTick;
        if (elapsed >= interval) {
            const advance = Math.max(1, Math.floor(elapsed / interval));
            display.lastTick += advance * interval;
            showFrame(display, display.frameIndex + advance);
            display.fpsFrames += 1;
        }
        const windowElapsed = timestamp - display.fpsWindowStart;
        if (windowElapsed >= 750) {
            display.actualFps = display.fpsFrames * 1000 / Math.max(1, windowElapsed);
            display.fpsFrames = 0;
            display.fpsWindowStart = timestamp;
            refreshFpsLabel(display);
        }
        display.animationId = requestAnimationFrame(tick);
    };
    display.animationId = requestAnimationFrame(tick);
}

function freezeDisplay(display, badge = "COMPLETE", useLastFrame = true) {
    stopAnimator(display);
    display.frozen = true;
    if (display.frameUrls?.length) {
        showFrame(display, useLastFrame ? display.frameUrls.length - 1 : display.frameIndex);
    }
    setBadge(display, badge, badge === "COMPLETE" ? "normal" : "warn");
    refreshFpsLabel(display);
}

function applyPreview(display, detail) {
    const encodedFrames = Array.isArray(detail?.frames) ? detail.frames.filter((item) => typeof item === "string" && item) : [];
    const fallback = typeof detail?.webp === "string" && detail.webp ? [detail.webp] : [];
    const frameData = encodedFrames.length ? encodedFrames : fallback;
    if (!frameData.length) return;
    stopWatchdog(display);
    revokeCurrent(display);
    const mime = String(detail?.mime || "image/jpeg");
    display.frameUrls = frameData.map((encoded) => {
        try { return dataToBlobUrl(encoded, mime); }
        catch (_) { return `data:${mime};base64,${encoded}`; }
    });
    display.frameIndex = 0;
    display.targetFps = Math.max(0.5, Number(detail?.source_playback_fps ?? detail?.preview_fps ?? 24));
    display.selectedFps = Math.max(0.5, Number(detail?.preview_fps ?? display.targetFps ?? 24));
    display.actualFps = 0;
    display.frozen = false;
    showFrame(display, 0);

    const width = Number(detail?.width ?? 0);
    const height = Number(detail?.height ?? 0);
    const step = Number(detail?.step ?? 0);
    const steps = Math.max(1, Number(detail?.steps ?? 1));
    const seconds = Number(detail?.timeline_duration_seconds ?? 0);
    const count = display.frameUrls.length;
    display.title.textContent = `${width} × ${height} · H3 WHOLE-SHOT PREVIEW`;
    setBadge(display, `STEP ${step}/${steps}`);
    const mode = String(detail?.preview_mode || "H3 PREVIEW");
    const quality = String(detail?.quality_mode || "?").toUpperCase();
    const effectiveEdge = Number(detail?.effective_max_edge ?? 0);
    const maxCap = Number(detail?.max_edge_cap ?? 0);
    const transportQ = Number(detail?.jpeg_quality ?? detail?.webp_quality ?? 0);
    const frameBudget = Number(detail?.preview_frame_budget ?? count);
    const frameBudgetCap = Number(detail?.preview_frame_budget_cap ?? frameBudget);
    const selectedFps = Number(display.selectedFps ?? display.targetFps ?? 0);
    display.details.textContent = `${seconds.toFixed(2)}s · ${mode} · QUALITY ${quality} · ${effectiveEdge}px / ${maxCap}px cap · JPEG Q${transportQ} · ${frameBudget}/${frameBudgetCap} frames · SELECTED ${selectedFps.toFixed(0)} FPS`;
    display.lastStage = "STREAMING";
    refreshFpsLabel(display);
    if (display.frameUrls.length > 1) startAnimator(display);
}

function updateDisplay(display, detail) {
    if (!matchesDisplay(display, detail)) return;
    if (String(detail?.kind || "") === "status") applyStatus(display, detail);
    if (["preview", "preview_frames"].includes(String(detail?.kind || "")) || detail?.webp || detail?.frames) applyPreview(display, detail);
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    api.addEventListener(EVENT_NAME, ({ detail }) => {
        for (const display of displays) updateDisplay(display, detail ?? {});
    });
    api.addEventListener("execution_start", () => {
        for (const display of displays) {
            clearDisplay(display, "Render started. Waiting for the H3 preview node to install its sampler hook…", "STARTING");
            display.watchdogId = setTimeout(() => {
                if (display.lastStage === "STREAMING") return;
                if (["HOOKED", "SAMPLING", "FRAME_RECEIVED"].includes(display.lastStage)) return;
                setBadge(display, "NO HOOK", "error");
                display.empty.textContent = "The render started, but the H3 preview node did not report that its sampler hook was installed.";
            }, 12000);
        }
    });
    api.addEventListener("execution_error", () => {
        for (const display of displays) {
            stopWatchdog(display);
            freezeDisplay(display, "RENDER ERROR", false);
        }
    });
    api.addEventListener("execution_interrupted", () => {
        for (const display of displays) {
            stopWatchdog(display);
            freezeDisplay(display, "STOPPED", false);
        }
    });
    api.addEventListener("execution_success", () => {
        for (const display of displays) {
            stopWatchdog(display);
            if (display.lastStage === "STREAMING") {
                freezeDisplay(display, "COMPLETE", true);
                display.lastStage = "COMPLETE";
            }
        }
    });
}

function removeStaleDisplay(node) {
    const active = node.__vvh3PreviewDisplay;
    if (active) {
        stopWatchdog(active);
        revokeCurrent(active);
        displays.delete(active);
    }
    for (const item of [...(node.widgets ?? [])]) {
        if (!String(item?.name ?? "").startsWith("vvh3_combined_live_preview")) continue;
        try { item.onRemove?.(); } catch (_) {}
        try { item.element?.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
        try { item.inputEl?.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
        try { item.element?.remove?.(); } catch (_) {}
        try { item.inputEl?.remove?.(); } catch (_) {}
    }
    if (Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((item) => !String(item?.name ?? "").startsWith("vvh3_combined_live_preview"));
    }
    node.__vvh3PreviewDisplay = null;
}

function syncLayout(display) {
    const size = Array.isArray(display.node?.size) ? display.node.size : [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
    const nodeWidth = Math.max(MIN_NODE_WIDTH, Number(size?.[0] ?? DEFAULT_NODE_WIDTH));
    const nodeHeight = Math.max(MIN_NODE_HEIGHT, Number(size?.[1] ?? DEFAULT_NODE_HEIGHT));
    const visualHeight = Math.max(340, nodeHeight - 58);
    const stageHeight = Math.max(280, nodeHeight - CHROME_VERTICAL);
    display.shell.style.height = `${visualHeight}px`;
    display.stage.style.minHeight = `${stageHeight}px`;
    display.stage.style.height = `${stageHeight}px`;
    // The widget reports only its intrinsic minimum. Reading the node height
    // back into computeSize creates a ComfyUI layout feedback loop where every
    // pass adds the canvas chrome again and grows the node indefinitely.
    display.widget.computeSize = (width) => [Math.max(MIN_NODE_WIDTH, width || MIN_NODE_WIDTH), display.layout.height];
    display.widget.options ??= {};
    display.widget.options.getMinHeight = () => display.layout.height;
    display.widget.options.getMaxHeight = () => Infinity;
    display.widget.options.getHeight = () => display.layout.height;
    display.node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function installResizeBinding(node) {
    if (node.__vvh3ResizeBound) return;
    node.__vvh3ResizeBound = true;
    node.resizable = true;
    const previous = typeof node.onResize === "function" ? node.onResize.bind(node) : null;
    node.onResize = function(size) {
        if (previous) {
            try { previous(size); } catch (_) {}
        }
        if (node.__vvh3PreviewDisplay) syncLayout(node.__vvh3PreviewDisplay);
    };
}

function installDisplay(node) {
    const current = (node.widgets ?? []).filter((item) => String(item?.name ?? "").startsWith("vvh3_combined_live_preview"));
    if (node.__vvh3PreviewDisplayVersion === VERSION && current.length === 1 && node.__vvh3PreviewDisplay) {
        syncLayout(node.__vvh3PreviewDisplay);
        return;
    }
    removeStaleDisplay(node);
    node.__vvh3PreviewDisplayVersion = VERSION;
    node.__vvSuppressCanvasChromeV1115 = true;
    installStyle();
    installListeners();
    installResizeBinding(node);
    for (const widget of node.widgets ?? []) hideWidget(widget);

    const shell = document.createElement("div"); shell.className = "vvh3-preview-shell vvh3-themed-preview"; shell.dataset.h3Role = "preview"; node.__vvh3Shell = shell;
    const head = document.createElement("div"); head.className = "vvh3-preview-head";
    const title = document.createElement("div"); title.className = "vvh3-preview-title";
    const badge = document.createElement("div"); badge.className = "vvh3-preview-badge";
    head.append(title, badge); shell.appendChild(head);

    const stage = document.createElement("div"); stage.className = "vvh3-preview-stage";
    const image = document.createElement("img"); image.alt = "VELVET VICE MiniMax H3 whole-shot live sampler preview"; image.draggable = false;
    const empty = document.createElement("div"); empty.className = "vvh3-preview-empty";
    stage.append(image, empty); shell.appendChild(stage);

    const foot = document.createElement("div"); foot.className = "vvh3-preview-foot";
    const details = document.createElement("span"); const counter = document.createElement("span");
    foot.append(details, counter); shell.appendChild(foot);

    const layout = { height: 560 };
    const widget = node.addDOMWidget("vvh3_combined_live_preview_runtime3", "H3 LIVE PREVIEW", shell, {
        serialize: false, hideOnZoom: false, margin: 0,
        getMinHeight: () => layout.height, getMaxHeight: () => Infinity, getHeight: () => layout.height,
    });
    widget.serialize = false;
    widget.serializeValue = () => undefined;
    widget.computeSize = (width) => [Math.max(MIN_NODE_WIDTH, width || DEFAULT_NODE_WIDTH), layout.height];

    const display = { node, widget, shell, stage, title, badge, image, empty, details, counter, layout, currentUrl: null, frameUrls: [], frameIndex: 0, animationId: null, lastTick: 0, targetFps: 24, actualFps: 0, fpsWindowStart: 0, fpsFrames: 0, frozen: false, watchdogId: null, lastStage: "READY" };
    displays.add(display);
    node.__vvh3PreviewDisplay = display;
    const currentWidth = Number(node.size?.[0] ?? 0);
    const currentHeight = Number(node.size?.[1] ?? 0);
    if (currentWidth < MIN_NODE_WIDTH || currentHeight < MIN_NODE_HEIGHT) {
        node.setSize?.([Math.max(DEFAULT_NODE_WIDTH, currentWidth || 0), Math.max(DEFAULT_NODE_HEIGHT, currentHeight || 0)]);
    }
    syncLayout(display);
    clearDisplay(display);
}

function reassert() {
    installStyle();
    for (const node of app.graph?._nodes ?? []) {
        if (nodeType(node) === DISPLAY_TYPE) installDisplay(node);
    }
}

app.registerExtension({
    name: "VelvetVice.MiniMaxH3.CombinedLivePreviewRuntime2",
    setup() { installStyle(); installListeners(); },
    nodeCreated(node) { if (nodeType(node) === DISPLAY_TYPE) installDisplay(node); },
    loadedGraphNode(node) { if (nodeType(node) === DISPLAY_TYPE) installDisplay(node); },
    afterConfigureGraph() {
        reassert();
        requestAnimationFrame(() => requestAnimationFrame(reassert));
        for (const delay of [250, 1000, 3000]) setTimeout(reassert, delay);
    },
    nodeRemoved(node) {
        const display = node.__vvh3PreviewDisplay;
        if (!display) return;
        stopWatchdog(display); revokeCurrent(display); displays.delete(display);
    },
});
