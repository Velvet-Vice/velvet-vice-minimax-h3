import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "VelvetViceMiniMaxH3LivePreviewDisplay";
const EVENT_NAME = "velvet_vice.h3_live_preview";
const VERSION = "1.0.0";
const displays = new Set();
let listenersInstalled = false;

function typeOf(node) { return node?.comfyClass ?? node?.type; }

function installStyle() {
    if (document.getElementById("vvh3-live-preview-style")) return;
    const style = document.createElement("style");
    style.id = "vvh3-live-preview-style";
    style.textContent = `
      .vvh3-live-shell{box-sizing:border-box;width:100%;height:100%;padding:10px;border-radius:10px;background:linear-gradient(145deg,#171f28,#202b36);color:#dfe5ea;font-family:Inter,Arial,sans-serif;display:flex;flex-direction:column;gap:8px;overflow:hidden}
      .vvh3-live-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}.vvh3-live-title{font-size:10px;font-weight:900;letter-spacing:.06em}.vvh3-live-badge{font-size:8px;font-weight:900;padding:4px 7px;border-radius:999px;background:#15221c;color:#a7d4b3;border:1px solid rgba(145,205,163,.2)}
      .vvh3-live-stage{position:relative;flex:1;min-height:300px;border-radius:8px;overflow:hidden;background:#0b1015;border:1px solid rgba(195,180,214,.12);display:flex;align-items:center;justify-content:center}.vvh3-live-stage img{width:100%;height:100%;object-fit:contain;display:none}.vvh3-live-empty{padding:24px;text-align:center;font-size:9px;line-height:1.5;color:#83909b}
      .vvh3-live-foot{display:flex;justify-content:space-between;gap:10px;font-size:8px;color:#97a5b0}.vvh3-live-foot span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.appendChild(style);
}

function stop(display) {
    if (display.timer != null) clearInterval(display.timer);
    display.timer = null;
}

function showFrame(display, index) {
    if (!display.frames.length) return;
    display.index = Math.max(0, Math.min(display.frames.length - 1, index));
    display.image.src = display.frames[display.index];
    display.image.style.display = "block";
    display.empty.style.display = "none";
}

function start(display) {
    stop(display);
    if (display.frames.length <= 1) return;
    const fps = Math.max(0.5, Math.min(30, Number(display.playbackFps || 6)));
    display.timer = setInterval(() => {
        if (!display.frames.length) return;
        showFrame(display, (display.index + 1) % display.frames.length);
    }, 1000 / fps);
}

function clear(display, message, badge = "READY") {
    stop(display);
    display.frames = [];
    display.index = 0;
    display.image.removeAttribute("src");
    display.image.style.display = "none";
    display.empty.style.display = "block";
    display.empty.textContent = message;
    display.badge.textContent = badge;
    display.title.textContent = "MINIMAX H3 · REAL-TIME LIVE PREVIEW";
    display.details.textContent = "Sampler preview · latest-frame-wins · render-safe";
}

function update(display, detail) {
    const width = Number(detail?.width ?? 0);
    const height = Number(detail?.height ?? 0);
    const encoded = Array.isArray(detail?.images)
        ? detail.images.filter((v) => typeof v === "string" && v.length)
        : [];
    if (!encoded.length || width <= 0 || height <= 0) return;

    stop(display); // latest-frame-wins: never queue old callback buffers
    const mime = detail?.mime || "image/jpeg";
    display.frames = encoded.map((item) => `data:${mime};base64,${item}`);
    display.index = 0;
    display.playbackFps = Math.max(0.5, Math.min(30, Number(detail?.source_playback_fps ?? 6)));
    const step = Number(detail?.step ?? 0);
    const steps = Math.max(1, Number(detail?.steps ?? 1));
    const seconds = Number(detail?.timeline_duration_seconds ?? 0);
    display.title.textContent = `${width} × ${height} · H3 LATENT PREVIEW`;
    display.badge.textContent = `STEP ${step}/${steps}`;
    display.details.textContent = `${seconds.toFixed(2)}s timeline · native 24 FPS · ${encoded.length} preview token frame(s)`;
    showFrame(display, 0);
    start(display);
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    api.addEventListener(EVENT_NAME, ({ detail }) => {
        for (const display of displays) update(display, detail);
    });
    api.addEventListener("execution_start", () => {
        for (const display of displays) clear(display, "Render started. Waiting for H3 sampler preview…", "STARTING");
    });
    api.addEventListener("execution_error", () => {
        for (const display of displays) { stop(display); display.badge.textContent = "ERROR"; }
    });
    api.addEventListener("execution_interrupted", () => {
        for (const display of displays) { stop(display); display.badge.textContent = "STOPPED"; }
    });
    api.addEventListener("execution_success", () => {
        for (const display of displays) { stop(display); display.badge.textContent = "COMPLETE"; }
    });
}

function installDisplay(node) {
    if (node.__vvh3LiveInstalled) return;
    node.__vvh3LiveInstalled = true;
    node.__vvSuppressCanvasChromeV1115 = true;
    installStyle();
    installListeners();

    const shell = document.createElement("div");
    shell.className = "vvh3-live-shell";
    const meta = document.createElement("div"); meta.className = "vvh3-live-meta";
    const title = document.createElement("div"); title.className = "vvh3-live-title";
    const badge = document.createElement("div"); badge.className = "vvh3-live-badge";
    meta.append(title, badge); shell.appendChild(meta);
    const stage = document.createElement("div"); stage.className = "vvh3-live-stage";
    const image = document.createElement("img"); image.alt = "MiniMax H3 live sampler preview"; image.draggable = false;
    const empty = document.createElement("div"); empty.className = "vvh3-live-empty";
    stage.append(image, empty); shell.appendChild(stage);
    const foot = document.createElement("div"); foot.className = "vvh3-live-foot";
    const details = document.createElement("span"); const version = document.createElement("span"); version.textContent = `v${VERSION}`;
    foot.append(details, version); shell.appendChild(foot);

    const widget = node.addDOMWidget("vvh3_live_preview", "H3 LIVE PREVIEW", shell, {
        serialize: false, hideOnZoom: false, margin: 0,
        getMinHeight: () => 410, getMaxHeight: () => 410, getHeight: () => 410,
    });
    widget.serialize = false; widget.serializeValue = () => undefined;
    const display = { node, shell, title, badge, stage, image, empty, details, frames: [], index: 0, playbackFps: 6, timer: null };
    displays.add(display); node.__vvh3LiveDisplay = display;
    clear(display, "Queue a render to start the MiniMax H3 sampler preview.", "READY");
    node.setSize?.([850, 500]);
}

app.registerExtension({
    name: "VelvetVice.MiniMaxH3.LivePreviewV100",
    nodeCreated(node) { if (typeOf(node) === NODE_TYPE) installDisplay(node); },
    loadedGraphNode(node) { if (typeOf(node) === NODE_TYPE) installDisplay(node); },
    afterConfigureGraph() { for (const node of app.graph?._nodes ?? []) if (typeOf(node) === NODE_TYPE) installDisplay(node); },
    nodeRemoved(node) { const d = node.__vvh3LiveDisplay; if (d) { stop(d); displays.delete(d); } },
});
