import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VERSION = "1.5.1";
const MARKER = "vv_design_system";
const STYLE_ID = "vv-h3-design-system-v140";
const HEADER_HEIGHT = 44;
const WIDGET_START_Y = 54;
const WIDGET_ROW_GAP = 4;
const PALETTE = Object.freeze({
    purple: "#6d5f82",
    purpleSoft: "#8b7a9f",
    slate: "#536779",
    slateSoft: "#6f8496",
    body: "#18212a",
    bodyRaised: "#202b35",
    bodyDeep: "#111820",
    border: "rgba(196,181,214,.38)",
    borderSoft: "rgba(196,181,214,.15)",
    text: "#eeeaf2",
    muted: "#a9b2bc",
    accent: "#c0afd2",
    ok: "#79a08f",
    warn: "#c1a36d",
    fail: "#bd7480",
});

// Nodes with a complete DOM surface already draw their own Velvet Vice header.
// They must not also receive the canvas header or the native LiteGraph title.
const FULL_PANEL_TYPES = new Set([
    "VelvetViceControlHub",
    "VelvetVicePreflightConsole",
    "VelvetViceMiniMaxH3OutputStudio",
    "VelvetViceMiniMaxH3PowerLoraAV",
    "VelvetViceLoraStudio",
]);

const themedNodes = new Set();
let activeNode = null;
let listenersInstalled = false;
let animationTimer = null;

function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function fitCanvasText(ctx, text, maxWidth) {
    const source = String(text ?? "");
    if (ctx.measureText(source).width <= maxWidth) return source;
    const suffix = "…";
    let low = 0;
    let high = source.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (ctx.measureText(source.slice(0, middle) + suffix).width <= maxWidth) low = middle;
        else high = middle - 1;
    }
    return source.slice(0, low) + suffix;
}

function nodeType(node) {
    return String(node?.comfyClass ?? node?.type ?? "");
}

function isZenNode(node) {
    const props = node?.properties ?? {};
    return nodeType(node).startsWith("VelvetViceZenMiniMaxH3")
        || props.vv_zen_h3_scope === true
        || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function isMainH3Graph() {
    return (app.graph?._nodes ?? []).some((node) =>
        !isZenNode(node) && nodeType(node).startsWith("VelvetViceMiniMaxH3")
    );
}

function marked(node) {
    const props = node?.properties ?? {};
    if (isZenNode(node)) return false;
    const belongsToMain = nodeType(node).startsWith("VelvetViceMiniMaxH3") || isMainH3Graph();
    return belongsToMain && Boolean(props[MARKER] || props.vv_design || props.vv_role || props.vv_badge);
}

function decorative(node) {
    const type = nodeType(node).toLowerCase();
    return type.includes("label") || type.includes("note") || type.includes("bookmark") || type.includes("reroute");
}

function fullPanel(node) {
    return FULL_PANEL_TYPES.has(nodeType(node));
}

function noteLike(node) {
    const type = nodeType(node).toLowerCase();
    return type.includes("note");
}

function chromeExcluded(node) {
    const type = nodeType(node).toLowerCase();
    return Boolean(node?.__vvSuppressCanvasChromeV1115 || node?.__vvSuppressCanvasChromeV1114) || fullPanel(node) || type.includes("label") || type.includes("bookmark") || type.includes("reroute") || type.includes("note");
}

function suppressNativeTitle(node) {
    if (!node || decorative(node) || node.__vvNativeTitleSuppressedV1115) return;
    node.__vvNativeTitleSuppressedV1115 = true;
    node.__vvDisplayTitle = String(node.title ?? nodeType(node) ?? "VELVET VICE");
    const originalGetTitle = typeof node.getTitle === "function" ? node.getTitle.bind(node) : null;
    node.__vvOriginalGetTitleV100 = originalGetTitle;
    // A zero-width title prevents LiteGraph from falling back to the class title.
    node.getTitle = function() { return "​"; };
    node.title_text_color = "rgba(0,0,0,0)";
    if (fullPanel(node)) {
        // ComfyUI frontend 1.48 exposes title_mode as a getter without a
        // setter. Shadow it on this node with LiteGraph's stable NO_TITLE
        // value so the empty native bar disappears without touching the
        // node's DOM controls or graph behavior.
        const noTitle = globalThis.LiteGraph?.NO_TITLE ?? 1;
        try {
            Object.defineProperty(node, "title_mode", {
                value: noTitle,
                writable: true,
                configurable: true,
                enumerable: false,
            });
        } catch (_) {}
    }
}

function reserveNativeWidgetLane(node) {
    if (!node || chromeExcluded(node) || decorative(node)) return;

    // LiteGraph supports a dedicated native-widget start position. The former
    // 52px paint-only header never moved this cursor, so the first black option
    // row was still drawn at the original title height and sat on top of the
    // colored header. Reserve the lane explicitly instead of painting over it.
    node.widgets_start_y = Math.max(Number(node.widgets_start_y ?? 0), WIDGET_START_Y);
    node.__vvHeaderHeight = HEADER_HEIGHT;

    const visibleWidgets = (node.widgets ?? []).filter(
        (item) => !item?.hidden && !item?.__vvHidden,
    );
    if (!visibleWidgets.length) return;

    let contentHeight = 0;
    for (const item of visibleWidgets) {
        let rowHeight = 20;
        try {
            const measured = item.computeSize?.(Math.max(80, Number(node.size?.[0] ?? 200) - 24));
            if (Array.isArray(measured) && Number.isFinite(measured[1])) {
                rowHeight = Math.max(20, Math.min(180, Number(measured[1])));
            }
        } catch (_) {}
        contentHeight += rowHeight + WIDGET_ROW_GAP;
    }
    const requiredHeight = Math.ceil(WIDGET_START_Y + contentHeight + 8);
    const currentWidth = Number(node.size?.[0] ?? 0);
    const currentHeight = Number(node.size?.[1] ?? 0);
    if (currentWidth > 0 && currentHeight > 0 && currentHeight < requiredHeight) {
        const next = [currentWidth, requiredHeight];
        node.setSize?.(next);
        if (node.size) node.size[1] = requiredHeight;
    }
}

function badgeFor(node) {
    const props = node?.properties ?? {};
    if (props.vv_badge) return String(props.vv_badge).toUpperCase().slice(0, 18);
    const type = nodeType(node).toLowerCase();
    const title = String(node?.title ?? "").toLowerCase();
    if (type.includes("velvetvicecontrol")) return "CONTROL";
    if (type.includes("preflight") || title.includes("preflight")) return "CHECK";
    if (type.includes("output") || title.includes("output")) return "OUTPUT";
    if (title.includes("director")) return "DIRECT";
    if (title.includes("lora")) return "LORA";
    if (title.includes("model") || title.includes("vae")) return "LOAD";
    if (title.includes("pass") || title.includes("core") || title.includes("sampler")) return "ENGINE";
    if (title.includes("quality") || title.includes("scale") || title.includes("rife")) return "QUALITY";
    if (title.includes("memory") || title.includes("checkpoint")) return "MEMORY";
    if (title.includes("watermark") || title.includes("finish")) return "FINISH";
    if (title.includes("system") || title.includes("diagnostic")) return "SYSTEM";
    return "H3";
}

function installCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --vv-purple:#6d5f82;--vv-purple-soft:#8b7a9f;--vv-slate:#536779;
        --vv-body:#18212a;--vv-raised:#202b35;--vv-deep:#111820;
        --vv-text:#eeeaf2;--vv-muted:#a9b2bc;--vv-accent:#c0afd2;
      }
      @keyframes vvGlow{0%,100%{filter:drop-shadow(0 0 4px rgba(180,159,204,.18))}50%{filter:drop-shadow(0 0 11px rgba(180,159,204,.43))}}
      @keyframes vvSweep{0%{background-position:0% 50%}100%{background-position:200% 50%}}
      .vv-shell{box-sizing:border-box;width:100%;font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--vv-text);background:linear-gradient(145deg,#151d25,#202b35);border:1px solid rgba(192,174,210,.28);border-radius:13px;overflow:hidden;box-shadow:0 10px 28px rgba(0,0,0,.27),inset 0 1px 0 rgba(255,255,255,.035)}
      .vv-shell *{box-sizing:border-box}.vv-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:linear-gradient(112deg,rgba(109,95,130,.94),rgba(83,103,121,.82));border-bottom:1px solid rgba(255,255,255,.085)}
      .vv-head:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,rgba(203,185,222,.72),rgba(111,137,158,.68),transparent)}
      .vv-brand{font-weight:850;letter-spacing:.115em;font-size:11px;color:#f3eef6;text-shadow:0 1px 10px rgba(0,0,0,.28)}
      .vv-badge{white-space:nowrap;font-size:9px;font-weight:850;letter-spacing:.09em;padding:5px 8px;border-radius:999px;background:rgba(17,24,32,.72);color:#d5c9df;border:1px solid rgba(218,204,232,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
      .vv-body{padding:12px}.vv-label{font-size:9px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:#acb5bf;margin:0 0 7px}
      .vv-panel{background:linear-gradient(145deg,rgba(31,42,52,.94),rgba(24,33,42,.94));border:1px solid rgba(190,176,207,.11);border-radius:10px;padding:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
      .vv-segments{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px;margin-bottom:12px}.vv-segment,.vv-button{appearance:none;border:1px solid rgba(190,178,205,.17);background:linear-gradient(145deg,#242f39,#202a34);color:#cdd3da;border-radius:9px;padding:9px 8px;font-weight:750;font-size:10px;cursor:pointer;transition:.14s ease}.vv-segment:hover,.vv-button:hover{border-color:rgba(200,184,218,.48);transform:translateY(-1px);box-shadow:0 5px 12px rgba(0,0,0,.18)}.vv-segment.active{background:linear-gradient(135deg,#716286,#50647a);color:#fff;border-color:rgba(221,208,234,.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
      .vv-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vv-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#202b35;border:1px solid rgba(255,255,255,.055);border-radius:9px;padding:10px 11px}.vv-toggle span{font-size:10px;font-weight:750;color:#d9dde2}.vv-switch{width:36px;height:20px;border-radius:999px;background:#394550;border:1px solid rgba(255,255,255,.07);padding:2px;cursor:pointer;transition:.15s}.vv-switch::after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:#aab3bd;transition:.15s}.vv-switch.on{background:linear-gradient(90deg,#746486,#52677d)}.vv-switch.on::after{transform:translateX(16px);background:#eee9f3}
      .vv-input,.vv-textarea{box-sizing:border-box;width:100%;background:#131b23;border:1px solid rgba(196,181,213,.15);color:#ece8f1;border-radius:8px;padding:10px 11px;outline:none}.vv-textarea{resize:vertical;min-height:150px;line-height:1.42}.vv-input:focus,.vv-textarea:focus{border-color:rgba(184,162,207,.56);box-shadow:0 0 0 3px rgba(116,92,139,.13)}
      .vv-foot{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:10px;font-size:9px;color:#929daa}.vv-dot{width:8px;height:8px;border-radius:50%;background:#7f8a96;box-shadow:0 0 0 3px rgba(127,138,150,.11)}.vv-dot.ok{background:#79a08f}.vv-dot.warn{background:#c1a36d}.vv-dot.fail{background:#bd7480}
      .vv-checks{display:flex;flex-direction:column;gap:6px;max-height:342px;overflow:auto;padding-right:2px}.vv-check{display:grid;grid-template-columns:11px 126px 1fr;gap:8px;align-items:start;background:#1a242e;border:1px solid rgba(255,255,255,.045);border-radius:8px;padding:7px 8px;font-size:9px}.vv-check strong{color:#d8dce1}.vv-check em{font-style:normal;color:#929ca7;overflow-wrap:anywhere}.vv-run{width:100%;margin:10px 0 8px;background:linear-gradient(135deg,#716286,#52677d);border-color:rgba(220,207,233,.27);color:white}
      .vv-stage-row{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:10px 0}.vv-stage{height:7px;border-radius:999px;background:#313d48;transition:.15s}.vv-stage.done{background:#687f92}.vv-stage.active{background:#9a86af;box-shadow:0 0 10px rgba(154,134,175,.31)}.vv-stage.error{background:#b9747e}.vv-status{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.vv-status-title{font-size:12px;font-weight:850;letter-spacing:.055em;color:#f0ecf3}.vv-status-detail{font-size:9px;color:#9ea8b2;margin-top:4px}.vv-progress-track{height:7px;border-radius:999px;background:#111820;overflow:hidden;margin-top:10px}.vv-progress{height:100%;width:0;background:linear-gradient(90deg,#746486,#6e879c);transition:width .12s linear}
      .vv-video-frame{display:none;margin:12px auto 0;border-radius:10px;background:#070a0e;overflow:hidden;align-items:center;justify-content:center;border:1px solid rgba(194,177,211,.2);box-sizing:border-box;box-shadow:0 8px 20px rgba(0,0,0,.24);max-width:100%}.vv-video-frame.visible{display:flex}.vv-video-frame.portrait{box-shadow:0 9px 26px rgba(0,0,0,.31),0 0 0 1px rgba(177,157,200,.08)}.vv-video{display:block;width:100%;height:100%;object-fit:contain;background:#070a0e}.vv-video-meta{margin-top:7px;text-align:center;color:#919ca7;font-size:9px;letter-spacing:.045em}.vv-empty{margin-top:10px;padding:18px 10px;text-align:center;border-radius:9px;border:1px dashed rgba(185,171,201,.16);color:#7f8a95;font-size:10px;background:#151d25}.vv-advanced{margin-top:10px;border-top:1px solid rgba(255,255,255,.06);padding-top:9px}.vv-advanced summary{cursor:pointer;color:#aeb7c1;font-size:9px;font-weight:750}.vv-advanced-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:8px}.vv-mini{width:100%;box-sizing:border-box;background:#131b23;color:#d9dde2;border:1px solid rgba(255,255,255,.075);border-radius:7px;padding:7px;font-size:9px}
      .vv-prompt-meta{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px}.vv-chip{font-size:9px;font-weight:800;letter-spacing:.06em;padding:5px 7px;border-radius:999px;background:#26333f;color:#c9d0d7;border:1px solid rgba(255,255,255,.06)}
    `;
    document.head.appendChild(style);
}

function drawBody(ctx, node, width, height, titleHeight) {
    if (height <= titleHeight + 2) return;
    const grad = ctx.createLinearGradient(0, titleHeight, width, height);
    grad.addColorStop(0, "rgba(16,33,43,.99)");
    grad.addColorStop(.55, "rgba(17,29,40,.99)");
    grad.addColorStop(1, "rgba(12,24,33,.99)");
    ctx.fillStyle = grad;
    roundRect(ctx, 1.2, titleHeight - 1, width - 2.4, height - titleHeight, 9);
    ctx.fill();

    const sheen = ctx.createLinearGradient(0, titleHeight, width, titleHeight);
    sheen.addColorStop(0, "rgba(21,188,150,.22)");
    sheen.addColorStop(.5, "rgba(59,159,209,.15)");
    sheen.addColorStop(1, "rgba(174,98,212,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(8, titleHeight + 2, Math.max(0, width - 16), 1);

    // Subtle card lanes behind normal widget rows. This keeps native widgets usable
    // while giving them the same raised-panel language as the custom DOM modules.
    if (!decorative(node)) {
        for (const item of node.widgets ?? []) {
            if (item?.hidden || item?.__vvHidden || !Number.isFinite(item?.last_y)) continue;
            const y = Number(item.last_y) - 2;
            if (y < titleHeight + 2 || y > height - 10) continue;
            let h = 22;
            try {
                const measured = item.computeSize?.(Math.max(80, width - 20));
                if (Array.isArray(measured) && Number.isFinite(measured[1])) h = Math.max(20, Math.min(120, measured[1] + 2));
            } catch (_) {}
            ctx.fillStyle = "rgba(18,34,46,.72)";
            ctx.strokeStyle = "rgba(73,158,181,.19)";
            ctx.lineWidth = .7;
            roundRect(ctx, 8, y, Math.max(30, width - 16), Math.min(h, height - y - 5), 7);
            ctx.fill();
            ctx.stroke();
        }
    }
}

function drawHeader(ctx, node, width, titleHeight) {
    const state = node.__vvExecutionState ?? "idle";
    const active = state === "active";
    const error = state === "error";
    const phase = (Date.now() % 1600) / 1600;

    const grad = ctx.createLinearGradient(0, 0, width, titleHeight);
    grad.addColorStop(0, error ? "#a44e63" : String(node.color || "#1e918c"));
    grad.addColorStop(.58, error ? "#7b4450" : String(node.boxcolor || "#397ea6"));
    grad.addColorStop(1, error ? "#5d3440" : "#1e918c");
    ctx.fillStyle = grad;
    roundRect(ctx, 1.2, 1.2, width - 2.4, titleHeight, 9);
    ctx.fill();
    ctx.fillRect(1.2, titleHeight - 8, width - 2.4, 8);

    const accent = ctx.createLinearGradient(0, 0, width, 0);
    accent.addColorStop(0, error ? "rgba(212,112,128,.9)" : "rgba(21,188,150,.92)");
    accent.addColorStop(.56, error ? "rgba(212,112,128,.6)" : "rgba(59,159,209,.86)");
    accent.addColorStop(1, error ? "rgba(212,112,128,0)" : "rgba(174,98,212,0)");
    ctx.fillStyle = accent;
    ctx.fillRect(8, titleHeight - 2, Math.max(0, width - 16), 2);

    if (active) {
        const sweep = ctx.createLinearGradient(-width + phase * width * 2, 0, phase * width * 2, 0);
        sweep.addColorStop(.35, "rgba(255,255,255,0)");
        sweep.addColorStop(.5, "rgba(235,226,244,.18)");
        sweep.addColorStop(.65, "rgba(255,255,255,0)");
        ctx.fillStyle = sweep;
        ctx.fillRect(1, 1, width - 2, titleHeight - 2);
    }

    const dotColor = error ? PALETTE.fail : active ? "#25d5b0" : String(node.boxcolor || "#55a8bd");
    ctx.fillStyle = "rgba(15,21,28,.68)";
    ctx.beginPath();
    ctx.arc(15, titleHeight / 2, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(15, titleHeight / 2, active ? 3.2 + Math.sin(phase * Math.PI * 2) * .55 : 3, 0, Math.PI * 2);
    ctx.fill();

    const title = String(node.__vvDisplayTitle ?? node.title ?? nodeType(node) ?? "VELVET VICE");
    ctx.font = "700 12px Inter, Segoe UI, Arial";
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTitle = Math.max(70, width - 240);
    ctx.fillText(fitCanvasText(ctx, title, maxTitle), width / 2, titleHeight / 2 + .5);
}

function applyTheme(node) {
    if (!node || !marked(node)) return;
    if (node.__vvSignatureThemeV1115) {
        reserveNativeWidgetLane(node);
        return;
    }
    node.__vvSignatureThemeV1115 = true;
    node.__vvExecutionState = node.__vvExecutionState ?? "idle";
    themedNodes.add(node);

    node.color = PALETTE.purple;
    node.bgcolor = PALETTE.body;
    node.boxcolor = PALETTE.accent;
    const customChrome = !chromeExcluded(node);
    suppressNativeTitle(node);
    try {
        if (globalThis.LiteGraph?.ROUND_SHAPE != null) node.shape = globalThis.LiteGraph.ROUND_SHAPE;
    } catch (_) {}

    const isFullDOMPanel = fullPanel(node);
    // Full DOM panels already contain their one authoritative header. Do not
    // call a previously installed design-system wrapper for those nodes: an
    // old cached wrapper would paint a second canvas header above the DOM one.
    const originalBackground = isFullDOMPanel ? null : node.onDrawBackground;
    node.onDrawBackground = function(ctx) {
        originalBackground?.apply(this, arguments);
        if (!marked(this) || chromeExcluded(this)) return;
        const width = Number(this.size?.[0] ?? 0);
        const height = Number(this.size?.[1] ?? 0);
        if (width < 40 || height < 20) return;
        const titleHeight = Number(this.__vvHeaderHeight ?? HEADER_HEIGHT);
        ctx.save();
        drawBody(ctx, this, width, height, titleHeight);
        ctx.restore();
    };

    const originalForeground = isFullDOMPanel ? null : node.onDrawForeground;
    node.onDrawForeground = function(ctx) {
        originalForeground?.apply(this, arguments);
        if (!marked(this) || fullPanel(this)) return;
        const width = Number(this.size?.[0] ?? 0);
        const height = Number(this.size?.[1] ?? 0);
        if (width < 40 || height < 20) return;
        const titleHeight = Number(this.__vvHeaderHeight ?? HEADER_HEIGHT);
        ctx.save();
        if (!chromeExcluded(this)) drawHeader(ctx, this, width, titleHeight);

        const state = this.__vvExecutionState ?? "idle";
        ctx.lineWidth = state === "active" ? 2.1 : 1.1;
        ctx.strokeStyle = state === "error" ? "rgba(210,113,128,.75)" : String(this.boxcolor || "#3b9fd1");
        if (state === "active") {
            ctx.shadowColor = String(this.boxcolor || "#15bc96");
            ctx.shadowBlur = 12;
        }
        roundRect(ctx, .8, .8, width - 1.6, height - 1.6, 9);
        ctx.stroke();

        if (!chromeExcluded(this)) {
            ctx.fillStyle = state === "active" ? "rgba(21,188,150,.72)" : "rgba(59,159,209,.38)";
            roundRect(ctx, 4.5, titleHeight + 7, 3, Math.max(10, height - titleHeight - 14), 2);
            ctx.fill();
        }
        ctx.restore();
    };
    reserveNativeWidgetLane(node);
    setTimeout(() => reserveNativeWidgetLane(node), 0);
    setTimeout(() => reserveNativeWidgetLane(node), 250);
    node.setDirtyCanvas?.(true, true);
}

function resolveNode(id) {
    if (id == null) return null;
    const raw = String(id);
    const top = Number(raw.split(":")[0]);
    return app.graph?.getNodeById?.(top) ?? app.graph?._nodes?.find((n) => String(n.id) === raw) ?? null;
}

function setState(node, state) {
    if (!node) return;
    applyTheme(node);
    node.__vvExecutionState = state;
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function resetStates(state = "idle") {
    for (const node of themedNodes) setState(node, state);
}

function activateNode(id) {
    const next = resolveNode(id);
    if (activeNode && activeNode !== next && activeNode.__vvExecutionState === "active") setState(activeNode, "done");
    activeNode = next;
    if (next) setState(next, "active");
}

function installExecutionStyling() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    api.addEventListener("execution_start", () => {
        activeNode = null;
        resetStates("idle");
    });
    api.addEventListener("executing", ({ detail }) => {
        const id = detail?.node ?? detail;
        if (id == null) {
            if (activeNode) setState(activeNode, "done");
            activeNode = null;
            return;
        }
        activateNode(id);
    });
    api.addEventListener("progress", ({ detail }) => activateNode(detail?.node));
    api.addEventListener("executed", ({ detail }) => {
        const node = resolveNode(detail?.node);
        if (node) setState(node, "done");
    });
    api.addEventListener("execution_error", ({ detail }) => {
        const node = resolveNode(detail?.node_id ?? detail?.node);
        setState(node ?? activeNode, "error");
        activeNode = null;
    });
    api.addEventListener("execution_interrupted", () => {
        if (activeNode) setState(activeNode, "error");
        activeNode = null;
    });
    api.addEventListener("execution_success", () => {
        if (activeNode) setState(activeNode, "done");
        activeNode = null;
        setTimeout(() => {
            for (const node of themedNodes) {
                if (node.__vvExecutionState === "done") setState(node, "idle");
            }
        }, 2600);
    });
    animationTimer = setInterval(() => {
        if (activeNode?.__vvExecutionState === "active") {
            activeNode.setDirtyCanvas?.(true, true);
            app.graph?.setDirtyCanvas?.(true, false);
        }
    }, 90);
}

function themeGroups() {
    if (!isMainH3Graph()) return;
    for (const group of app.graph?._groups ?? []) {
        group.color = "#293642";
        if (Number.isFinite(group.font_size)) group.font_size = Math.max(16, Math.min(25, group.font_size));
    }
}

function themeGraph() {
    installCss();
    if (!isMainH3Graph()) return;
    for (const node of app.graph?._nodes ?? []) applyTheme(node);
    themeGroups();
}

window.VelvetViceH3Design = Object.freeze({
    version: VERSION,
    palette: PALETTE,
    installCss,
    applyTheme,
    themeGraph,
});

app.registerExtension({
    name: "VelvetVice.MiniMaxH3.FullSignatureDesignSystemV140",
    setup() {
        installCss();
        installExecutionStyling();
        setTimeout(themeGraph, 0);
    },
    nodeCreated(node) {
        applyTheme(node);
        setTimeout(themeGroups, 0);
    },
    loadedGraphNode(node) {
        applyTheme(node);
        setTimeout(themeGraph, 0);
    },
});
