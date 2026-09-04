import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const HUB_TYPE = "VelvetViceControlHub";
const PREFLIGHT_TYPE = "VelvetVicePreflightConsole";
const OUTPUT_TYPE = "VelvetViceMiniMaxH3OutputStudio";
const LORA_TYPE = "VelvetViceMiniMaxH3PowerLoraAV";
const MODEL_LOADOUT_TYPE = "8c71665b-ab34-421b-96d5-fa30283a93a8";
const RENDER_ENGINE_TYPE = "7df62195-cb50-4fb2-bd93-7bcfde31b12d";
const MINIMAX_PROMPT_DIRECTOR_TYPE = "VelvetViceMiniMaxH3PromptDirector";
const MINIMAX_FINAL_PROMPT_TYPE = "VelvetViceMiniMaxH3FinalPromptPreview";
const WATERMARK_TYPE = "VelvetViceMiniMaxH3WatermarkOverlay";
const PACK_VERSION = "1.4.0";

const liveOutputs = new Set();
const outputStudioMedia = new Set();

function hardStopOutputMedia(media) {
    if (!media) return;
    try { media.pause?.(); } catch (_) {}
    try { media.muted = true; } catch (_) {}
    try { media.volume = 0; } catch (_) {}
    try { media.removeAttribute?.("src"); } catch (_) {}
    try { media.srcObject = null; } catch (_) {}
    try { media.load?.(); } catch (_) {}
    outputStudioMedia.delete(media);
}

function stopOtherOutputMedia(activeMedia) {
    for (const media of [...outputStudioMedia]) {
        if (!media || media === activeMedia) continue;
        try { media.pause?.(); } catch (_) {}
    }
}

function stopNodeOutputMedia(node, { hard = false } = {}) {
    const candidates = new Set();
    if (node?.__vvOutputVideo) candidates.add(node.__vvOutputVideo);
    const shell = node?.__vvOutputShell;
    if (shell?.matches?.("video, audio")) candidates.add(shell);
    for (const media of shell?.querySelectorAll?.("video, audio") ?? []) candidates.add(media);
    for (const media of candidates) {
        if (hard) hardStopOutputMedia(media);
        else { try { media.pause?.(); } catch (_) {} }
    }
    if (hard) node.__vvOutputVideo = null;
}

function purgeLegacyOutputPreview(node) {
    if (!node || !Array.isArray(node.widgets)) return;
    const legacy = node.widgets.filter((item) =>
        String(item?.name ?? "") === "velvet_vice_final_video_preview"
    );
    for (const item of legacy) {
        const roots = [item?.element, item?.inputEl].filter(Boolean);
        for (const root of roots) {
            if (root?.matches?.("video, audio")) hardStopOutputMedia(root);
            for (const media of root?.querySelectorAll?.("video, audio") ?? []) hardStopOutputMedia(media);
            try { root.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
            try { root.remove?.(); } catch (_) {}
        }
        try { item.onRemove?.(); } catch (_) {}
    }
    if (legacy.length) node.widgets = node.widgets.filter((item) => !legacy.includes(item));
}
const liveEngines = new Set();
let globalListenersInstalled = false;
let styleInstalled = false;
const PANEL_STYLE_ID = "vv-h3-panel-suite-v140";
const OUTPUT_STUDIO_VERSION = "1.4.0-h3-standalone";
const CABLE_SAFE_TYPES = new Set([
    HUB_TYPE,
    PREFLIGHT_TYPE,
    OUTPUT_TYPE,
    LORA_TYPE,
    MODEL_LOADOUT_TYPE,
    RENDER_ENGINE_TYPE,
    MINIMAX_PROMPT_DIRECTOR_TYPE,
    MINIMAX_FINAL_PROMPT_TYPE,
    WATERMARK_TYPE,
]);

function installStyle() {
    window.VelvetViceH3Design?.installCss?.();
    const existing = document.getElementById(PANEL_STYLE_ID);
    if (existing) {
        // A merged install can append stale v1.0-v1.1.11 styles after this
        // release. Moving the current sheet to the end restores the intended
        // spinner widths without changing any node or workflow value.
        if (document.head.lastElementChild !== existing) document.head.appendChild(existing);
        styleInstalled = true;
        return;
    }
    styleInstalled = false;
    styleInstalled = true;
    const style = document.createElement("style");
    style.id = PANEL_STYLE_ID;
    style.textContent = `
      .vv-shell,.vv-shell *{box-sizing:border-box}
      /* Pointer-safety: decorative DOM surfaces must never create invisible
         click barriers over the ComfyUI canvas. Only actual controls and
         scrollable/interactive media regions receive pointer events. */
      .vv-shell{pointer-events:none}
      .vv-shell .vv-head{pointer-events:auto;cursor:grab;touch-action:none;user-select:none}
      .vv-shell .vv-head.vv-dragging{cursor:grabbing}
      .vv-shell button,.vv-shell input,.vv-shell select,.vv-shell textarea,.vv-shell summary,.vv-shell details,.vv-shell video,.vv-shell a,.vv-shell .vv-checks,.vv-shell .vv-lora-stack-list,.vv-shell .vv-power-list,.vv-shell .vv-player-shell,.vv-shell .vv-video-frame{pointer-events:auto}
      .vv-shell{width:100%;min-width:0;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#e8e5ec;background:linear-gradient(145deg,#171f28,#202b36);border:1px solid rgba(171,151,194,.22);border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.22);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
      .vv-head{position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto;place-items:center;align-content:center;gap:5px;min-height:64px;padding:9px 130px 8px;text-align:center;background:linear-gradient(115deg,rgba(111,91,134,.76),rgba(64,77,94,.68));border-bottom:1px solid rgba(255,255,255,.08)}
      .vv-brand{display:block;width:100%;min-width:0;font-weight:850;letter-spacing:.10em;line-height:1.25;font-size:11px;color:#f1edf4;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 8px rgba(0,0,0,.24)}
      .vv-badge{display:block;max-width:190px;min-width:0;font-size:8px;line-height:1.15;text-align:center;font-weight:850;letter-spacing:.08em;padding:4px 8px;border-radius:999px;background:rgba(18,24,31,.78);color:#c8b9d8;border:1px solid rgba(200,185,216,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vv-body{padding:12px;min-width:0}.vv-label{font-size:10px;line-height:1.35;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#aeb6c0;margin:0 0 7px}
      .vv-segments{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:12px}
      .vv-segment,.vv-button{appearance:none;min-width:0;border:1px solid rgba(190,178,205,.2);background:#242d38;color:#cbd1d8;border-radius:8px;padding:9px 8px;font-weight:700;font-size:10px;line-height:1.2;cursor:pointer;transition:.14s ease;white-space:normal;overflow-wrap:anywhere}.vv-segment:hover,.vv-button:hover{border-color:rgba(190,170,214,.55);transform:translateY(-1px)}.vv-segment.active{background:linear-gradient(135deg,#716286,#52677d);color:#fff;border-color:rgba(213,198,229,.5)}
      .vv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.vv-toggle{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;background:#202b36;border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:10px 11px}.vv-toggle span{min-width:0;font-size:10px;line-height:1.3;font-weight:700;color:#d7dbe0;overflow-wrap:anywhere}.vv-switch{flex:0 0 auto;width:36px;height:20px;border-radius:999px;background:#394550;border:1px solid rgba(255,255,255,.08);padding:2px;cursor:pointer;transition:.15s}.vv-switch::after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:#aab3bd;transition:.15s}.vv-switch.on{background:#746486}.vv-switch.on::after{transform:translateX(16px);background:#eee9f3}
      .vv-input{width:100%;min-width:0;background:#151d25;border:1px solid rgba(196,181,213,.18);color:#e9e6ed;border-radius:8px;padding:10px 11px;outline:none}.vv-input:focus{border-color:rgba(184,162,207,.65);box-shadow:0 0 0 3px rgba(116,92,139,.16)}
      .vv-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:7px 12px;align-items:center;margin-top:10px;font-size:9px;line-height:1.35;color:#929daa}.vv-foot>*{min-width:0;overflow-wrap:anywhere}.vv-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#7f8a96;box-shadow:0 0 0 3px rgba(127,138,150,.12)}.vv-dot.ok{background:#72a18e}.vv-dot.warn{background:#c7a86a}.vv-dot.fail{background:#bf6f7c}
      .vv-checks{display:flex;flex-direction:column;gap:6px;max-height:342px;overflow:auto;padding-right:2px}.vv-check{display:grid;grid-template-columns:11px minmax(96px,126px) minmax(0,1fr);gap:8px;align-items:start;background:#1b2530;border:1px solid rgba(255,255,255,.055);border-radius:7px;padding:7px 8px;font-size:9px;line-height:1.35}.vv-check strong,.vv-check em{min-width:0;overflow-wrap:anywhere}.vv-check strong{color:#d4d8dd}.vv-check em{font-style:normal;color:#929ca7}.vv-run{width:100%;margin:10px 0 8px;background:linear-gradient(135deg,#716286,#52677d);border-color:rgba(220,207,233,.32);color:white}
      .vv-stage-row{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:10px 0}.vv-stage{height:7px;border-radius:999px;background:#313d48;transition:.15s}.vv-stage.done{background:#687f92}.vv-stage.active{background:#9a86af;box-shadow:0 0 10px rgba(154,131,175,.38)}.vv-stage.error{background:#bb6c78}.vv-status{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 12px;align-items:flex-start}.vv-status>*{min-width:0}.vv-status-title{font-size:12px;line-height:1.3;font-weight:850;letter-spacing:.045em;color:#eeeaf2;overflow-wrap:anywhere}.vv-status-detail{font-size:9px;line-height:1.4;color:#9ea8b2;margin-top:4px;overflow-wrap:anywhere}.vv-progress-track{height:7px;border-radius:999px;background:#141b22;overflow:hidden;margin-top:10px}.vv-progress{height:100%;width:0;background:linear-gradient(90deg,#746486,#6e879c);transition:width .12s linear}.vv-video-frame{display:none;margin-top:10px;border-radius:9px;background:#080b0f;overflow:hidden;align-items:center;justify-content:center;border:1px solid rgba(185,171,201,.13)}.vv-video-frame.visible{display:flex}.vv-video{display:block;width:auto;height:auto;object-fit:contain;background:#080b0f}.vv-video-meta{margin-top:6px;text-align:center;color:#8f9aa6;font-size:9px;line-height:1.35;letter-spacing:.035em;overflow-wrap:anywhere}.vv-empty{margin-top:10px;padding:18px 10px;text-align:center;border-radius:9px;border:1px dashed rgba(185,171,201,.18);color:#7f8a95;font-size:10px;line-height:1.4;background:#151d25;overflow-wrap:anywhere}.vv-advanced{margin-top:10px;border-top:1px solid rgba(255,255,255,.07);padding-top:9px}.vv-advanced summary{cursor:pointer;color:#aeb7c1;font-size:10px;font-weight:750}.vv-advanced-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:8px}.vv-mini{width:100%;min-width:0;background:#151d25;color:#d9dde2;border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:7px;font-size:10px}
      .vv-h3-output-studio{background:linear-gradient(145deg,#131b24,#1b2631);border-color:rgba(177,148,202,.24)}.vv-h3-output-studio .vv-head{background:linear-gradient(115deg,rgba(94,72,115,.76),rgba(44,61,77,.72))}.vv-h3-output-studio .vv-status{padding:10px;border:1px solid rgba(177,151,201,.11);border-radius:9px;background:#111920}.vv-h3-output-studio .vv-status-title{font-size:11px}.vv-h3-output-studio .vv-progress-track{height:6px;background:#0d141a}.vv-h3-output-studio .vv-progress{background:linear-gradient(90deg,#725487,#8a6ca0)}
      .vv-h3-stage-row{grid-template-columns:repeat(5,minmax(66px,1fr));gap:6px;overflow-x:auto;padding:1px 0 3px;margin:10px 0 6px}.vv-h3-stage{height:38px!important;border-radius:8px!important;background:#111a22!important;border:1px solid rgba(180,160,198,.10);display:flex;align-items:center;justify-content:center;gap:6px;padding:0 7px;color:#7f8b96;box-shadow:none!important;white-space:nowrap}.vv-h3-stage-dot{display:grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#25313c;color:#91a0ad;font-size:7px;font-weight:900}.vv-h3-stage-name{font-size:7.5px;font-weight:900;letter-spacing:.06em}.vv-h3-stage.done{background:#14221f!important;border-color:rgba(111,180,145,.20);color:#9bcab0}.vv-h3-stage.done .vv-h3-stage-dot{background:#1b4433;color:#a8d7ba}.vv-h3-stage.active{background:linear-gradient(135deg,#2b2235,#1b2631)!important;border-color:rgba(181,139,211,.38);color:#d7c2e4}.vv-h3-stage.active .vv-h3-stage-dot{background:#684d7b;color:#f0e7f5}.vv-h3-stage.error{background:#30191d!important;border-color:rgba(202,104,119,.35);color:#e0a0aa}.vv-h3-stage.error .vv-h3-stage-dot{background:#6a3039;color:#f5c0c7}
      .vv-h3-output-studio .vv-player-shell{margin-top:4px;padding:7px;border:1px solid rgba(177,151,201,.10);border-radius:10px;background:#0d1319}.vv-h3-output-studio .vv-video-frame{margin-top:0;border-radius:8px}.vv-h3-output-studio .vv-empty{margin-top:0;padding:28px 12px;background:#0e151c}.vv-h3-output-studio .vv-advanced{border:1px solid rgba(177,151,201,.10);border-radius:8px;padding:0;background:#111920;overflow:hidden}.vv-h3-output-studio .vv-advanced summary{padding:9px 10px;font-size:8px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.vv-h3-output-studio .vv-advanced-grid{padding:0 9px 9px}
      .vv-module-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.vv-module-card{min-width:0;overflow:hidden;background:linear-gradient(145deg,#202b36,#18212a);border:1px solid rgba(196,181,214,.10);border-radius:10px;padding:10px}.vv-module-card.wide{grid-column:1/-1}.vv-module-title{font-size:9px;line-height:1.3;font-weight:850;letter-spacing:.09em;color:#b9c1ca;text-transform:uppercase;margin-bottom:8px;overflow-wrap:anywhere}.vv-module-value{font-size:9px;line-height:1.35;color:#d9dde2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vv-control-row{display:flex;flex-direction:column;gap:5px;min-width:0;margin-top:9px}.vv-control-row label{min-width:0;padding-left:2px;font-size:9px;line-height:1.3;color:#9fa9b4;overflow-wrap:anywhere}.vv-control-row select,.vv-control-row input{display:block;width:100%;min-width:0;height:32px;margin:0;background:#121a22;color:#e3e0e7;border:1px solid rgba(196,181,214,.17);border-radius:8px;padding:0 11px;font-size:9.5px;line-height:30px;text-overflow:ellipsis;outline:none}.vv-control-row select:focus,.vv-control-row input:focus{border-color:rgba(190,168,213,.52);box-shadow:0 0 0 2px rgba(112,91,135,.13)}.vv-control-row>div{min-width:0}
      .vv-pass-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}.vv-pass-card{min-width:0;position:relative;background:linear-gradient(145deg,#202b36,#171f28);border:1px solid rgba(196,181,214,.11);border-radius:10px;padding:12px 10px;transition:.18s}.vv-pass-card.active{border-color:rgba(204,185,224,.5);box-shadow:0 0 18px rgba(139,113,165,.22);transform:translateY(-1px)}.vv-pass-card.done{border-color:rgba(111,145,130,.34)}.vv-pass-name{font-size:10px;line-height:1.3;font-weight:850;color:#ece7f1;letter-spacing:.06em;overflow-wrap:anywhere}.vv-pass-meta{font-size:9px;line-height:1.35;color:#929da8;margin-top:5px;overflow-wrap:anywhere}
      .vv-lora-intro{font-size:10px;line-height:1.45;color:#aeb7c1;margin-bottom:10px}.vv-lora-section{display:flex;flex-direction:column;gap:8px}.vv-lora-section+.vv-lora-section{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)}.vv-lora-section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:9px;line-height:1.3;font-weight:850;letter-spacing:.09em;color:#b9c1ca;text-transform:uppercase}.vv-lora-card{min-width:0;background:linear-gradient(145deg,#202b36,#18212a);border:1px solid rgba(196,181,214,.10);border-radius:10px;padding:10px;transition:.16s}.vv-lora-card.disabled{opacity:.68}.vv-lora-card.enabled{border-color:rgba(194,173,216,.35);box-shadow:0 0 14px rgba(117,94,141,.12)}.vv-lora-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.vv-lora-name{min-width:0;font-size:10px;line-height:1.3;font-weight:850;letter-spacing:.055em;color:#ece7f1;overflow-wrap:anywhere}.vv-lora-help{margin-top:3px;font-size:8.5px;line-height:1.35;color:#8f9aa6;overflow-wrap:anywhere}.vv-lora-fields{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:9px;margin-top:9px}.vv-field{min-width:0}.vv-field-label{display:block;margin-bottom:5px;font-size:8px;line-height:1.2;font-weight:800;letter-spacing:.07em;color:#aeb7c1;text-transform:uppercase}.vv-lora-select,.vv-lora-number,.vv-lora-range{width:100%;min-width:0}.vv-lora-select,.vv-lora-number{background:#111920;color:#e4e1e8;border:1px solid rgba(196,181,214,.13);border-radius:7px;padding:8px;font-size:9px;line-height:1.25;text-overflow:ellipsis}.vv-strength-wrap{display:grid;grid-template-columns:minmax(0,1fr) 62px;gap:6px;align-items:center}.vv-lora-range{accent-color:#826f99}.vv-lora-status{font-size:8px;font-weight:850;letter-spacing:.06em;padding:4px 7px;border-radius:999px;background:#151d25;color:#9ba6b1;border:1px solid rgba(255,255,255,.07)}.vv-lora-status.on{color:#d8cbe6;border-color:rgba(194,173,216,.28)}.vv-lora-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.vv-lora-actions .vv-button{flex:1 1 130px}.vv-lora-order{margin-top:10px;padding:8px 9px;border-radius:8px;background:#151d25;border:1px solid rgba(255,255,255,.06);font-size:8.5px;line-height:1.4;color:#8f9aa6;overflow-wrap:anywhere}
      .vv-tabbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}.vv-tab{appearance:none;min-width:0;border:1px solid rgba(190,178,205,.16);background:#1b2530;color:#9ea8b2;border-radius:8px;padding:8px 6px;font-size:8.5px;line-height:1.2;font-weight:800;letter-spacing:.045em;cursor:pointer;white-space:normal;overflow-wrap:anywhere}.vv-tab.active{background:linear-gradient(135deg,#716286,#52677d);color:#fff;border-color:rgba(213,198,229,.38)}.vv-tab-panel{min-width:0}.vv-tab-panel[hidden]{display:none!important}.vv-tab-panel .vv-module-card{min-height:0}.vv-lora-core-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.vv-lora-compact-card{min-width:0;background:linear-gradient(145deg,#202b36,#18212a);border:1px solid rgba(196,181,214,.10);border-radius:10px;padding:9px;transition:.16s}.vv-lora-compact-card.disabled{opacity:.68}.vv-lora-compact-card.enabled{border-color:rgba(194,173,216,.35);box-shadow:0 0 14px rgba(117,94,141,.12)}.vv-lora-compact-card .vv-lora-fields{grid-template-columns:1fr;margin-top:7px}.vv-lora-compact-card .vv-field-label{margin-bottom:3px}.vv-lora-compact-card .vv-lora-select,.vv-lora-compact-card .vv-lora-number{padding:6px 7px}.vv-lora-creative-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:7px 0}.vv-lora-creative-tabs .vv-tab{position:relative}.vv-lora-tab-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;background:#5e6872}.vv-lora-tab-dot.on{background:#a68aba;box-shadow:0 0 8px rgba(166,138,186,.45)}.vv-lora-creative-editor{min-width:0}.vv-lora-creative-editor .vv-lora-card{padding:9px}.vv-lora-creative-editor .vv-lora-fields{margin-top:7px}.vv-lora-actions.compact{margin-top:8px}.vv-lora-actions.compact .vv-button{padding:7px 8px;font-size:9px}.vv-lora-order.compact{margin-top:7px;padding:7px 8px;font-size:8px}
      .vv-player-shell{display:flex;justify-content:center;align-items:center;width:100%;min-width:0}.vv-video-frame{flex:none!important;width:auto;height:auto;max-width:none!important}.vv-video{max-width:none!important}

      .vv-lora-stack-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0 7px}.vv-lora-stack-title{font-size:9px;font-weight:850;letter-spacing:.09em;color:#c3b9cf;text-transform:uppercase}.vv-lora-add{appearance:none;border:1px solid rgba(213,198,229,.22);background:linear-gradient(135deg,#716286,#52677d);color:#fff;border-radius:8px;padding:7px 12px;font-size:9px;font-weight:850;letter-spacing:.055em;cursor:pointer}.vv-lora-add:hover{filter:brightness(1.08)}
      .vv-lora-stack-list{display:flex;flex-direction:column;gap:7px;max-height:235px;overflow:auto;padding-right:3px;scrollbar-width:thin;scrollbar-color:#675877 #18212a}.vv-lora-stack-empty{display:flex;align-items:center;justify-content:center;min-height:70px;border:1px dashed rgba(196,181,214,.16);border-radius:10px;color:#7f8a96;font-size:9px;letter-spacing:.06em}.vv-lora-row{display:grid;grid-template-columns:28px minmax(0,1fr) 160px auto;gap:7px;align-items:center;background:linear-gradient(145deg,#202b36,#18212a);border:1px solid rgba(196,181,214,.10);border-radius:10px;padding:8px;transition:.16s}.vv-lora-row.on{border-color:rgba(194,173,216,.34);box-shadow:0 0 12px rgba(117,94,141,.10)}.vv-lora-index{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:#111920;color:#b8a9c7;font-size:9px;font-weight:900}.vv-lora-row .vv-lora-select,.vv-lora-row .vv-lora-number{padding:7px}.vv-lora-row-strength{display:grid;grid-template-columns:minmax(0,1fr) 58px;gap:5px;align-items:center;min-width:0}.vv-lora-row-actions{display:flex;align-items:center;gap:4px}.vv-icon-button{appearance:none;width:27px;height:27px;border:1px solid rgba(196,181,214,.13);background:#151e27;color:#b5bec8;border-radius:7px;font-size:11px;font-weight:900;cursor:pointer;line-height:1}.vv-icon-button:hover{background:#263342;color:#fff}.vv-icon-button.danger:hover{background:#4a2731;color:#ffdce4}.vv-lora-toolbar{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.vv-lora-toolbar .vv-button{flex:1 1 125px;padding:7px 9px;font-size:9px}.vv-lora-core-grid .vv-lora-help,.vv-lora-intro,.vv-lora-order{display:none!important}


      /* v1.1.4 cable-safe panel geometry: dedicated inner margins keep native
         ports and cable endpoints outside the readable UI surface. */
      .vv-shell{position:relative;isolation:isolate}
      .vv-head{padding-left:130px;padding-right:130px}
      .vv-body{padding-left:25px;padding-right:25px}
      .vv-shell::before,.vv-shell::after{content:"";position:absolute;z-index:4;pointer-events:none;top:64px;bottom:0;width:10px;background:linear-gradient(180deg,#151e27,#111820);opacity:.98}
      .vv-shell::before{left:0;border-right:1px solid rgba(196,181,214,.08)}
      .vv-shell::after{right:0;border-left:1px solid rgba(196,181,214,.08)}
      .vv-head,.vv-body{position:relative;z-index:5}
      @media (max-width:560px){.vv-head{padding-left:92px;padding-right:92px}.vv-brand{font-size:10px;letter-spacing:.075em}.vv-badge{max-width:150px}}

      /* Classic LoRA layout: one continuous list, one line per LoRA, no cards,
         no descriptions, no hidden tabs. */
      .vv-power-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .vv-power-search{display:grid;grid-template-columns:52px minmax(0,1fr) auto 25px;gap:7px;align-items:center;margin:0 0 10px;padding:8px 9px;background:linear-gradient(135deg,#201a2b 0%,#172431 100%);border:1px solid rgba(196,177,217,.34);border-radius:9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035);transition:.15s ease}
      .vv-power-search:focus-within{border-color:rgba(196,177,217,.42);box-shadow:0 0 0 3px rgba(111,91,134,.12)}
      .vv-power-search-icon{display:flex;align-items:center;justify-content:flex-start;color:#c8b5dd;font-size:8px;font-weight:900;letter-spacing:.08em;line-height:1;user-select:none}
      .vv-power-search-input{width:100%;min-width:0;height:27px;padding:0 2px;border:0!important;outline:0!important;background:transparent!important;color:#e9e5ed;font-size:9px;letter-spacing:.025em;box-shadow:none!important}
      .vv-power-search-input::placeholder{color:#788591;letter-spacing:.06em}
      .vv-power-search-count{min-width:62px;text-align:right;color:#99a5b0;font-size:7.5px;font-weight:850;letter-spacing:.055em;white-space:nowrap}
      .vv-power-search-clear{width:25px;height:25px;padding:0;border:1px solid rgba(196,181,214,.12);border-radius:6px;background:#111920;color:#929eaa;font-size:13px;line-height:1;cursor:pointer;transition:.14s ease}
      .vv-power-search-clear:hover{color:#eee8f4;border-color:rgba(196,177,217,.38);background:#202b36}.vv-power-search-clear:disabled{opacity:.28;cursor:default}
      .vv-power-search-wrap{position:relative;z-index:30;margin:0 0 10px}
      .vv-power-search-wrap .vv-power-search{margin:0}
      .vv-power-search-results{display:none;position:absolute;left:0;right:0;top:calc(100% + 5px);max-height:210px;overflow:auto;padding:5px;background:linear-gradient(145deg,#131b23,#1b2631);border:1px solid rgba(196,177,217,.34);border-radius:9px;box-shadow:0 15px 34px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.035);scrollbar-width:thin;scrollbar-color:#675877 #18212a}
      .vv-power-search-results.open{display:flex;flex-direction:column;gap:3px}
      .vv-power-search-results.vv-power-search-floating{position:fixed;left:auto;right:auto;top:auto;z-index:100001}
      .vv-power-search-result{appearance:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;min-width:0;padding:8px 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:#dfe3e8;text-align:left;cursor:pointer;transition:.12s ease}
      .vv-power-search-result:hover,.vv-power-search-result.active{background:linear-gradient(135deg,rgba(111,91,134,.36),rgba(60,78,95,.34));border-color:rgba(196,177,217,.28)}
      .vv-power-search-result-main{min-width:0}.vv-power-search-result-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:800;color:#eee9f3}.vv-power-search-result-path{display:block;min-width:0;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7.5px;color:#87939f}
      .vv-power-search-result-action{flex:0 0 auto;padding:4px 6px;border-radius:999px;background:#111920;border:1px solid rgba(196,181,214,.14);color:#bbaaca;font-size:7px;font-weight:900;letter-spacing:.05em;white-space:nowrap}
      .vv-power-search-empty{padding:14px 10px;text-align:center;color:#87939f;font-size:8.5px;letter-spacing:.055em}
      .vv-power-row.target{border-color:rgba(205,184,225,.54)!important;box-shadow:inset 3px 0 0 #a48bb9,0 0 15px rgba(125,100,151,.16)!important}
      .vv-power-combo{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 27px;gap:3px;min-width:0}
      .vv-power-combo-input{width:100%;min-width:0;height:29px;background:#111920;color:#e4e1e8;border:1px solid rgba(196,181,214,.13);border-radius:6px;padding:4px 7px;font-size:8.2px;line-height:1.2;outline:none;text-overflow:ellipsis}
      .vv-power-combo-input::placeholder{color:#74818d}.vv-power-combo-input:focus{border-color:rgba(196,177,217,.52);box-shadow:0 0 0 2px rgba(111,91,134,.14)}
      .vv-power-combo-open{appearance:none;width:27px;height:29px;padding:0;border:1px solid rgba(196,181,214,.13);border-radius:6px;background:#151e27;color:#aeb8c2;font-size:11px;line-height:1;cursor:pointer}.vv-power-combo-open:hover{background:#263342;color:#fff}
      .vv-lora-picker-popup{display:none;position:fixed;z-index:100000;max-height:280px;overflow:auto;padding:5px;background:linear-gradient(145deg,#131b23,#1b2631);border:1px solid rgba(196,177,217,.42);border-radius:9px;box-shadow:0 18px 42px rgba(0,0,0,.58),inset 0 1px 0 rgba(255,255,255,.035);scrollbar-width:thin;scrollbar-color:#675877 #18212a}
      .vv-lora-picker-popup.open{display:flex;flex-direction:column;gap:3px}
      .vv-lora-picker-result{appearance:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;min-width:0;padding:8px 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:#dfe3e8;text-align:left;cursor:pointer;transition:.12s ease}
      .vv-lora-picker-result:hover,.vv-lora-picker-result.active{background:linear-gradient(135deg,rgba(111,91,134,.38),rgba(60,78,95,.36));border-color:rgba(196,177,217,.30)}
      .vv-lora-picker-main{min-width:0}.vv-lora-picker-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:800;color:#eee9f3}.vv-lora-picker-path{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7.5px;color:#87939f}
      .vv-lora-picker-use{padding:4px 6px;border-radius:999px;background:#111920;border:1px solid rgba(196,181,214,.14);color:#bbaaca;font-size:7px;font-weight:900;letter-spacing:.05em;white-space:nowrap}
      .vv-lora-picker-empty{padding:14px 10px;text-align:center;color:#87939f;font-size:8.5px;letter-spacing:.055em}
      .vv-power-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
      .vv-power-actions .vv-button,.vv-power-actions .vv-lora-add{padding:7px 10px;font-size:8.5px;min-width:0}
      .vv-power-head,.vv-power-row{display:grid;grid-template-columns:32px minmax(132px,1fr) 62px 72px 72px 72px 54px 96px;gap:5px;align-items:center;min-width:0}
      .vv-power-head{padding:0 7px 6px;color:#8995a1;font-size:7.2px;font-weight:850;letter-spacing:.075em;text-transform:uppercase}
      .vv-power-list{display:flex;flex-direction:column;gap:5px;max-height:350px;overflow-x:hidden;overflow-y:auto;padding-right:3px;scrollbar-width:thin;scrollbar-color:#675877 #18212a}
      .vv-power-row{min-height:43px;padding:6px 7px;background:linear-gradient(145deg,#202b35,#18212a);border:1px solid rgba(196,181,214,.10);border-radius:8px;transition:.14s ease}
      .vv-power-row:hover{border-color:rgba(196,181,214,.24);background:linear-gradient(145deg,#24313d,#1b2630)}
      .vv-power-row.on{border-color:rgba(194,173,216,.30);box-shadow:inset 3px 0 0 rgba(151,129,174,.58)}
      .vv-power-row.off{opacity:.63}
      .vv-power-select,.vv-power-number{width:100%;min-width:0;height:29px;background:#111920;color:#e4e1e8;border:1px solid rgba(196,181,214,.13);border-radius:6px;padding:4px 6px;font-size:8.2px;line-height:1.2;text-overflow:ellipsis}
      .vv-power-number{min-width:70px;padding:4px 22px 4px 6px;text-align:right;font-variant-numeric:tabular-nums;appearance:auto;-webkit-appearance:auto}
      .vv-power-number::-webkit-inner-spin-button,.vv-power-number::-webkit-outer-spin-button{display:block;opacity:1;width:16px;height:24px;margin:0;cursor:pointer}
      .vv-power-number.inactive{opacity:.35;pointer-events:none}
      .vv-power-row .vv-switch{width:31px;height:18px;padding:2px;margin:0 auto}.vv-power-row .vv-switch::after{width:12px;height:12px}.vv-power-row .vv-switch.on::after{transform:translateX(13px)}
      .vv-power-analysis{display:flex;align-items:center;justify-content:center;min-width:0;height:24px;padding:0 5px;border-radius:999px;background:#121a22;border:1px solid rgba(188,174,204,.13);color:#8fa1b0;font-size:7px;font-weight:900;letter-spacing:.045em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vv-power-analysis.av{color:#d1c2df;border-color:rgba(189,169,211,.30)}.vv-power-analysis.audio{color:#9bb9cd}.vv-power-analysis.video{color:#b8adc7}.vv-power-analysis.warn{color:#d1a68f}
      .vv-power-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:96px;overflow:visible;white-space:nowrap}
      .vv-power-empty{display:flex;align-items:center;justify-content:center;min-height:62px;border:1px dashed rgba(196,181,214,.13);border-radius:8px;color:#798590;font-size:8.5px;letter-spacing:.06em}
      .vv-power-summary{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#8995a1;font-size:8px;letter-spacing:.04em}
      @media (max-width:700px){
        .vv-power-head,.vv-power-row{grid-template-columns:32px minmax(124px,1fr) 62px 70px 70px 70px 54px 92px;gap:4px}
      }

      .vv-watermark-settings{display:none;margin-top:10px;padding:10px;border:1px solid rgba(196,181,214,.13);border-radius:10px;background:linear-gradient(145deg,#1c2631,#151e27)}
      .vv-watermark-settings.visible{display:block}.vv-watermark-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,.9fr);gap:7px}.vv-watermark-grid.secondary{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:7px}.vv-watermark-field{min-width:0}.vv-watermark-field label{display:block;margin:0 0 4px;color:#929eaa;font-size:7.5px;font-weight:850;letter-spacing:.065em;text-transform:uppercase}.vv-watermark-field select,.vv-watermark-field input{width:100%;min-width:0;height:30px;padding:5px 7px;border:1px solid rgba(196,181,214,.14);border-radius:7px;background:#111920;color:#e5e1e9;font-size:8.5px}.vv-watermark-service{font-size:9px;line-height:1.45;color:#9da8b3}.vv-watermark-service strong{color:#e8e3ed}.vv-watermark-source-note{display:flex;flex-direction:column;justify-content:center;min-width:0;min-height:30px;padding:6px 9px;border:1px solid rgba(196,181,214,.12);border-radius:7px;background:#121a22;color:#9da8b3;font-size:8px;line-height:1.3}.vv-watermark-source-note span{color:#87939f;font-size:7px;font-weight:850;letter-spacing:.07em;text-transform:uppercase}.vv-watermark-source-note strong{display:block;min-width:0;margin-top:2px;color:#e5e1e9;font-size:8.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vv-watermark-source-note.custom{border-color:rgba(196,177,217,.32);background:linear-gradient(135deg,#201a2b,#172431)}.vv-watermark-picker{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end}.vv-watermark-picker select{width:100%;min-width:0;height:32px;padding:5px 7px;border:1px solid rgba(196,181,214,.16);border-radius:7px;background:#111920;color:#e5e1e9;font-size:9px}.vv-watermark-upload{height:32px;padding:0 11px}.vv-watermark-current{margin-top:8px;padding:7px 9px;border-radius:7px;background:#121a22;border:1px solid rgba(255,255,255,.06);color:#c9d0d7;font-size:8.5px;overflow-wrap:anywhere}
      @media (max-width:620px){.vv-grid,.vv-module-grid{grid-template-columns:1fr}.vv-module-card.wide{grid-column:auto}.vv-lora-fields{grid-template-columns:1fr}.vv-pass-grid{grid-template-columns:1fr}.vv-check{grid-template-columns:11px minmax(0,1fr)}.vv-check em{grid-column:2}.vv-advanced-grid{grid-template-columns:1fr}.vv-segments{grid-template-columns:repeat(2,minmax(0,1fr))}}

    `;
    document.head.appendChild(style);
}

function nodeType(node) {
    return node?.comfyClass ?? node?.type;
}

function widget(node, name) {
    return node?.widgets?.find((item) => item?.name === name);
}

function hideWidget(item) {
    if (!item || item.__vvHidden) return;
    item.__vvHidden = true;
    item.computeSize = () => [0, -4];
    item.hidden = true;
}

function setWidget(node, name, value, { callback = true } = {}) {
    const target = widget(node, name);
    if (!target) return false;
    target.value = value;
    if (callback) target.callback?.(value);
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
    return true;
}

function value(node, name, fallback = null) {
    const target = widget(node, name);
    return target == null ? fallback : target.value;
}

function ensureMinimumNodeSize(node, width, height) {
    if (!node) return;
    node.resizable = true;
    const currentWidth = Number(node.size?.[0] ?? 0);
    const currentHeight = Number(node.size?.[1] ?? 0);
    if (currentWidth < width || currentHeight < height) {
        node.setSize?.([Math.max(width, currentWidth), Math.max(height, currentHeight)]);
    }
}

function bindFreeDOMResize(node, element, minHeight, chrome = 70) {
    node.resizable = true;
    element.style.minHeight = `${minHeight}px`;
    element.style.height = "100%";
    element.style.overflowY = "auto";
}

function addDOM(node, name, label, element, height) {
    const fixedHeight = Math.max(30, Number(height) || 30);
    element.style.width = "100%";
    element.style.minHeight = `${fixedHeight}px`;
    element.style.height = "100%";
    const domWidget = node.addDOMWidget(name, label, element, {
        serialize: false,
        hideOnZoom: false,
        margin: 0,
        getMinHeight: () => fixedHeight,
        getMaxHeight: () => Infinity,
        getHeight: () => fixedHeight,
    });
    domWidget.serialize = false;
    domWidget.serializeValue = () => undefined;
    domWidget.computeSize = (width) => [width, fixedHeight];
    // ComfyUI's current frontend uses computeLayoutSize/getMinHeight instead
    // of the legacy computeSize callback for DOM widgets. Supporting both APIs
    // keeps the panels correctly sized on old and new frontend builds.
    domWidget.computeLayoutSize = () => ({
        minHeight: fixedHeight,
        maxHeight: Infinity,
    });
    bindFreeDOMResize(node, element, fixedHeight, 70);
    return domWidget;
}

function addAdaptiveDOM(node, name, label, element, minHeight, minWidth, chrome = 82) {
    let measuredHeight = minHeight;
    element.style.width = "100%";
    element.style.minHeight = `${minHeight}px`;
    element.style.height = "auto";
    element.style.overflowY = "auto";
    const domWidget = node.addDOMWidget(name, label, element, {
        serialize: false,
        hideOnZoom: false,
        margin: 0,
        getMinHeight: () => Math.max(minHeight, measuredHeight),
        getMaxHeight: () => Infinity,
        getHeight: () => Math.max(minHeight, measuredHeight),
    });
    domWidget.serialize = false;
    domWidget.serializeValue = () => undefined;
    domWidget.computeSize = (width) => [width, Math.max(minHeight, measuredHeight)];
    domWidget.computeLayoutSize = () => ({
        minHeight: Math.max(minHeight, measuredHeight),
        maxHeight: Infinity,
    });
    const resize = () => {
        const next = Math.ceil(Math.max(minHeight, element.scrollHeight || element.getBoundingClientRect?.().height || minHeight));
        if (Math.abs(next - measuredHeight) < 2) return;
        measuredHeight = next;
        element.style.minHeight = `${measuredHeight}px`;
        const width = Math.max(Number(node.size?.[0] || 0), minWidth);
        const targetHeight = measuredHeight + chrome;
        if (Number(node.size?.[1] || 0) + 3 < targetHeight) node.setSize([width, targetHeight]);
        node.graph?.setDirtyCanvas?.(true, true);
        node.setDirtyCanvas?.(true, true);
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => requestAnimationFrame(resize)) : null;
    observer?.observe(element);
    node.__vvAdaptiveObservers ??= [];
    if (observer) node.__vvAdaptiveObservers.push(observer);
    requestAnimationFrame(resize);
    setTimeout(resize, 100);
    setTimeout(resize, 350);
    bindFreeDOMResize(node, element, minHeight, chrome);
    // Adaptive panels measure intrinsic content only. Filling the node height
    // here would turn the ResizeObserver into a node-height feedback loop.
    element.style.height = "auto";
    return domWidget;
}

function makePanelDraggable(node, handle) {
    if (!node || !handle || handle.__vvDragBoundV1115) return;
    handle.__vvDragBoundV1115 = true;

    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target?.closest?.("button,input,select,textarea,a,summary,video")) return;
        const drag = {
            clientX: event.clientX,
            clientY: event.clientY,
            nodeX: Number(node.pos?.[0] ?? 0),
            nodeY: Number(node.pos?.[1] ?? 0),
            scale: Math.max(0.05, Number(app.canvas?.ds?.scale ?? 1) || 1),
        };
        handle.classList.add("vv-dragging");

        const move = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const nextX = drag.nodeX + (moveEvent.clientX - drag.clientX) / drag.scale;
            const nextY = drag.nodeY + (moveEvent.clientY - drag.clientY) / drag.scale;
            try { node.pos = [nextX, nextY]; } catch (_) {
                if (node.pos) {
                    node.pos[0] = nextX;
                    node.pos[1] = nextY;
                }
            }
            app.canvas?.setDirty?.(true, true);
            node.graph?.setDirtyCanvas?.(true, true);
            node.setDirtyCanvas?.(true, true);
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
        };
        const finish = (upEvent) => {
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            window.removeEventListener("blur", finish, true);
            handle.classList.remove("vv-dragging");
            upEvent?.preventDefault?.();
            upEvent?.stopPropagation?.();
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("blur", finish, true);
        event.preventDefault();
        event.stopPropagation();
    });
}

function createHeader(title, badgeText, node = null) {
    const head = document.createElement("div");
    head.className = "vv-head";
    const brand = document.createElement("div");
    brand.className = "vv-brand";
    brand.textContent = title;
    brand.title = title;
    const badge = document.createElement("div");
    badge.className = "vv-badge";
    badge.textContent = badgeText;
    badge.title = badgeText;
    head.append(brand, badge);
    makePanelDraggable(node, head);
    return { head, badge };
}

function createSwitch(initial, onChange) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "vv-switch" + (initial ? " on" : "");
    control.addEventListener("click", () => {
        const next = !control.classList.contains("on");
        control.classList.toggle("on", next);
        onChange(next);
    });
    return control;
}

function syncProjectNameFromHub(hubNode = null) {
    const hub = hubNode ?? app.graph?._nodes?.find((item) => nodeType(item) === HUB_TYPE);
    const output = app.graph?._nodes?.find((item) => nodeType(item) === OUTPUT_TYPE);
    if (!hub || !output) return;
    const raw = String(value(hub, "project_name", "VELVET_VICE_MINIMAX_H3_I2V_FINAL")).trim();
    const prefix = raw.toLowerCase().startsWith("video/") ? raw : `video/${raw || "VELVET_VICE_MINIMAX_H3_I2V_FINAL"}`;
    setWidget(output, "filename_prefix", prefix);
}

function optionValues(target) {
    const raw = target?.options?.values;
    try {
        const values = typeof raw === "function" ? raw() : raw;
        return Array.isArray(values) ? values.map((item) => String(item)) : [];
    } catch (_) {
        return [];
    }
}

function makeBoundSelect(node, name, fallback = []) {
    const select = document.createElement("select");
    const target = widget(node, name);
    let choices = optionValues(target);
    const current = String(value(node, name, fallback[0] ?? ""));
    if (!choices.length) choices = fallback;
    if (current && !choices.includes(current)) choices = [current, ...choices];
    for (const item of choices) {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    }
    select.value = current;
    select.addEventListener("change", () => setWidget(node, name, select.value));
    return select;
}

function makeBoundNumber(node, name, step = "0.01") {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = String(value(node, name, 0));
    input.addEventListener("change", () => setWidget(node, name, Number(input.value)));
    return input;
}

function installControlHub(node) {
    if (node.__vvControlInstalled) return;
    node.__vvControlInstalled = true;
    installStyle();
    for (const item of node.widgets ?? []) hideWidget(item);

    const shell = document.createElement("div");
    shell.className = "vv-shell";
    const isH3OutputHub = /MINIMAX H3|H3 OUTPUT/i.test(String(node.title || ""));
    const hubTitle = isH3OutputHub ? "VELVET VICE · H3 OUTPUT / FINISHING HUB" : "VELVET VICE · CONTROL HUB";
    const hubBadge = isH3OutputHub ? "H3 OUTPUT" : String(value(node, "edition", "ANTIGHOST"));
    const { head, badge } = createHeader(hubTitle, hubBadge, node);
    shell.appendChild(head);
    const body = document.createElement("div");
    body.className = "vv-body";
    shell.appendChild(body);

    const profileLabel = document.createElement("div");
    profileLabel.className = "vv-label";
    profileLabel.textContent = "Render profile";
    body.appendChild(profileLabel);
    const segments = document.createElement("div");
    segments.className = "vv-segments";
    body.appendChild(segments);

    const profileButtons = new Map();
    const profileDefaults = {
        TEST: { output_48_fps: false, quality_filter: false, watermark: false, soundmark: false },
        BALANCED: { output_48_fps: false, quality_filter: true, watermark: false, soundmark: false },
        FINAL: { output_48_fps: true, quality_filter: true, watermark: true, soundmark: false },
    };

    const toggleControls = new Map();
    function refreshProfile() {
        const selected = String(value(node, "profile", "CUSTOM"));
        for (const [key, button] of profileButtons) button.classList.toggle("active", key === selected);
        badge.textContent = `${value(node, "edition", "ANTIGHOST")} · ${selected}`;
    }
    function refreshToggles() {
        for (const [name, control] of toggleControls) control.classList.toggle("on", Boolean(value(node, name, false)));
    }
    function selectProfile(profile) {
        setWidget(node, "profile", profile);
        const defaults = profileDefaults[profile];
        if (defaults) {
            for (const [name, val] of Object.entries(defaults)) setWidget(node, name, val);
        }
        refreshProfile();
        refreshToggles();
        refreshWatermarkSettings?.();
    }
    for (const profile of ["TEST", "BALANCED", "FINAL", "CUSTOM"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vv-segment";
        button.textContent = profile;
        button.addEventListener("click", () => selectProfile(profile));
        segments.appendChild(button);
        profileButtons.set(profile, button);
    }

    const grid = document.createElement("div");
    grid.className = "vv-grid";
    body.appendChild(grid);
    const toggles = [
        ["output_48_fps", "48 FPS / RIFE"],
        ["quality_filter", "Area quality filter"],
        ["watermark", "Watermark"],
        ["soundmark", "Soundmark"],
    ];
    for (const [name, labelText] of toggles) {
        const row = document.createElement("div");
        row.className = "vv-toggle";
        const label = document.createElement("span");
        label.textContent = labelText;
        const control = createSwitch(Boolean(value(node, name, false)), (next) => {
            setWidget(node, name, next);
            setWidget(node, "profile", "CUSTOM");
            refreshProfile();
            refreshWatermarkSettings?.();
        });
        toggleControls.set(name, control);
        row.append(label, control);
        grid.appendChild(row);
    }

    const watermarkSettings = document.createElement("div");
    watermarkSettings.className = "vv-watermark-settings";
    const wmPrimary = document.createElement("div");
    wmPrimary.className = "vv-watermark-grid";
    const addField = (parent, labelText, control) => {
        const field = document.createElement("div");
        field.className = "vv-watermark-field";
        const label = document.createElement("label");
        label.textContent = labelText;
        field.append(label, control);
        parent.appendChild(field);
    };
    addField(wmPrimary, "Position", makeBoundSelect(node, "watermark_position", ["bottom-right"]));
    const sourceNote = document.createElement("div");
    sourceNote.className = "vv-watermark-source-note";
    const sourceCaption = document.createElement("span");
    sourceCaption.textContent = "Selected watermark";
    const sourceFilename = document.createElement("strong");
    sourceNote.append(sourceCaption, sourceFilename);
    wmPrimary.appendChild(sourceNote);
    function refreshWatermarkSource(event = null) {
        const selected = String(event?.detail?.name || graphWatermarkName() || "Velvet_Vice_Watermark.png");
        sourceFilename.textContent = selected;
        sourceFilename.title = selected;
        sourceNote.classList.toggle("custom", selected !== "Velvet_Vice_Watermark.png");
    }
    window.addEventListener(WATERMARK_SOURCE_EVENT, refreshWatermarkSource);
    watermarkSettings.appendChild(wmPrimary);
    const wmSecondary = document.createElement("div");
    wmSecondary.className = "vv-watermark-grid secondary";
    addField(wmSecondary, "Size", makeBoundNumber(node, "watermark_scale", "0.01"));
    addField(wmSecondary, "Opacity", makeBoundNumber(node, "watermark_opacity", "0.01"));
    addField(wmSecondary, "Margin X", makeBoundNumber(node, "watermark_margin_x", "1"));
    addField(wmSecondary, "Margin Y", makeBoundNumber(node, "watermark_margin_y", "1"));
    watermarkSettings.appendChild(wmSecondary);
    body.appendChild(watermarkSettings);
    function refreshWatermarkSettings() {
        watermarkSettings.classList.toggle("visible", Boolean(value(node, "watermark", false)));
    }

    const projectLabel = document.createElement("div");
    projectLabel.className = "vv-label";
    projectLabel.style.marginTop = "12px";
    projectLabel.textContent = "Project / output name";
    body.appendChild(projectLabel);
    const project = document.createElement("input");
    project.className = "vv-input";
    project.value = String(value(node, "project_name", "VELVET_VICE_MINIMAX_H3_I2V_FINAL"));
    project.spellcheck = false;
    project.addEventListener("input", () => { setWidget(node, "project_name", project.value); syncProjectNameFromHub(node); });
    body.appendChild(project);

    const foot = document.createElement("div");
    foot.className = "vv-foot";
    const sync = document.createElement("div");
    sync.style.display = "flex";
    sync.style.alignItems = "center";
    sync.style.gap = "7px";
    const dot = document.createElement("span");
    dot.className = "vv-dot ok";
    const text = document.createElement("span");
    text.textContent = "Connected to real graph switches";
    sync.append(dot, text);
    const path = document.createElement("span");
    path.textContent = "Single final encode";
    foot.append(sync, path);
    body.appendChild(foot);

    addDOM(node, "vv_control_hub_surface", "VELVET VICE CONTROL SURFACE", shell, 420);
    refreshProfile();
    refreshToggles();
    refreshWatermarkSettings();
    refreshWatermarkSource();
    setTimeout(() => {
        syncProjectNameFromHub(node);
        syncWatermarkSource();
        refreshWatermarkSource();
    }, 0);
    setTimeout(refreshWatermarkSource, 300);
    ensureMinimumNodeSize(node,580,500);
}

function graphReferenceImage() {
    const candidate = app.graph?._nodes?.find((node) => {
        const title = String(node?.title ?? "").toUpperCase();
        return nodeType(node) === "LoadImage" && title.includes("REFERENCE IMAGE");
    });
    const imageWidget = candidate?.widgets?.find((item) => item?.name === "image") ?? candidate?.widgets?.[0];
    return String(imageWidget?.value ?? "");
}

function graphOllamaUrl() {
    const director = app.graph?._nodes?.find((node) => nodeType(node) === MINIMAX_PROMPT_DIRECTOR_TYPE);
    const named = director?.widgets?.find((item) => item?.name === "ollama_url" || item?.name === "base_url");
    if (named?.value) return String(named.value);
    const fallback = director?.widgets?.find((item) => typeof item?.value === "string" && item.value.startsWith("http"));
    return String(fallback?.value ?? "http://127.0.0.1:11434");
}

function graphWatermarkEnabled() {
    const hub = app.graph?._nodes?.find((node) => nodeType(node) === HUB_TYPE);
    return Boolean(value(hub, "watermark", false));
}

function graphWatermarkName() {
    const overlay = app.graph?._nodes?.find((node) => nodeType(node) === WATERMARK_TYPE);
    const selected = String(value(overlay, "watermark_file", "") || "").trim();
    if (selected) return selected;
    const hub = app.graph?._nodes?.find((node) => nodeType(node) === HUB_TYPE);
    return String(value(hub, "watermark_file", "Velvet_Vice_Watermark.png"));
}

const WATERMARK_SOURCE_EVENT = "velvet-vice-watermark-source-changed";

function syncWatermarkSource(selectedValue = null) {
    const overlay = app.graph?._nodes?.find((node) => nodeType(node) === WATERMARK_TYPE);
    const selected = String(
        selectedValue ?? value(overlay, "watermark_file", "Velvet_Vice_Watermark.png")
    ).trim() || "Velvet_Vice_Watermark.png";
    const hub = app.graph?._nodes?.find((node) => nodeType(node) === HUB_TYPE);
    if (hub && String(value(hub, "watermark_file", "")) !== selected) {
        setWidget(hub, "watermark_file", selected);
    }
    window.dispatchEvent(new CustomEvent(WATERMARK_SOURCE_EVENT, { detail: { name: selected } }));
    return selected;
}

function graphPromptMode() {
    const director = app.graph?._nodes?.find((node) => nodeType(node) === MINIMAX_PROMPT_DIRECTOR_TYPE);
    const modeWidget = director?.widgets?.find((item) => item?.name === "mode") ?? director?.widgets?.[0];
    return String(modeWidget?.value ?? "MANUAL").toUpperCase();
}

function graphCompatibilityVersion() {
    return "H3";
}

function graphSelectedModels() {
    const node = app.graph?._nodes?.find((item) => nodeType(item) === MODEL_LOADOUT_TYPE);
    const native = nativePanelWidgets(node);
    const entries = [];
    const add = (label, index, categories, required = true) => {
        const filename = String(native[index]?.value ?? "");
        if (!filename || filename.toLowerCase().startsWith("placeholder.")) return;
        entries.push({ label, filename, categories, required });
    };
    const safetensorsEnabled = Boolean(native[0]?.value ?? true);
    const ggufEnabled = Boolean(native[1]?.value ?? false);
    const compatibilityVersion = graphCompatibilityVersion();
    if (safetensorsEnabled) add("Base model", 2, ["diffusion_models", "unet", "checkpoints"], true);
    if (ggufEnabled) add("GGUF base model", 3, ["diffusion_models", "unet", "checkpoints"], true);
    add("Spatial upscaler", 4, ["latent_upscale_models", "upscale_models"], true);
    add("Audio VAE", 5, ["vae", "audio_encoders"], true);
    add("Full video VAE", 6, ["vae"], true);
    add("Text encoder", 7, ["text_encoders", "clip"], true);
    if (ggufEnabled) add("GGUF text encoder", 8, ["text_encoders", "clip"], true);
    
    if (Boolean(native[10]?.value ?? false)) add("Distilled LoRA", 11, ["loras"], true);
    return entries;
}

function graphActiveLoras() {
    const node = app.graph?._nodes?.find((item) => nodeType(item) === LORA_TYPE);
    const raw = widget(node, "lora_stack_json")?.value ?? "[]";
    try {
        const parsed = JSON.parse(String(raw || "[]"));
        return Array.isArray(parsed)
            ? parsed.filter((item) => item?.enabled !== false && item?.lora && item.lora !== "None").map((item) => String(item.lora))
            : [];
    } catch (_) {
        return [];
    }
}

function installPreflight(node) {
    if (node.__vvPreflightInstalled) return;
    node.__vvPreflightInstalled = true;
    installStyle();
    for (const item of node.widgets ?? []) hideWidget(item);

    const shell = document.createElement("div");
    shell.className = "vv-shell";
    const { head, badge } = createHeader("VELVET VICE · PREFLIGHT", "NOT CHECKED", node);
    shell.appendChild(head);
    const body = document.createElement("div");
    body.className = "vv-body";
    shell.appendChild(body);

    const intro = document.createElement("div");
    intro.style.fontSize = "11px";
    intro.style.color = "#aeb7c1";
    intro.textContent = "Checks files, CUDA, Ollama, FFmpeg, NVENC and the final output path without touching the render core.";
    body.appendChild(intro);

    const run = document.createElement("button");
    run.type = "button";
    run.className = "vv-button vv-run";
    run.textContent = "RUN PREFLIGHT";
    body.appendChild(run);

    const list = document.createElement("div");
    list.className = "vv-checks";
    body.appendChild(list);

    function renderChecks(data) {
        list.replaceChildren();
        const summary = data?.summary ?? { passes: 0, warnings: 0, failures: 0 };
        badge.textContent = data?.ok ? `${summary.passes} PASS · ${summary.warnings} WARN` : `${summary.failures} FAILED`;
        badge.style.color = data?.ok ? "#c9e0d5" : "#f0c3ca";
        for (const item of data?.checks ?? []) {
            const row = document.createElement("div");
            row.className = "vv-check";
            const dot = document.createElement("span");
            dot.className = `vv-dot ${item.status === "pass" ? "ok" : item.status}`;
            const label = document.createElement("strong");
            label.textContent = item.label;
            const message = document.createElement("em");
            message.textContent = item.message;
            row.append(dot, label, message);
            list.appendChild(row);
        }
        node.setDirtyCanvas?.(true, true);
    }

    async function runCheck() {
        run.disabled = true;
        run.textContent = "CHECKING…";
        badge.textContent = "RUNNING";
        try {
            const response = await api.fetchApi("/velvet_vice/h3/preflight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reference_image: graphReferenceImage(),
                    watermark_enabled: graphWatermarkEnabled(),
                    watermark_name: graphWatermarkName(),
                    ollama_url: graphOllamaUrl(),
                    ollama_required: graphPromptMode() !== "MANUAL",
                    selected_models: graphSelectedModels(),
                    active_loras: graphActiveLoras(),
                    check_ollama: Boolean(value(node, "check_ollama", true)),
                    check_nvenc: Boolean(value(node, "check_nvenc", true)),
                    strict_report: Boolean(value(node, "strict_report", false)),
                    h3_version: graphCompatibilityVersion(),
                }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            renderChecks(await response.json());
        } catch (error) {
            renderChecks({
                ok: false,
                summary: { passes: 0, warnings: 0, failures: 1 },
                checks: [{ label: "Preflight route", status: "fail", message: String(error) }],
            });
        } finally {
            run.disabled = false;
            run.textContent = "RUN PREFLIGHT";
        }
    }
    run.addEventListener("click", runCheck);

    const empty = document.createElement("div");
    empty.className = "vv-empty";
    empty.textContent = "No preflight report yet.";
    list.appendChild(empty);

    addDOM(node, "vv_preflight_surface", "VELVET VICE PREFLIGHT CONSOLE", shell, 545);
    ensureMinimumNodeSize(node,580,620);
    node.vvRunPreflight = runCheck;

    if (Boolean(value(node, "auto_check_on_load", true))) {
        setTimeout(() => node.graph && runCheck(), 1300);
    }
}

function eventNodeId(detail) {
    if (detail == null) return null;
    if (typeof detail === "string" || typeof detail === "number") return String(detail);
    return detail.node != null ? String(detail.node) : null;
}

function isZenH3Node(node) {
    const props = node?.properties ?? {};
    return String(nodeType(node) ?? "").startsWith("VelvetViceZenMiniMaxH3")
        || props.vv_zen_h3_scope === true
        || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

const H3_STAGES = ["SETUP", "PROMPT", "VIDEO", "POST", "OUTPUT"];

function isMiniMaxH3Graph() {
    return (app.graph?._nodes ?? []).some((node) =>
        !isZenH3Node(node) && String(nodeType(node) ?? "").startsWith("VelvetViceMiniMaxH3")
    );
}

function currentOutputStages() {
    return H3_STAGES;
}

function finalOutputStageIndex() {
    return currentOutputStages().length - 1;
}

function graphNodeForStage(rawId) {
    const id = String(rawId ?? "");
    const top = id.split(":")[0];
    return app.graph?.getNodeById?.(Number(top)) ?? null;
}

function stageForH3Node(rawId) {
    const id = String(rawId ?? "");
    const top = id.split(":")[0];
    const graphNode = graphNodeForStage(rawId);
    const type = String(nodeType(graphNode) ?? "");
    const title = String(graphNode?.title ?? "").toUpperCase();

    if (type === OUTPUT_TYPE || top === "2196") return 4;

    if ([MINIMAX_PROMPT_DIRECTOR_TYPE, MINIMAX_FINAL_PROMPT_TYPE, "VelvetViceMiniMaxH3OllamaReleaseBarrier"].includes(type)
        || title.includes("FINAL MINIMAX H3 PROMPT") || title.includes("H3 VISION / PROMPT DIRECTOR")) return 1;

    if (["VelvetViceMiniMaxH3LivePreview", "VelvetViceMiniMaxH3AudioGate", "VelvetViceMiniMaxH3ModelRouter", "VelvetViceMiniMaxH3VAERouter", "VelvetViceMiniMaxH3TurboDirector"].includes(type)
        || title.includes("MINIMAX H3 ENGINE")) return 2;

    if (["VelvetViceMiniMaxH3OutputHub", "VelvetViceMiniMaxH3Director", "VelvetViceMiniMaxH3SystemHub", "VelvetViceMiniMaxH3ProfileManager", "VelvetViceMiniMaxH3SystemCheck", LORA_TYPE].includes(type)
        || title.includes("REFERENCE IMAGE")) return 0;

    if (["RIFEInterpolation", "VelvetViceMiniMaxH3GhostAnalyzer", "VelvetViceMiniMaxH3TemporalAntiGhost", "VelvetViceMiniMaxH3WatermarkOverlay", "VelvetViceMiniMaxH3SingleOutputCleanup", "VelvetViceMiniMaxH3ImageMemoryCheckpoint", "VHS_PruneOutputs", "ComfySwitchNode"].includes(type)
        || title.includes("GHOST") || title.includes("WATERMARK") || title.includes("RIFE") || title.includes("FPS ROUTER") || title.includes("IMAGE ROUTER")) return 3;

    if (["4039", "4042", "4044", "4045", "4051", "3731", "3747", "3748", "2182"].includes(top)) return 3;
    return null;
}

function stageForNode(rawId) {
    return stageForH3Node(rawId);
}

function updateOutputs(stageText, stageIndex = null, progress = null, detail = "") {
    for (const node of liveOutputs) node.vvUpdateOutput?.(stageText, stageIndex, progress, detail);
    for (const node of liveEngines) node.vvUpdateEngine?.(stageIndex, stageText, progress);
}

function installGlobalListeners() {
    if (globalListenersInstalled) return;
    globalListenersInstalled = true;

    api.addEventListener("execution_start", () => {
        for (const node of liveOutputs) {
            node.__vvPendingPreviewMeta = null;
            node.__vvCurrentPreviewFilename = null;
        }
        updateOutputs("WORKFLOW STARTED", 0, 0, "Preparing the Velvet Vice render pipeline");
    });
    api.addEventListener("executing", ({ detail }) => {
        const nodeId = eventNodeId(detail);
        if (nodeId == null) {
            updateOutputs("FINALIZING", finalOutputStageIndex(), null, "Waiting for final output");
            return;
        }
        const stages = currentOutputStages();
        const index = stageForNode(nodeId);
        const graphNode = app.graph?.getNodeById?.(Number(String(nodeId).split(":")[0]));
        const title = graphNode?.title ?? `Node ${nodeId}`;
        updateOutputs(index == null ? "WORKING" : stages[index], index, null, String(title));
    });
    api.addEventListener("progress", ({ detail }) => {
        const max = Number(detail?.max ?? 0);
        const val = Number(detail?.value ?? 0);
        const pct = max > 0 ? Math.max(0, Math.min(1, val / max)) : null;
        const stages = currentOutputStages();
        const index = stageForNode(eventNodeId(detail));
        updateOutputs(index == null ? "WORKING" : stages[index], index, pct, max > 0 ? `${val} / ${max}` : "Working");
    });
    api.addEventListener("execution_error", ({ detail }) => updateOutputs("ERROR", null, null, detail?.exception_message ?? "Execution failed"));
    api.addEventListener("execution_interrupted", () => updateOutputs("INTERRUPTED", null, null, "Execution interrupted"));
    api.addEventListener("execution_success", () => updateOutputs("COMPLETE", finalOutputStageIndex(), 1, "Final MP4 ready"));
    api.addEventListener("velvet_vice.output_status", ({ detail }) => {
        const stage = String(detail?.stage ?? "OUTPUT");
        updateOutputs(stage, finalOutputStageIndex(), stage === "COMPLETE" ? 1 : null, String(detail?.message ?? ""));
        if (detail?.preview) {
            for (const node of liveOutputs) node.__vvPendingPreviewMeta = detail.preview;
        }
    });
    api.addEventListener("executed", ({ detail }) => {
        const output = detail?.output;
        const preview = output?.gifs?.[0];
        const metadata = output?.velvet_vice_preview?.[0] ?? null;
        if (preview) {
            for (const node of liveOutputs) node.vvLoadVideo?.(preview, metadata);
        }
    });
}

function bindNativeControl(node, name, element, parser = (v) => v) {
    const native = widget(node, name);
    if (!native) return;
    element.value = native.value;
    element.addEventListener("change", () => setWidget(node, name, parser(element.value)));
}

function surfaceWidgets(node, prefix) {
    return (node.widgets ?? []).filter((item) =>
        String(item?.name ?? "").startsWith(prefix)
    );
}

function enforceSingleDOMHeader(shell) {
    if (!shell) return;
    const headers = [...shell.querySelectorAll(":scope > .vv-head")];
    for (const duplicate of headers.slice(1)) duplicate.remove();
}

function removeStaleOutputStudio(node) {
    stopNodeOutputMedia(node, { hard: true });
    node.__vvPreviewResizeObserver?.disconnect?.();
    node.__vvPreviewResizeObserver = null;
    try { node.__vvOutputShell?.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
    node.__vvOutputShell = null;
    for (const item of [...(node.widgets ?? [])]) {
        const name = String(item?.name ?? "");
        if (!name.startsWith("vv_output_studio_surface")) continue;
        try { item.onRemove?.(); } catch (_) {}
        try { item.element?.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
        try { item.inputEl?.closest?.(".dom-widget")?.remove?.(); } catch (_) {}
        try { item.element?.remove?.(); } catch (_) {}
        try { item.inputEl?.remove?.(); } catch (_) {}
    }
    if (Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((item) => !String(item?.name ?? "").startsWith("vv_output_studio_surface"));
    }
}

function installOutputStudio(node) {
    purgeLegacyOutputPreview(node);
    const currentSurfaces = surfaceWidgets(node, "vv_output_studio_surface");
    if (
        node.__vvOutputVersion === OUTPUT_STUDIO_VERSION &&
        currentSurfaces.length === 1 &&
        Boolean(node.__vvOutputShell)
    ) {
        enforceSingleDOMHeader(node.__vvOutputShell);
        return;
    }
    removeStaleOutputStudio(node);
    node.__vvOutputInstalled = true;
    node.__vvOutputVersion = OUTPUT_STUDIO_VERSION;
    installStyle();
    installGlobalListeners();
    liveOutputs.add(node);
    setTimeout(() => syncProjectNameFromHub(), 0);

    for (const item of node.widgets ?? []) hideWidget(item);

    const shell = document.createElement("div");
    shell.className = "vv-shell";
    node.__vvOutputShell = shell;
    const pipelineStages = currentOutputStages();
    const isH3OutputStudio = pipelineStages === H3_STAGES;
    if (isH3OutputStudio) shell.classList.add("vv-h3-output-studio");
    const { head, badge } = isH3OutputStudio
        ? createHeader("VELVET VICE · H3 OUTPUT STUDIO", "READY", node)
        : createHeader("VELVET VICE · OUTPUT STUDIO", "READY", node);
    shell.appendChild(head);
    const body = document.createElement("div");
    body.className = "vv-body";
    shell.appendChild(body);

    const status = document.createElement("div");
    status.className = "vv-status";
    const statusTextWrap = document.createElement("div");
    const statusTitle = document.createElement("div");
    statusTitle.className = "vv-status-title";
    statusTitle.textContent = "READY";
    const statusDetail = document.createElement("div");
    statusDetail.className = "vv-status-detail";
    statusDetail.textContent = isH3OutputStudio ? "Queue H3 to begin the native setup → prompt → video → post → output pipeline." : "Queue the workflow to start the live monitor.";
    statusTextWrap.append(statusTitle, statusDetail);
    const fpsBadge = document.createElement("div");
    fpsBadge.className = "vv-badge";
    fpsBadge.textContent = isH3OutputStudio ? "H3 SINGLE PASS" : "SINGLE ENCODE";
    status.append(statusTextWrap, fpsBadge);
    body.appendChild(status);

    const stageRow = document.createElement("div");
    stageRow.className = isH3OutputStudio ? "vv-stage-row vv-h3-stage-row" : "vv-stage-row";
    const stageBars = pipelineStages.map((label, index) => {
        const bar = document.createElement("div");
        bar.className = isH3OutputStudio ? "vv-stage vv-h3-stage" : "vv-stage";
        if (isH3OutputStudio) {
            const dot = document.createElement("span"); dot.className = "vv-h3-stage-dot"; dot.textContent = String(index + 1);
            const name = document.createElement("span"); name.className = "vv-h3-stage-name"; name.textContent = label;
            bar.append(dot, name);
        }
        stageRow.appendChild(bar);
        return bar;
    });
    body.appendChild(stageRow);

    if (!isH3OutputStudio) {
        const stageLabelsWrap = document.createElement("div");
        stageLabelsWrap.style.display = "grid";
        stageLabelsWrap.style.gridTemplateColumns = `repeat(${pipelineStages.length},1fr)`;
        stageLabelsWrap.style.gap = "5px";
        stageLabelsWrap.style.fontSize = "8px";
        stageLabelsWrap.style.color = "#77828d";
        stageLabelsWrap.style.textAlign = "center";
        for (const label of pipelineStages) {
            const item = document.createElement("span"); item.textContent = label; stageLabelsWrap.appendChild(item);
        }
        body.appendChild(stageLabelsWrap);
    }

    const progressTrack = document.createElement("div");
    progressTrack.className = "vv-progress-track";
    const progress = document.createElement("div");
    progress.className = "vv-progress";
    progressTrack.appendChild(progress);
    body.appendChild(progressTrack);

    const videoFrame = document.createElement("div");
    videoFrame.className = "vv-video-frame";
    const video = document.createElement("video");
    video.className = "vv-video";
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "metadata";
    node.__vvOutputVideo = video;
    outputStudioMedia.add(video);
    video.addEventListener("play", () => stopOtherOutputMedia(video));
    video.addEventListener("pause", () => stopOtherOutputMedia(video));
    videoFrame.appendChild(video);
    const playerShell = document.createElement("div");
    playerShell.className = "vv-player-shell";
    playerShell.appendChild(videoFrame);
    body.appendChild(playerShell);
    const videoMeta = document.createElement("div");
    videoMeta.className = "vv-video-meta";
    videoMeta.style.display = "none";
    body.appendChild(videoMeta);
    const empty = document.createElement("div");
    empty.className = "vv-empty";
    empty.textContent = isH3OutputStudio ? "The final MP4 appears here after the native H3 render and final encode." : "The final MP4 appears here after the single final encode.";
    body.appendChild(empty);

    const advanced = document.createElement("details");
    advanced.className = "vv-advanced";
    const summary = document.createElement("summary");
    summary.textContent = "Encoder settings";
    advanced.appendChild(summary);
    const advGrid = document.createElement("div");
    advGrid.className = "vv-advanced-grid";
    advanced.appendChild(advGrid);

    const encoder = document.createElement("select");
    encoder.className = "vv-mini";
    for (const optionValue of [
        "AUTO — NVIDIA NVENC / CPU H.264 FALLBACK",
        "NVIDIA NVENC ONLY",
        "CPU H.264 ONLY",
    ]) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue.startsWith("AUTO") ? "AUTO" : optionValue.startsWith("NVIDIA") ? "NVENC" : "CPU";
        encoder.appendChild(option);
    }
    bindNativeControl(node, "encoder_mode", encoder);

    const bitrate = document.createElement("input");
    bitrate.className = "vv-mini";
    bitrate.type = "number";
    bitrate.min = "1";
    bitrate.max = "999";
    bitrate.title = "NVENC Mbit/s at 24 FPS";
    bindNativeControl(node, "nvenc_bitrate_mbps_at_24fps", bitrate, Number);

    const crf = document.createElement("input");
    crf.className = "vv-mini";
    crf.type = "number";
    crf.min = "0";
    crf.max = "100";
    crf.title = "CPU CRF";
    bindNativeControl(node, "cpu_crf", crf, Number);
    advGrid.append(encoder, bitrate, crf);
    body.appendChild(advanced);

    shell.dataset.vvSurface = "output-studio-v1115";
    const domWidget = addDOM(node, "vv_output_studio_surface_v1115", "VELVET VICE OUTPUT STUDIO", shell, 610);
    domWidget.previewMeta = null;
    domWidget.previewHeight = 0;
    // The working v1.1.7 player let the shell report its real content height.
    // The fixed min-height introduced later fed back into scrollHeight and kept
    // portrait/landscape layouts at the wrong geometry. Remove those fixed
    // shell constraints while still exposing the current ComfyUI layout API.
    shell.style.removeProperty("height");
    shell.style.removeProperty("min-height");
    const outputLayout = { height: 430 };
    const setOutputWidgetHeight = (height) => {
        outputLayout.height = Math.max(430, Math.ceil(Number(height) || 430));
        domWidget.computeSize = (width) => [width, outputLayout.height];
        domWidget.computeLayoutSize = () => ({
            minHeight: outputLayout.height,
            maxHeight: Infinity,
        });
        domWidget.options ??= {};
        domWidget.options.getMinHeight = () => outputLayout.height;
        domWidget.options.getMaxHeight = () => Infinity;
        domWidget.options.getHeight = () => outputLayout.height;
    };
    setOutputWidgetHeight(430);

    const gcd = (a, b) => {
        let x = Math.max(1, Math.round(Math.abs(a)));
        let y = Math.max(1, Math.round(Math.abs(b)));
        while (y) [x, y] = [y, x % y];
        return x;
    };
    const ratioText = (width, height) => {
        const divisor = gcd(width, height);
        const rw = Math.round(width / divisor);
        const rh = Math.round(height / divisor);
        return rw <= 64 && rh <= 64 ? `${rw}:${rh}` : `${(width / height).toFixed(2)}:1`;
    };
    const normalizedMeta = (meta = null) => {
        const width = Number(meta?.width ?? video.videoWidth ?? 0);
        const height = Number(meta?.height ?? video.videoHeight ?? 0);
        const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
        return { width, height, ratio, frames: Number(meta?.frames ?? 0), fps: Number(meta?.fps ?? 0) };
    };
    const previewLayout = (meta) => {
        const ratio = Math.max(0.05, meta.ratio);
        let playerWidth;
        let playerHeight;
        let nodeWidth;
        if (ratio < 0.86) {
            playerHeight = 570;
            playerWidth = playerHeight * ratio;
            nodeWidth = Math.max(420, Math.min(520, playerWidth + 76));
        } else if (ratio <= 1.16) {
            playerWidth = 530;
            playerHeight = playerWidth / ratio;
            nodeWidth = playerWidth + 52;
        } else {
            playerWidth = ratio > 2.05 ? 760 : 700;
            playerHeight = playerWidth / ratio;
            if (playerHeight > 440) {
                playerHeight = 440;
                playerWidth = playerHeight * ratio;
            }
            nodeWidth = Math.min(840, Math.max(620, playerWidth + 52));
        }
        return {
            playerWidth: Math.round(playerWidth),
            playerHeight: Math.round(playerHeight),
            nodeWidth: Math.round(nodeWidth),
        };
    };
    const ensurePreviewFits = (width, height) => {
        const next = [
            Math.max(Math.round(width), Number(node.size?.[0] ?? 0)),
            Math.max(Math.round(height), Number(node.size?.[1] ?? 0)),
        ];
        if (next[0] !== Number(node.size?.[0] ?? 0) || next[1] !== Number(node.size?.[1] ?? 0)) {
            node.setSize?.(next);
            try { node.onResize?.(next); } catch (_) {}
        }
        node.graph?.setDirtyCanvas?.(true, true);
        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    };
    const applyPreviewGeometry = (metaOverride = null) => {
        const meta = normalizedMeta(metaOverride ?? domWidget.previewMeta ?? node.__vvPendingPreviewMeta);
        if (!meta.width || !meta.height) return;
        domWidget.previewMeta = meta;
        const layout = previewLayout(meta);

        // All four layers change together: MP4, player raster, DOM widget and LiteGraph node.
        playerShell.style.setProperty("block-size", `${layout.playerHeight}px`, "important");
        playerShell.style.setProperty("height", `${layout.playerHeight}px`, "important");
        videoFrame.style.setProperty("inline-size", `${layout.playerWidth}px`, "important");
        videoFrame.style.setProperty("block-size", `${layout.playerHeight}px`, "important");
        videoFrame.style.setProperty("width", `${layout.playerWidth}px`, "important");
        videoFrame.style.setProperty("height", `${layout.playerHeight}px`, "important");
        videoFrame.style.setProperty("min-width", `${layout.playerWidth}px`, "important");
        videoFrame.style.setProperty("max-width", `${layout.playerWidth}px`, "important");
        videoFrame.style.setProperty("min-height", `${layout.playerHeight}px`, "important");
        videoFrame.style.setProperty("max-height", `${layout.playerHeight}px`, "important");
        videoFrame.style.aspectRatio = `${meta.width} / ${meta.height}`;
        video.style.setProperty("width", `${layout.playerWidth}px`, "important");
        video.style.setProperty("height", `${layout.playerHeight}px`, "important");
        video.style.aspectRatio = `${meta.width} / ${meta.height}`;
        video.style.objectFit = "contain";

        videoFrame.classList.toggle("portrait", meta.ratio < 0.98);
        videoFrame.classList.toggle("landscape", meta.ratio > 1.02);
        videoFrame.classList.toggle("square", Math.abs(meta.ratio - 1) < 0.02);
        const orientation = meta.ratio < 0.98 ? "PORTRAIT" : meta.ratio > 1.02 ? "LANDSCAPE" : "SQUARE";
        const timing = meta.frames ? ` · ${meta.frames} FRAMES${meta.fps ? ` @ ${Number(meta.fps).toFixed(0)} FPS` : ""}` : "";
        videoMeta.textContent = `${meta.width} × ${meta.height} · ${ratioText(meta.width, meta.height)} · ${orientation}${timing}`;
        videoMeta.style.display = "block";

        requestAnimationFrame(() => {
            // Match the stable v1.1.7 calculation: measure real content only,
            // never a previously forced shell minimum.
            const nonPlayerHeight = Math.max(315, shell.scrollHeight - videoFrame.offsetHeight);
            const targetHeight = nonPlayerHeight + layout.playerHeight + 38;
            setOutputWidgetHeight(targetHeight - 56);
            ensurePreviewFits(layout.nodeWidth, targetHeight);
            requestAnimationFrame(() => ensurePreviewFits(layout.nodeWidth, targetHeight));
        });
    };
    // Do not observe the shell itself: its rendered height is influenced by
    // the LiteGraph node, which would feed back into targetHeight and grow the
    // node forever. Video metadata events are the only geometry authority.
    node.__vvPreviewResizeObserver = null;

    node.vvUpdateOutput = (text, index, pct, detailText) => {
        const activeIndex = index == null ? null : Math.max(0, Math.min(stageBars.length - 1, Number(index)));
        statusTitle.textContent = text || "WORKING";
        statusDetail.textContent = detailText || "Working";
        badge.textContent = text === "ERROR" ? "FAILED" : text === "COMPLETE" ? "VIDEO READY" : "LIVE";
        stageBars.forEach((bar, barIndex) => {
            bar.classList.toggle("done", activeIndex != null && barIndex < activeIndex);
            bar.classList.toggle("active", activeIndex != null && barIndex === activeIndex);
            bar.classList.toggle("error", text === "ERROR" && barIndex === (activeIndex ?? 0));
        });
        if (pct == null) {
            progress.style.width = "18%";
            progress.style.opacity = ".45";
        } else {
            progress.style.opacity = "1";
            progress.style.width = `${Math.round(pct * 100)}%`;
        }
        node.setDirtyCanvas?.(true, true);
    };

    node.vvLoadVideo = (preview, metadata = null) => {
        if (!preview?.filename) return;
        try { video.pause(); } catch (_) {}
        stopOtherOutputMedia(video);
        const params = new URLSearchParams({
            filename: preview.filename,
            subfolder: preview.subfolder ?? "",
            type: preview.type ?? "output",
            t: String(Date.now()),
        });
        statusTitle.textContent = "LOADING FINAL VIDEO";
        statusDetail.textContent = preview.filename;
        node.__vvCurrentPreviewFilename = preview.filename;
        domWidget.previewMeta = normalizedMeta(metadata ?? node.__vvPendingPreviewMeta);
        if (domWidget.previewMeta.width && domWidget.previewMeta.height) {
            applyPreviewGeometry(domWidget.previewMeta);
        }
        videoFrame.classList.remove("visible");
        videoMeta.style.display = "none";
        empty.style.display = "block";
        empty.textContent = "Loading saved MP4…";
        video.removeAttribute("width");
        video.removeAttribute("height");
        for (const property of ["height", "block-size"]) playerShell.style.removeProperty(property);
        for (const property of [
            "inline-size", "block-size", "width", "height",
            "min-width", "max-width", "min-height", "max-height", "aspect-ratio",
        ]) videoFrame.style.removeProperty(property);
        for (const property of ["width", "height", "aspect-ratio"]) video.style.removeProperty(property);
        video.src = api.apiURL(`/view?${params}`);
        video.load();
    };

    video.addEventListener("loadedmetadata", () => {
        // The MP4 container is the final authority. Backend tensor metadata is
        // useful while loading, but must never keep the previous render ratio.
        const browserMeta = normalizedMeta({
            width: video.videoWidth,
            height: video.videoHeight,
            frames: domWidget.previewMeta?.frames ?? 0,
            fps: domWidget.previewMeta?.fps ?? 0,
        });
        const authoritative = browserMeta.width && browserMeta.height
            ? browserMeta
            : normalizedMeta(domWidget.previewMeta);
        domWidget.previewMeta = authoritative;
        node.__vvPendingPreviewMeta = authoritative;
        videoFrame.classList.add("visible");
        empty.style.display = "none";
        applyPreviewGeometry(authoritative);
        setTimeout(() => applyPreviewGeometry(authoritative), 80);
        setTimeout(() => applyPreviewGeometry(authoritative), 300);
        setTimeout(() => applyPreviewGeometry(authoritative), 700);
        statusTitle.textContent = "FINAL VIDEO READY";
        statusDetail.textContent = "Player raster and complete node now follow the rendered frame geometry.";
        badge.textContent = "VIDEO READY";
        progress.style.width = "100%";
        progress.style.opacity = "1";
        stageBars.forEach((bar) => { bar.classList.add("done"); bar.classList.remove("active"); });
        video.play().catch(() => {});
        node.setDirtyCanvas?.(true, true);
    });
    video.addEventListener("resize", () => {
        if (!video.videoWidth || !video.videoHeight) return;
        const refreshed = normalizedMeta({
            width: video.videoWidth,
            height: video.videoHeight,
            frames: domWidget.previewMeta?.frames ?? 0,
            fps: domWidget.previewMeta?.fps ?? 0,
        });
        domWidget.previewMeta = refreshed;
        node.__vvPendingPreviewMeta = refreshed;
        applyPreviewGeometry(refreshed);
    });
    video.addEventListener("error", () => {
        videoFrame.classList.remove("visible");
        videoMeta.style.display = "none";
        empty.style.display = "block";
        empty.textContent = "The MP4 was saved, but the browser could not load the preview.";
        statusTitle.textContent = "PREVIEW LOAD ERROR";
        badge.textContent = "SAVED";
    });

    ensureMinimumNodeSize(node,isH3OutputStudio?760:630,700);
}


function nativePanelWidgets(node) {
    return (node.widgets ?? []).filter((item) => !String(item?.name ?? "").startsWith("vv_") && !item?.__vvHidden);
}
function controlForWidget(node, native, labelText) {
    const row = document.createElement("div");
    row.className = "vv-control-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    const values = native?.options?.values;
    if (native?.type === "toggle" || typeof native?.value === "boolean") {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.justifyContent = "flex-end";
        const toggle = createSwitch(Boolean(native.value), (next) => {
            native.value = next; native.callback?.(next); node.setDirtyCanvas?.(true, true);
        });
        wrap.appendChild(toggle); row.appendChild(wrap);
    } else if (Array.isArray(values)) {
        const select = document.createElement("select");
        for (const item of values) { const option = document.createElement("option"); option.value = item; option.textContent = String(item); select.appendChild(option); }
        select.value = native.value;
        select.addEventListener("change", () => { native.value = select.value; native.callback?.(select.value); node.setDirtyCanvas?.(true, true); });
        row.appendChild(select);
    } else {
        const input = document.createElement("input");
        input.type = typeof native?.value === "number" ? "number" : "text";
        input.value = native?.value ?? "";
        input.addEventListener("change", () => {
            const next = typeof native?.value === "number" ? Number(input.value) : input.value;
            native.value = next; native.callback?.(next); node.setDirtyCanvas?.(true, true);
        });
        row.appendChild(input);
    }
    return row;
}
function waitForNativeWidgets(node, count, callback, attempt = 0) {
    const candidates = nativePanelWidgets(node);
    if (candidates.length >= count || attempt > 24) { callback(candidates); return; }
    setTimeout(() => waitForNativeWidgets(node, count, callback, attempt + 1), 80);
}
function installModelLoadoutPanel(node) {
    if (node.__vvModelPanelInstalled) return;
    node.__vvModelPanelInstalled = true;
    installStyle();
    waitForNativeWidgets(node, 8, (native) => {
        if (node.__vvModelPanelBuilt) return;
        node.__vvModelPanelBuilt = true;
        const labels = ["Safetensors engine", "GGUF engine", "Safetensors model", "GGUF model", "Spatial upscaler", "Audio VAE", "Video VAE", "Text encoder + projection", "GGUF text encoder", "SageAttention", "Distilled LoRA", "Distilled file", "Distilled strength", "Sampler", "Seed", "Resolution", "Swap aspect", "Prompt enhancer"];
        const shell = document.createElement("div"); shell.className = "vv-shell";
        const compatibilityVersion = graphCompatibilityVersion();
        const { head, badge } = createHeader("VELVET VICE · MODEL LOADOUT", `MiniMax H3 · PACK ${PACK_VERSION}`, node); shell.appendChild(head);
        const body = document.createElement("div"); body.className = "vv-body"; shell.appendChild(body);
        const intro = document.createElement("div"); intro.className = "vv-lora-intro";
        intro.textContent = "Choose one section at a time. All controls still write directly to the protected DaSiWa loadout.";
        body.appendChild(intro);
        const groups = [
            { title: "ENGINE", indices: [0,1,2,3,9] },
            { title: "VAE + TEXT", indices: [4,5,6,7,8,17] },
            { title: "SAMPLING", indices: [10,11,12,13,14] },
            { title: "RESOLUTION", indices: [15,16] },
        ];
        const tabbar = document.createElement("div"); tabbar.className = "vv-tabbar"; body.appendChild(tabbar);
        const panels = [];
        function activate(index) {
            panels.forEach((entry, i) => { entry.button.classList.toggle("active", i === index); entry.panel.hidden = i !== index; });
            badge.textContent = `${groups[index]?.title ?? "LOADOUT"} · MiniMax H3`;
            node.setDirtyCanvas?.(true, true);
        }
        groups.forEach((group, groupIndex) => {
            const button = document.createElement("button"); button.type="button"; button.className="vv-tab"; button.textContent=group.title; tabbar.appendChild(button);
            const panel = document.createElement("div"); panel.className="vv-tab-panel";
            const card = document.createElement("div"); card.className="vv-module-card wide";
            const heading = document.createElement("div"); heading.className="vv-module-title"; heading.textContent=group.title; card.appendChild(heading);
            for (const index of group.indices) if (native[index]) card.appendChild(controlForWidget(node, native[index], labels[index] ?? native[index].name));
            panel.appendChild(card); body.appendChild(panel); panels.push({button,panel});
            button.addEventListener("click",()=>activate(groupIndex));
        });
        if (!native.length) {
            const fallback=document.createElement("div");fallback.className="vv-module-card wide";fallback.innerHTML='<div class="vv-module-title">SERVICE ADAPTER</div><div class="vv-module-value">Promoted controls are unavailable. Double-click the module to open the protected loadout.</div>';body.appendChild(fallback);
        }
        for (const item of native) hideWidget(item);
        const foot=document.createElement("div");foot.className="vv-foot";foot.innerHTML='<span>Protected DaSiWa loadout</span><span>MODEL / VAE / CLIP</span>';body.appendChild(foot);
        addDOM(node,"vv_model_loadout_surface","VELVET VICE MODEL LOADOUT",shell,500);
        ensureMinimumNodeSize(node,660,650);
        activate(0);
    });
}
function installRenderEnginePanel(node) {
    if (node.__vvEnginePanelInstalled) return;
    node.__vvEnginePanelInstalled = true;
    installStyle(); liveEngines.add(node);
    waitForNativeWidgets(node, 2, (native) => {
        if (node.__vvEnginePanelBuilt) return;
        node.__vvEnginePanelBuilt = true;
        const shell = document.createElement("div"); shell.className = "vv-shell";
        const { head, badge } = createHeader("VELVET VICE · RENDER ENGINE", "8 → 4 → 2", node); shell.appendChild(head);
        const body = document.createElement("div"); body.className = "vv-body"; shell.appendChild(body);
        const passGrid = document.createElement("div"); passGrid.className = "vv-pass-grid";
        const cards = [["PASS 1","8 STEPS · END 1.00"],["PASS 2","4 STEPS · END 0.40"],["PASS 3","2 STEPS · END 0.20"]].map(([name,meta]) => {
            const card=document.createElement("div"); card.className="vv-pass-card";
            const n=document.createElement("div"); n.className="vv-pass-name"; n.textContent=name;
            const m=document.createElement("div"); m.className="vv-pass-meta"; m.textContent=meta;
            card.append(n,m); passGrid.appendChild(card); return card;
        });
        body.appendChild(passGrid);
        const switches=document.createElement("div"); switches.className="vv-grid";
        const labels=["Triton VAE","Tiled VAE","Second pass","Third pass"];
        native.slice(0,4).forEach((item,index)=>{
            const row=document.createElement("div"); row.className="vv-toggle"; const label=document.createElement("span"); label.textContent=labels[index]??item.name;
            const toggle=createSwitch(Boolean(item.value),(next)=>{item.value=next;item.callback?.(next);}); row.append(label,toggle); switches.appendChild(row);
        });
        body.appendChild(switches);
        const status=document.createElement("div"); status.className="vv-foot"; status.innerHTML='<span>Waiting for render</span><span>LATENT CORE PROTECTED</span>'; body.appendChild(status);
        for (const item of native) hideWidget(item);
        addAdaptiveDOM(node,"vv_render_engine_surface","VELVET VICE RENDER ENGINE",shell,430,700,86); ensureMinimumNodeSize(node,700,540);
        node.vvUpdateEngine=(stageIndex, stageText, progress)=>{
            const passIndex=stageIndex===2?0:stageIndex===3?1:stageIndex===4?2:null;
            cards.forEach((card,index)=>{card.classList.toggle("active",index===passIndex);card.classList.toggle("done",passIndex!=null&&index<passIndex||stageIndex>4);});
            badge.textContent=passIndex==null?(stageIndex>4?"COMPLETE":"8 → 4 → 2"):`PASS ${passIndex+1} ACTIVE`;
            status.firstElementChild.textContent=stageText||"Working";
        };
    });
}
function installLoraStudio(node) {
    const uiVersion = "1.1.15-draggable-single-header";
    // nodeCreated, loadedGraphNode and afterConfigureGraph can run before the
    // frontend has attached the first DOM wrapper. The shell reference is the
    // stable installation marker; checking isConnected here would create two
    // or three wrappers during that short mounting window.
    const panelKnown = Boolean(node.__vvPowerLoraShell) &&
        surfaceWidgets(node, "vv_power_lora_surface").length === 1;
    if (node.__vvPowerLoraVersion === uiVersion && panelKnown) {
        // nodeCreated runs before a loaded workflow has finished restoring its
        // serialized widget values.  Re-read the native lora_stack_json on the
        // later loadedGraphNode/afterConfigureGraph passes so the visible DOM
        // stack always reflects the workflow that ComfyUI actually restored.
        node.__vvPowerLoraSyncFromNative?.();
        enforceSingleDOMHeader(node.__vvPowerLoraShell);
        return;
    }

    node.__vvLoraCleanup?.();
    node.__vvPowerLoraShell?.closest?.(".dom-widget")?.remove?.();
    const staleWidgets = (node.widgets ?? []).filter((item) =>
        String(item?.name ?? "").startsWith("vv_power_lora_surface")
    );
    for (const item of staleWidgets) {
        item?.element?.closest?.(".dom-widget")?.remove?.();
        item?.inputEl?.closest?.(".dom-widget")?.remove?.();
        item?.element?.remove?.();
        item?.inputEl?.remove?.();
    }
    if (staleWidgets.length && Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((item) => !staleWidgets.includes(item));
    }
    node.__vvPowerLoraInstalled = true;
    node.__vvPowerLoraVersion = uiVersion;
    installStyle();

    const natives = (node.widgets ?? []).filter((item) => !String(item?.name ?? "").startsWith("vv_"));
    const byName = Object.fromEntries(natives.map((item) => [String(item?.name ?? ""), item]));
    const jsonWidget = byName.lora_stack_json ?? natives[0];
    const catalogWidget = byName.lora_catalog ?? natives[1];
    if (!jsonWidget || !catalogWidget) {
        node.__vvPowerLoraInstalled = false;
        node.__vvPowerLoraVersion = null;
        setTimeout(() => installLoraStudio(node), 80);
        return;
    }

    let liveCatalog = Array.from(new Set(["None", ...(catalogWidget?.options?.values ?? [])]));
    let catalogReady = liveCatalog.length > 1;
    let catalogRequest = null;
    const catalogValues = () => liveCatalog;
    const refreshCatalog = async (force = false) => {
        if (!force && catalogReady) return liveCatalog;
        if (catalogRequest && !force) return catalogRequest;
        catalogRequest = (async () => {
            try {
                const response = await api.fetchApi("/velvet_vice/h3/lora/catalog", { method: "GET" });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (Array.isArray(data?.items)) {
                    liveCatalog = Array.from(new Set(["None", ...data.items.map(String)]));
                    catalogReady = true;
                }
            } catch (_) {
                liveCatalog = Array.from(new Set(["None", ...(catalogWidget?.options?.values ?? [])]));
                catalogReady = liveCatalog.length > 1;
            } finally {
                catalogRequest = null;
            }
            return liveCatalog;
        })();
        return catalogRequest;
    };
    const normalizeLoraSearch = (value) => String(value ?? "")
        .toLocaleLowerCase()
        .replace(/[\\/_\-.()[\]{}]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const loraBaseName = (value) => String(value ?? "").split(/[\\/]/).pop() || String(value ?? "");
    const loraFolderName = (value) => {
        const parts = String(value ?? "").split(/[\\/]/);
        parts.pop();
        return parts.join(" / ");
    };
    const matchingLoras = (query, limit = 80, allowEmpty = false) => {
        const normalizedQuery = normalizeLoraSearch(query);
        const terms = normalizedQuery.split(" ").filter(Boolean);
        if (!terms.length && !allowEmpty) return [];
        const items = catalogValues().filter((item) => item !== "None");
        const ranked = items
            .filter((item) => {
                if (!terms.length) return true;
                const haystack = normalizeLoraSearch(item);
                return terms.every((term) => haystack.includes(term));
            })
            .map((item) => {
                const full = normalizeLoraSearch(item);
                const base = normalizeLoraSearch(loraBaseName(item));
                let score = 30;
                if (normalizedQuery && base === normalizedQuery) score = 0;
                else if (normalizedQuery && base.startsWith(normalizedQuery)) score = 4;
                else if (terms.length && terms.every((term) => base.includes(term))) score = 8;
                else if (normalizedQuery && full.startsWith(normalizedQuery)) score = 12;
                return {item, score};
            });
        ranked.sort((a, b) => a.score - b.score || a.item.length - b.item.length || a.item.localeCompare(b.item));
        return ranked.slice(0, limit).map((entry) => entry.item);
    };
    const setNative = (item, next) => {
        if (!item) return;
        item.value = next;
        item.callback?.(next);
        node.graph?.setDirtyCanvas?.(true, true);
        node.setDirtyCanvas?.(true, true);
    };
    const sanitizeSlot = (item, index) => ({
        id: String(item?.id ?? `slot-${Date.now()}-${index}`),
        enabled: item?.enabled !== false,
        lora: String(item?.lora ?? item?.filename ?? "None"),
        mode: ["FULL", "VIDEO", "AUDIO"].includes(String(item?.mode ?? "FULL").toUpperCase()) ? String(item?.mode ?? "FULL").toUpperCase() : "FULL",
        video_strength: Math.max(-4, Math.min(4, Number(item?.video_strength ?? item?.strength ?? 1) || 0)),
        audio_strength: Math.max(-4, Math.min(4, Number(item?.audio_strength ?? item?.strength ?? 1) || 0)),
        clip_strength: Math.max(-4, Math.min(4, Number(item?.clip_strength ?? item?.strength_clip ?? 0) || 0)),
        analysis: item?.analysis ?? null,
    });
    const parseStack = () => {
        try {
            const parsed = JSON.parse(String(jsonWidget?.value || "[]"));
            return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === "object").slice(0, 64).map(sanitizeSlot) : [];
        } catch (_) { return []; }
    };
    let stack = parseStack();
    let activeSlotIndex = stack.findIndex((slot) => !slot.lora || slot.lora === "None");
    let pendingFocusSlotId = null;
    const persisted = () => stack.map(({analysis, ...slot}) => slot);
    const saveStack = () => setNative(jsonWidget, JSON.stringify(persisted()));
    const stackSignature = (items) => JSON.stringify(items.map(({analysis, ...slot}) => slot));
    const analysisCache = new Map();

    const shell = document.createElement("div");
    shell.className = "vv-shell vv-power-shell";
    const isH3PowerLora = /MINIMAX H3|H3 POWER/i.test(String(node.title || ""));
    if (isH3PowerLora) { shell.classList.add("vv-h3-power-lora"); shell.dataset.h3Role = "setup"; }
    const { head, badge } = isH3PowerLora
        ? createHeader("VELVET VICE · H3 POWER LoRA AV", "0 ACTIVE", node)
        : createHeader("VELVET VICE · POWER LoRA AV", "0 ACTIVE", node);
    shell.appendChild(head);
    const body = document.createElement("div"); body.className = "vv-body"; shell.appendChild(body);

    const toolbar = document.createElement("div"); toolbar.className = "vv-power-toolbar";
    const count = document.createElement("div"); count.className = "vv-lora-stack-title"; count.textContent = "POWER LORA STACK";
    const actions = document.createElement("div"); actions.className = "vv-power-actions";
    const add = document.createElement("button"); add.type = "button"; add.className = "vv-lora-add"; add.textContent = "+ ADD LORA";
    const disableAll = document.createElement("button"); disableAll.type = "button"; disableAll.className = "vv-button"; disableAll.textContent = "DISABLE ALL";
    const clear = document.createElement("button"); clear.type = "button"; clear.className = "vv-button"; clear.textContent = "CLEAR";
    actions.append(add, disableAll, clear); toolbar.append(count, actions); body.appendChild(toolbar);

    // Independent quick search: works without pressing + ADD LORA or selecting an existing stack row.
    // Selecting a result creates a new standard LoRA slot and leaves the classic stack picker untouched.
    const quickSearchWrap = document.createElement("div"); quickSearchWrap.className = "vv-power-search-wrap";
    const quickSearchBar = document.createElement("div"); quickSearchBar.className = "vv-power-search";
    const quickSearchIcon = document.createElement("div"); quickSearchIcon.className = "vv-power-search-icon"; quickSearchIcon.textContent = "SEARCH";
    const quickSearchInput = document.createElement("input"); quickSearchInput.type = "text"; quickSearchInput.className = "vv-power-search-input";
    quickSearchInput.placeholder = "Search LoRAs and add directly to the stack…";
    quickSearchInput.autocomplete = "off"; quickSearchInput.spellcheck = false;
    quickSearchInput.title = "Independent LoRA search by name, folder, or multiple terms";
    quickSearchInput.dataset.vvSearchVersion = uiVersion;
    const quickSearchCount = document.createElement("div"); quickSearchCount.className = "vv-power-search-count"; quickSearchCount.textContent = "0 AVAILABLE";
    const quickSearchClear = document.createElement("button"); quickSearchClear.type = "button"; quickSearchClear.className = "vv-power-search-clear"; quickSearchClear.textContent = "×"; quickSearchClear.title = "Clear search"; quickSearchClear.disabled = true;
    quickSearchBar.append(quickSearchIcon, quickSearchInput, quickSearchCount, quickSearchClear);
    const quickSearchResults = document.createElement("div"); quickSearchResults.className = "vv-power-search-results vv-power-search-floating"; quickSearchResults.setAttribute("role", "listbox");
    quickSearchWrap.appendChild(quickSearchBar); body.appendChild(quickSearchWrap);
    document.body.appendChild(quickSearchResults);
    node.__vvQuickLoraPopup = quickSearchResults;
    node.__vvQuickLoraSearchInput = quickSearchInput;
    node.__vvQuickLoraSearchWrap = quickSearchWrap;

    const header = document.createElement("div"); header.className = "vv-power-head";
    for (const label of ["ON", "LORA / SEARCH", "MODE", "VIDEO", "AUDIO", "CLIP", "TYPE", "ORDER"]) {
        const cell = document.createElement("div"); cell.textContent = label; header.appendChild(cell);
    }
    body.appendChild(header);
    const list = document.createElement("div"); list.className = "vv-power-list"; body.appendChild(list);
    const summary = document.createElement("div"); summary.className = "vv-power-summary"; summary.innerHTML = '<span>TOP → BOTTOM APPLICATION ORDER</span><span class="vv-power-count">0 LORAS</span>'; body.appendChild(summary);

    const popup = document.createElement("div");
    popup.className = "vv-lora-picker-popup";
    popup.setAttribute("role", "listbox");
    document.body.appendChild(popup);
    node.__vvLoraPopup = popup;
    let editor = null;

    const positionPopup = () => {
        if (!editor?.input?.isConnected || !popup.classList.contains("open")) return;
        const rect = editor.input.getBoundingClientRect();
        const desiredWidth = Math.max(rect.width + 30, 360);
        const width = Math.min(desiredWidth, Math.max(260, window.innerWidth - 20));
        const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
        let top = rect.bottom + 5;
        const estimatedHeight = Math.min(280, Math.max(70, popup.scrollHeight || 180));
        if (top + estimatedHeight > window.innerHeight - 10 && rect.top > estimatedHeight + 10) {
            top = Math.max(10, rect.top - estimatedHeight - 5);
        }
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.width = `${width}px`;
    };
    const closePicker = (revert = false) => {
        if (revert && editor?.input?.isConnected) {
            editor.input.value = editor.slot.lora === "None" ? "" : editor.slot.lora;
            editor.input.title = editor.slot.lora === "None" ? "Search LoRA" : editor.slot.lora;
        }
        popup.classList.remove("open");
        popup.replaceChildren();
        editor = null;
    };
    const commitLora = (slot, filename) => {
        if (!slot || !filename || filename === "None") return;
        slot.lora = filename;
        slot.enabled = true;
        slot.analysis = null;
        saveStack();
        closePicker(false);
        render();
        analyzeSlot(slot);
    };

    let quickMatches = [];
    let quickActiveIndex = -1;
    const positionQuickSearch = () => {
        if (!quickSearchInput.isConnected || !quickSearchResults.classList.contains("open")) return;
        const rect = quickSearchInput.getBoundingClientRect();
        const desiredWidth = Math.max(rect.width + 145, 430);
        const width = Math.min(desiredWidth, Math.max(280, window.innerWidth - 20));
        const left = Math.max(10, Math.min(rect.left - 60, window.innerWidth - width - 10));
        let top = rect.bottom + 6;
        const estimatedHeight = Math.min(280, Math.max(70, quickSearchResults.scrollHeight || 190));
        if (top + estimatedHeight > window.innerHeight - 10 && rect.top > estimatedHeight + 10) {
            top = Math.max(10, rect.top - estimatedHeight - 6);
        }
        quickSearchResults.style.left = `${left}px`;
        quickSearchResults.style.top = `${top}px`;
        quickSearchResults.style.width = `${width}px`;
    };
    const closeQuickSearch = (clearInput = false) => {
        quickSearchResults.classList.remove("open");
        quickSearchResults.replaceChildren();
        quickMatches = [];
        quickActiveIndex = -1;
        if (clearInput) quickSearchInput.value = "";
        quickSearchClear.disabled = !quickSearchInput.value;
        const available = Math.max(0, catalogValues().length - 1);
        quickSearchCount.textContent = quickSearchInput.value ? "0 RESULTS" : `${available} AVAILABLE`;
    };
    const addLoraFromQuickSearch = (filename) => {
        if (!filename || filename === "None" || stack.length >= 64) return;
        const slot = sanitizeSlot({
            id: `slot-${Date.now()}-${stack.length}`,
            enabled: true,
            lora: filename,
            mode: "FULL",
            video_strength: 1,
            audio_strength: 1,
            clip_strength: 0,
        }, stack.length);
        stack.push(slot);
        activeSlotIndex = stack.length - 1;
        saveStack();
        closeQuickSearch(true);
        render();
        list.scrollTop = list.scrollHeight;
        analyzeSlot(slot);
    };
    const renderQuickSearch = (queryOverride = null) => {
        const query = queryOverride == null ? quickSearchInput.value : queryOverride;
        quickSearchClear.disabled = !query;
        if (!normalizeLoraSearch(query)) {
            closeQuickSearch(false);
            return;
        }
        quickMatches = matchingLoras(query, 80, false);
        quickActiveIndex = quickMatches.length ? Math.max(0, Math.min(quickActiveIndex < 0 ? 0 : quickActiveIndex, quickMatches.length - 1)) : -1;
        quickSearchResults.replaceChildren();
        quickSearchCount.textContent = `${quickMatches.length} RESULTS`;
        if (!quickMatches.length) {
            const empty = document.createElement("div"); empty.className = "vv-power-search-empty"; empty.textContent = "NO MATCHING LORA"; quickSearchResults.appendChild(empty);
            quickSearchResults.classList.add("open");
            positionQuickSearch();
            return;
        }
        for (const [resultIndex, filename] of quickMatches.entries()) {
            const result = document.createElement("button"); result.type = "button"; result.className = "vv-power-search-result"; result.setAttribute("role", "option");
            result.classList.toggle("active", resultIndex === quickActiveIndex);
            const main = document.createElement("span"); main.className = "vv-power-search-result-main";
            const name = document.createElement("span"); name.className = "vv-power-search-result-name"; name.textContent = loraBaseName(filename);
            const path = document.createElement("span"); path.className = "vv-power-search-result-path"; path.textContent = loraFolderName(filename) || filename;
            const action = document.createElement("span"); action.className = "vv-power-search-result-action"; action.textContent = "ADD";
            main.append(name, path); result.append(main, action); result.title = filename;
            result.addEventListener("pointerenter", () => {
                quickActiveIndex = resultIndex;
                Array.from(quickSearchResults.children).forEach((item, itemIndex) => item.classList?.toggle?.("active", itemIndex === resultIndex));
            });
            result.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); });
            result.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
            result.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); addLoraFromQuickSearch(filename); });
            quickSearchResults.appendChild(result);
        }
        quickSearchResults.classList.add("open");
        positionQuickSearch();
    };

    const renderPicker = (allowEmpty = false, queryOverride = null) => {
        if (!editor?.input?.isConnected) return closePicker(false);
        const query = queryOverride == null ? editor.input.value : queryOverride;
        const matches = matchingLoras(query, 80, allowEmpty);
        popup.replaceChildren();
        if (!matches.length) {
            if (!normalizeLoraSearch(query) && !allowEmpty) return closePicker(false);
            const empty = document.createElement("div"); empty.className = "vv-lora-picker-empty"; empty.textContent = "NO MATCHING LORAS"; popup.appendChild(empty);
            popup.classList.add("open"); positionPopup(); return;
        }
        editor.matches = matches;
        editor.activeIndex = Math.max(0, Math.min(editor.activeIndex ?? 0, matches.length - 1));
        for (const [resultIndex, filename] of matches.entries()) {
            const result = document.createElement("button"); result.type = "button"; result.className = "vv-lora-picker-result"; result.setAttribute("role", "option");
            result.classList.toggle("active", resultIndex === editor.activeIndex);
            const main = document.createElement("span"); main.className = "vv-lora-picker-main";
            const name = document.createElement("span"); name.className = "vv-lora-picker-name"; name.textContent = loraBaseName(filename);
            const path = document.createElement("span"); path.className = "vv-lora-picker-path"; path.textContent = loraFolderName(filename) || filename;
            const use = document.createElement("span"); use.className = "vv-lora-picker-use"; use.textContent = "SELECT";
            main.append(name, path); result.append(main, use); result.title = filename;
            result.addEventListener("pointerenter", () => {
                if (!editor) return;
                editor.activeIndex = resultIndex;
                Array.from(popup.children).forEach((item, itemIndex) => item.classList?.toggle?.("active", itemIndex === resultIndex));
            });
            result.addEventListener("mousedown", (event) => event.preventDefault());
            result.addEventListener("click", () => commitLora(editor?.slot ?? null, filename));
            popup.appendChild(result);
        }
        popup.classList.add("open");
        positionPopup();
    };

    const makeSelect = (values, current, onChange, className = "vv-power-select") => {
        const select = document.createElement("select"); select.className = className;
        for (const item of values) { const option = document.createElement("option"); option.value = item; option.textContent = String(item); select.appendChild(option); }
        if (!values.includes(current)) { const option = document.createElement("option"); option.value = current; option.textContent = current; select.appendChild(option); }
        select.value = current; select.title = current;
        select.addEventListener("change", () => { select.title = select.value; onChange(select.value); });
        return select;
    };
    const makeNumber = (number, onChange) => {
        const input = document.createElement("input"); input.className = "vv-power-number"; input.type = "number"; input.min = "-4"; input.max = "4"; input.step = "0.01"; input.value = String(number);
        input.addEventListener("change", () => { const next = Math.max(-4, Math.min(4, Number(input.value))); if (!Number.isFinite(next)) return; input.value = String(next); onChange(next); });
        return input;
    };
    const analysisLabel = (report) => {
        if (!report) return "SCAN";
        if (!report.ok) return report.kind || "ERROR";
        if (report.kind === "A+V") return "A+V";
        if (report.kind === "AUDIO") return "AUDIO";
        if (report.kind === "VIDEO") return "VIDEO";
        return report.kind || "UNKNOWN";
    };
    async function analyzeSlot(slot) {
        if (!slot?.lora || slot.lora === "None") { if (slot) slot.analysis = {ok:true,kind:"EMPTY",audio_supported:false}; render(); return; }
        if (analysisCache.has(slot.lora)) { slot.analysis = analysisCache.get(slot.lora); render(); return; }
        slot.analysis = {ok:true,kind:"SCANNING"}; render();
        try {
            const response = await api.fetchApi("/velvet_vice/h3/lora/analyze", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({filename:slot.lora})});
            const report = await response.json(); analysisCache.set(slot.lora, report); slot.analysis = report;
        } catch (error) { slot.analysis = {ok:false,kind:"ERROR",message:String(error)}; }
        render();
    }

    const createLoraPicker = (slot, index) => {
        const combo = document.createElement("div"); combo.className = "vv-power-combo";
        const input = document.createElement("input"); input.type = "text"; input.className = "vv-power-combo-input";
        input.value = slot.lora === "None" ? "" : slot.lora;
        input.placeholder = "Search LoRA…";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.title = slot.lora === "None" ? "Search LoRA" : slot.lora;
        input.dataset.slotId = slot.id;
        const open = document.createElement("button"); open.type = "button"; open.className = "vv-power-combo-open"; open.textContent = "⌄"; open.title = "Show LoRAs";

        const beginEdit = (selectText = false) => {
            activeSlotIndex = index;
            Array.from(list.children).forEach((element, rowIndex) => element.classList?.toggle?.("target", rowIndex === index));
            editor = {slot, index, input, activeIndex: 0, matches: []};
            if (selectText && input.value) requestAnimationFrame(() => input.select());
        };
        for (const eventName of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "wheel"]) {
            input.addEventListener(eventName, (event) => event.stopPropagation());
        }
        input.addEventListener("focus", async () => {
            beginEdit(true);
            popup.replaceChildren();
            const loading = document.createElement("div");
            loading.className = "vv-lora-picker-empty";
            loading.textContent = "LOADING LORAS…";
            popup.appendChild(loading);
            popup.classList.add("open");
            positionPopup();
            await refreshCatalog(false);
            if (editor?.input === input) renderPicker(true, "");
        });
        input.addEventListener("input", async () => {
            beginEdit(false);
            editor.activeIndex = 0;
            await refreshCatalog(false);
            if (editor?.input === input) renderPicker(false, input.value);
        });
        input.addEventListener("keydown", (event) => {
            if (!editor) beginEdit(false);
            const matches = editor?.matches ?? matchingLoras(input.value, 80, false);
            if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!popup.classList.contains("open")) renderPicker(true, normalizeLoraSearch(input.value) ? input.value : "");
                else if (matches.length) { editor.activeIndex = Math.min(matches.length - 1, (editor.activeIndex ?? 0) + 1); renderPicker(!normalizeLoraSearch(input.value), input.value); popup.children[editor.activeIndex]?.scrollIntoView?.({block:"nearest"}); }
                return;
            }
            if (event.key === "ArrowUp" && matches.length) {
                event.preventDefault(); editor.activeIndex = Math.max(0, (editor.activeIndex ?? 0) - 1); renderPicker(!normalizeLoraSearch(input.value), input.value); popup.children[editor.activeIndex]?.scrollIntoView?.({block:"nearest"}); return;
            }
            if (event.key === "Enter" && matches.length) {
                event.preventDefault(); commitLora(slot, matches[editor.activeIndex ?? 0] ?? matches[0]); return;
            }
            if (event.key === "Escape") { event.preventDefault(); closePicker(true); input.blur(); }
        });
        input.addEventListener("blur", () => setTimeout(() => {
            if (editor?.input === input && !popup.matches(":hover")) closePicker(true);
        }, 140));
        open.addEventListener("pointerdown", (event) => event.stopPropagation());
        open.addEventListener("click", async () => {
            input.focus();
            beginEdit(false);
            await refreshCatalog(true);
            if (editor?.input === input) renderPicker(true, "");
        });
        combo.append(input, open);
        return combo;
    };

    function refreshBadge() {
        const active = stack.filter((slot) => slot.enabled && slot.lora !== "None").length;
        badge.textContent = `${active} ACTIVE`;
        const available = Math.max(0, catalogValues().length - 1);
        summary.querySelector(".vv-power-count").textContent = `${stack.length} LORA${stack.length === 1 ? "" : "S"} · ${available} AVAILABLE`;
        if (!normalizeLoraSearch(quickSearchInput.value)) quickSearchCount.textContent = `${available} AVAILABLE`;
    }
    function rowFor(slot, index) {
        const row = document.createElement("div"); row.className = "vv-power-row";
        const toggle = createSwitch(slot.enabled, (next) => { slot.enabled = next; saveStack(); render(); });
        const file = createLoraPicker(slot, index);
        const mode = makeSelect(["FULL", "VIDEO", "AUDIO"], slot.mode, (next) => { slot.mode = next; saveStack(); render(); });
        const video = makeNumber(slot.video_strength, (next) => { slot.video_strength = next; saveStack(); });
        const audio = makeNumber(slot.audio_strength, (next) => { slot.audio_strength = next; saveStack(); });
        const clip = makeNumber(slot.clip_strength, (next) => { slot.clip_strength = next; saveStack(); });
        video.classList.toggle("inactive", slot.mode === "AUDIO");
        audio.classList.toggle("inactive", slot.mode === "VIDEO");
        const report = document.createElement("button"); report.type = "button"; report.className = "vv-power-analysis";
        const kind = analysisLabel(slot.analysis); report.textContent = kind; report.title = slot.analysis?.message || `${slot.analysis?.video_keys ?? 0} video · ${slot.analysis?.audio_keys ?? 0} audio · ${slot.analysis?.clip_keys ?? 0} clip`;
        report.classList.toggle("av", kind === "A+V"); report.classList.toggle("audio", kind === "AUDIO"); report.classList.toggle("video", kind === "VIDEO"); report.classList.toggle("warn", ["MISSING","ERROR","UNKNOWN","NO AUDIO"].includes(kind));
        report.addEventListener("click", () => analyzeSlot(slot));
        const rowActions = document.createElement("div"); rowActions.className = "vv-power-row-actions";
        const up = document.createElement("button"); up.type="button"; up.className="vv-icon-button"; up.textContent="↑"; up.disabled=index===0; up.addEventListener("click",()=>{if(index<1)return;[stack[index-1],stack[index]]=[stack[index],stack[index-1]];saveStack();render();});
        const down = document.createElement("button"); down.type="button"; down.className="vv-icon-button"; down.textContent="↓"; down.disabled=index===stack.length-1; down.addEventListener("click",()=>{if(index>=stack.length-1)return;[stack[index+1],stack[index]]=[stack[index],stack[index+1]];saveStack();render();});
        const remove = document.createElement("button"); remove.type="button"; remove.className="vv-icon-button danger"; remove.textContent="×"; remove.addEventListener("click",()=>{stack.splice(index,1);saveStack();render();});
        rowActions.append(up,down,remove); row.append(toggle,file,mode,video,audio,clip,report,rowActions);
        row.classList.toggle("on",slot.enabled); row.classList.toggle("off",!slot.enabled); row.classList.toggle("target",index===activeSlotIndex);
        row.addEventListener("pointerdown", () => { activeSlotIndex = index; }, {capture:true});
        return row;
    }
    function syncFromNative() {
        const restored = parseStack();
        if (stackSignature(restored) === stackSignature(stack)) return false;
        stack = restored;
        activeSlotIndex = stack.findIndex((slot) => !slot.lora || slot.lora === "None");
        pendingFocusSlotId = null;
        render();
        stack.forEach((slot) => { if (slot.lora && slot.lora !== "None") analyzeSlot(slot); });
        return true;
    }
    node.__vvPowerLoraSyncFromNative = syncFromNative;

    function render() {
        closePicker(false);
        if (activeSlotIndex >= stack.length) activeSlotIndex = stack.findIndex((slot) => !slot.lora || slot.lora === "None");
        list.replaceChildren();
        if (!stack.length) { const empty=document.createElement("div"); empty.className="vv-power-empty"; empty.textContent="NO LORAS"; list.appendChild(empty); }
        else stack.forEach((slot,index)=>list.appendChild(rowFor(slot,index)));
        refreshBadge();
        if (pendingFocusSlotId) {
            const focusId = pendingFocusSlotId;
            pendingFocusSlotId = null;
            requestAnimationFrame(() => {
                const target = Array.from(list.querySelectorAll(".vv-power-combo-input")).find((input) => input.dataset.slotId === focusId);
                target?.focus?.();
                target?.select?.();
                list.scrollTop = list.scrollHeight;
            });
        }
    }

    for (const eventName of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "wheel"]) {
        quickSearchInput.addEventListener(eventName, (event) => event.stopPropagation());
    }
    quickSearchResults.addEventListener("pointerdown", (event) => event.stopPropagation());
    quickSearchInput.addEventListener("focus", async () => {
        await refreshCatalog(true);
        if (normalizeLoraSearch(quickSearchInput.value)) renderQuickSearch();
        else refreshBadge();
    });
    quickSearchInput.addEventListener("input", async () => {
        quickActiveIndex = -1;
        quickSearchClear.disabled = !quickSearchInput.value;
        await refreshCatalog(false);
        renderQuickSearch();
    });
    quickSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!quickSearchResults.classList.contains("open")) {
                renderQuickSearch();
            } else if (quickMatches.length) {
                quickActiveIndex = Math.min(quickMatches.length - 1, quickActiveIndex < 0 ? 0 : quickActiveIndex + 1);
                renderQuickSearch();
            }
            if (quickMatches.length) quickSearchResults.children[quickActiveIndex]?.scrollIntoView?.({block:"nearest"});
            return;
        }
        if (event.key === "ArrowUp" && quickMatches.length) {
            event.preventDefault();
            quickActiveIndex = Math.max(0, quickActiveIndex <= 0 ? 0 : quickActiveIndex - 1);
            renderQuickSearch();
            quickSearchResults.children[quickActiveIndex]?.scrollIntoView?.({block:"nearest"});
            return;
        }
        if (event.key === "Enter" && quickMatches.length) {
            event.preventDefault();
            addLoraFromQuickSearch(quickMatches[quickActiveIndex >= 0 ? quickActiveIndex : 0]);
            return;
        }
        if (event.key === "Escape") { event.preventDefault(); closeQuickSearch(false); quickSearchInput.blur(); }
    });
    quickSearchInput.addEventListener("blur", () => setTimeout(() => {
        if (!quickSearchResults.matches(":hover")) closeQuickSearch(false);
    }, 140));
    quickSearchClear.addEventListener("pointerdown", (event) => event.stopPropagation());
    quickSearchClear.addEventListener("click", () => { closeQuickSearch(true); quickSearchInput.focus(); });

    const onViewportChange = () => { positionPopup(); positionQuickSearch(); };
    const onDocumentPointer = (event) => {
        if (quickSearchResults.classList.contains("open") && !quickSearchWrap.contains(event.target) && !quickSearchResults.contains(event.target)) closeQuickSearch(false);
        if (!editor) return;
        if (popup.contains(event.target) || editor.input === event.target || editor.input?.contains?.(event.target)) return;
        closePicker(true);
    };
    window.addEventListener("resize", onViewportChange, true);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onDocumentPointer, true);
    node.__vvLoraCleanup = () => {
        node.__vvPowerLoraShell?.closest?.(".dom-widget")?.remove?.();
        popup.remove();
        quickSearchResults.remove();
        window.removeEventListener("resize", onViewportChange, true);
        window.removeEventListener("scroll", onViewportChange, true);
        document.removeEventListener("pointerdown", onDocumentPointer, true);
        node.__vvLoraPopup = null;
        node.__vvQuickLoraPopup = null;
        node.__vvQuickLoraSearchInput = null;
        node.__vvQuickLoraSearchWrap = null;
        node.__vvPowerLoraSyncFromNative = null;
        node.__vvPowerLoraShell = null;
        node.__vvPowerLoraDomWidget = null;
    };

    add.addEventListener("click",()=>{
        if (stack.length >= 64) return;
        const slot = sanitizeSlot({id:`slot-${Date.now()}`,enabled:true,lora:"None",mode:"FULL",video_strength:1,audio_strength:1,clip_strength:0},stack.length);
        stack.push(slot);
        activeSlotIndex=stack.length-1;
        pendingFocusSlotId=slot.id;
        saveStack();
        render();
    });
    disableAll.addEventListener("click",()=>{stack.forEach((slot)=>slot.enabled=false);saveStack();render();});
    clear.addEventListener("click",()=>{stack=[];activeSlotIndex=-1;saveStack();render();});
    for (const item of natives) hideWidget(item);
    node.__vvPowerLoraShell = shell;
    shell.dataset.vvSurface = "power-lora-v1115";
    node.__vvPowerLoraDomWidget = addDOM(node,"vv_power_lora_surface_v1115","VELVET VICE POWER LORA AV",shell,525);
    ensureMinimumNodeSize(node,750,585);
    render();
    refreshCatalog(false).then(() => refreshBadge());
    stack.forEach((slot)=>{ if(slot.lora && slot.lora!=="None") analyzeSlot(slot); });
}
function installWatermarkOverlay(node) {
    if (node.__vvWatermarkInstalledV100) return;
    node.__vvWatermarkInstalledV100 = true;
    installStyle();

    const target = widget(node, "watermark_file");
    for (const item of node.widgets ?? []) hideWidget(item);

    const shell = document.createElement("div");
    shell.className = "vv-shell";
    node.__vvWatermarkShell = shell;
    const { head, badge } = createHeader("VELVET VICE · FINAL WATERMARK", "USER FILE", node);
    shell.appendChild(head);
    const body = document.createElement("div");
    body.className = "vv-body vv-watermark-service";

    const label = document.createElement("div");
    label.className = "vv-label";
    label.textContent = "Watermark file";
    body.appendChild(label);

    const picker = document.createElement("div");
    picker.className = "vv-watermark-picker";
    const select = document.createElement("select");
    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "vv-button vv-watermark-upload";
    upload.textContent = "UPLOAD";
    picker.append(select, upload);
    body.appendChild(picker);

    const current = document.createElement("div");
    current.className = "vv-watermark-current";
    body.appendChild(current);

    function choices() {
        const values = optionValues(target);
        const selected = String(value(node, "watermark_file", "Velvet_Vice_Watermark.png"));
        if (selected && !values.includes(selected)) values.unshift(selected);
        return values.length ? values : [selected || "Velvet_Vice_Watermark.png"];
    }
    function refresh(selectedValue = null) {
        const selected = String(selectedValue ?? value(node, "watermark_file", "Velvet_Vice_Watermark.png"));
        select.replaceChildren();
        for (const item of choices()) {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            select.appendChild(option);
        }
        if (selected && !Array.from(select.options).some((item) => item.value === selected)) {
            const option = document.createElement("option");
            option.value = selected;
            option.textContent = selected;
            select.prepend(option);
        }
        select.value = selected;
        current.textContent = `ACTIVE: ${selected || "NO FILE"}`;
        badge.textContent = selected && selected !== "Velvet_Vice_Watermark.png" ? "CUSTOM" : "DEFAULT";
        syncWatermarkSource(selected);
    }
    select.addEventListener("change", () => {
        setWidget(node, "watermark_file", select.value);
        refresh(select.value);
    });

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/webp,image/jpeg";
    fileInput.style.display = "none";
    shell.appendChild(fileInput);
    upload.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        upload.disabled = true;
        upload.textContent = "UPLOAD…";
        try {
            const form = new FormData();
            form.append("image", file);
            form.append("type", "input");
            form.append("overwrite", "true");
            const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
            if (!response.ok) throw new Error(`Upload failed (${response.status})`);
            const data = await response.json();
            const name = [data?.subfolder, data?.name].filter(Boolean).join("/") || file.name;
            setWidget(node, "watermark_file", name);
            const raw = target?.options?.values;
            if (Array.isArray(raw) && !raw.includes(name)) raw.push(name);
            refresh(name);
        } catch (error) {
            current.textContent = `UPLOAD ERROR: ${error?.message ?? error}`;
            badge.textContent = "ERROR";
        } finally {
            upload.disabled = false;
            upload.textContent = "UPLOAD";
            fileInput.value = "";
        }
    });

    const info = document.createElement("div");
    info.className = "vv-foot";
    info.innerHTML = "<span>Position, size, opacity, and margins: CONTROL HUB</span><span>PNG · WEBP · JPG</span>";
    body.appendChild(info);
    shell.appendChild(body);
    addDOM(node, "vv_watermark_surface_v100", "VELVET VICE FINAL WATERMARK", shell, 190);
    ensureMinimumNodeSize(node,560,290);
    refresh();
}

function installCableSafePanel(node) {
    if (isZenH3Node(node)) return;
    if (!String(nodeType(node) ?? "").startsWith("VelvetViceMiniMaxH3") && !isMiniMaxH3Graph()) return;
    const type = nodeType(node);
    const props = node?.properties ?? {};
    const height = Number(node?.size?.[1] ?? 0);
    const eligible = CABLE_SAFE_TYPES.has(type) || Boolean(props.vv_cable_safe && height >= 110);
    if (!eligible || node.__vvCableSafeV100) return;
    node.__vvCableSafeV100 = true;

    // Native slot labels used to start inside the 30px branded header. Keep the
    // first input/output below the header and reserve a clean side gutter.
    const safeHeaderY = 72;
    node.slot_start_y = Math.max(Number(node.slot_start_y ?? 0), safeHeaderY);
    const original = typeof node.getConnectionPos === "function" ? node.getConnectionPos.bind(node) : null;
    if (!original) return;
    node.getConnectionPos = function(isInput, slotNumber, out) {
        const result = original(isInput, slotNumber, out);
        if (!result) return result;
        const posY = Number(this.pos?.[1] ?? 0);
        const localY = Number(result[1] ?? posY) - posY;
        const minimumY = safeHeaderY + Math.max(0, Number(slotNumber) || 0) * 20;
        result[0] += isInput ? -24 : 24;
        result[1] = posY + Math.max(localY + 28, minimumY);
        return result;
    };
    node.setDirtyCanvas?.(true, true);
}

function applyQuietCableTheme() {
    const nodes = app.graph?._nodes ?? [];
    if (!isMiniMaxH3Graph()) return;
    if (!nodes.some((node) => CABLE_SAFE_TYPES.has(nodeType(node)))) return;
    const canvas = app.canvas;
    if (canvas) {
        canvas.render_connections_border = false;
        canvas.connections_width = 2;
        if (globalThis.LiteGraph?.SPLINE_LINK != null) canvas.links_render_mode = globalThis.LiteGraph.SPLINE_LINK;
    }
    const links = app.graph?.links ?? app.graph?._links ?? {};
    for (const link of Object.values(links)) {
        if (!link || typeof link !== "object") continue;
        if (link.__vvOriginalColor === undefined) link.__vvOriginalColor = link.color ?? null;
        link.color = "#536474";
    }
    app.graph?.setDirtyCanvas?.(true, true);
}

function installVisiblePanel(node) {
    installCableSafePanel(node);
    const type = nodeType(node);
    if ([OUTPUT_TYPE, LORA_TYPE].includes(type)) {
        node.__vvSuppressCanvasChromeV1115 = true;
    }
    if (type === OUTPUT_TYPE) installOutputStudio(node);
    else if (type === LORA_TYPE) installLoraStudio(node);
    // ComfyUI currently clamps added DOM widgets on outer subgraph nodes to
    // 30px. Keep MODEL LOADOUT native and let the centered canvas design
    // system style it without hiding any promoted controls.
    // The 3-Pass Engine stays a native/canvas node. Adding a second DOM
    // Render Engine surface here would overlap the native subgraph controls.
    else if (type === WATERMARK_TYPE) installWatermarkOverlay(node);
}

function reassertVisiblePanels() {
    installStyle();
    for (const node of app.graph?._nodes ?? []) installVisiblePanel(node);
    applyQuietCableTheme();
}

    app.registerExtension({
        name: "VelvetVice.MiniMaxH3.FullPanelSystemV1115DraggableSingleHeader",

    async nodeCreated(node) {
        installVisiblePanel(node);
    },

    loadedGraphNode(node) {
        installVisiblePanel(node);
    },

    afterConfigureGraph() {
        // Older merged installs can schedule their own delayed UI replacement.
        // Reassert this release after every known legacy timer has finished so
        // Output Studio and Power LoRA converge back to exactly one surface.
        reassertVisiblePanels();
        requestAnimationFrame(() => requestAnimationFrame(reassertVisiblePanels));
        setTimeout(reassertVisiblePanels, 250);
        setTimeout(reassertVisiblePanels, 1000);
        setTimeout(reassertVisiblePanels, 2750);
        setTimeout(reassertVisiblePanels, 4000);
        setTimeout(reassertVisiblePanels, 6000);
        // v1.1.12 and older merged folders can schedule their last replacement
        // at 6000 ms. These cache-safe sweeps deliberately run afterwards.
        setTimeout(reassertVisiblePanels, 6500);
        setTimeout(reassertVisiblePanels, 8000);
        setTimeout(reassertVisiblePanels, 10000);
        setTimeout(reassertVisiblePanels, 12500);
    },

    nodeRemoved(node) {
        stopNodeOutputMedia(node, { hard: true });
        liveOutputs.delete(node);
        liveEngines.delete(node);
        node.__vvPreviewResizeObserver?.disconnect?.();
        node.__vvLoraCleanup?.();
        for (const observer of node.__vvAdaptiveObservers ?? []) observer?.disconnect?.();
    },
});
