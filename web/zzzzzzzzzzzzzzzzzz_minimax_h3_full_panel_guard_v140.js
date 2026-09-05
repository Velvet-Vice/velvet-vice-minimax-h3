import { app } from "../../scripts/app.js";

// Prevent duplicate native LiteGraph chrome on H3 nodes that already own a
// complete DOM header/surface. Visual only: no widget values or graph routing.
const EXTENSION_NAME = "VelvetVice.MiniMaxH3.FullPanelGuardV140";
const TYPES = new Set([
  "VelvetViceMiniMaxH3SystemHub",
  "VelvetViceMiniMaxH3Director",
  "VelvetViceMiniMaxH3OutputHub",
  "VelvetViceMiniMaxH3ProfileManager",
  "VelvetViceMiniMaxH3PromptDirector",
  "VelvetViceMiniMaxH3PowerLoraAV",
  "VelvetViceMiniMaxH3OutputStudio",
  "VelvetViceMiniMaxH3LivePreview",
  "VelvetViceMiniMaxH3Preflight",
  "VelvetViceMiniMaxH3RenderTimer",
]);
function typeOf(node){ return String(node?.comfyClass ?? node?.type ?? ""); }
function isZen(node){ const p=node?.properties??{}; return typeOf(node).startsWith("VelvetViceZenMiniMaxH3")||p.vv_zen_h3_scope===true||String(p.vv_closed_system??"").startsWith("ZEN_H3"); }
function guard(node){
  if(!node||isZen(node)||!TYPES.has(typeOf(node))) return;
  node.__vvSuppressCanvasChromeV1115=true;
  node.__vvSuppressCanvasChromeV1114=true;
  node.__vvDisplayTitle=String(node.title??typeOf(node));
  node.title_text_color="rgba(0,0,0,0)";
  const noTitle=globalThis.LiteGraph?.NO_TITLE??1;
  try{Object.defineProperty(node,"title_mode",{value:noTitle,writable:true,configurable:true,enumerable:false});}catch(_){}
  if(typeof node.getTitle==="function"&&!node.__vvFullPanelOriginalGetTitle){node.__vvFullPanelOriginalGetTitle=node.getTitle.bind(node);node.getTitle=()=>"\u200b";}
  node.setDirtyCanvas?.(true,true);
}
function all(){for(const node of app.graph?._nodes??[])guard(node);}
app.registerExtension({name:EXTENSION_NAME,nodeCreated(node){setTimeout(()=>guard(node),0);setTimeout(()=>guard(node),250);},loadedGraphNode(node){setTimeout(()=>guard(node),0);setTimeout(()=>guard(node),300);},afterConfigureGraph(){setTimeout(all,0);setTimeout(all,500);}});
