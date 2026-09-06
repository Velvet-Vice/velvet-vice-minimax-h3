import { app } from "../../scripts/app.js";

const TYPE = "VelvetViceMiniMaxH3SystemHub";
const STORE = "velvetVice.h3.qualityRefine.v145";
const FIELDS = [
  "quality_refine_enabled","quality_refine_mode","quality_refine_custom_steps",
  "quality_refine_custom_denoise","quality_refine_preserve_audio",
  "quality_refine_reencode_enabled","quality_refine_reencode_scale"
];
function typeOf(node){ return String(node?.comfyClass ?? node?.type ?? ""); }
function widget(node,name){ return node?.widgets?.find((w)=>w?.name===name); }
function value(node,name,fallback=null){ const w=widget(node,name); return w==null?fallback:w.value; }
function setValue(node,name,v){
  const w=widget(node,name); if(!w)return;
  w.value=v; w.callback?.(v);
  node.graph?.setDirtyCanvas?.(true,true); node.setDirtyCanvas?.(true,true);
}
function saveLocal(node){
  try{
    const data={}; for(const n of FIELDS)data[n]=value(node,n,null);
    localStorage.setItem(STORE,JSON.stringify(data));
  }catch(_){}
}
function restoreLocal(node){
  try{
    const data=JSON.parse(localStorage.getItem(STORE)||"{}");
    for(const n of FIELDS)if(Object.prototype.hasOwnProperty.call(data,n))setValue(node,n,data[n]);
  }catch(_){}
}
function sectionByTitle(shell,title){
  return [...shell.querySelectorAll(".vvh3-section")].find((s)=>
    String(s.querySelector(".vvh3-section-title")?.textContent??"").toUpperCase().includes(title)
  ) ?? null;
}
function field(label,control){
  const wrap=document.createElement("label");wrap.className="vvh3-field";
  const cap=document.createElement("span");cap.textContent=label;wrap.append(cap,control);
  return wrap;
}
function numeric(node,name,label,step="1"){
  const input=document.createElement("input");input.type="number";input.step=step;
  input.value=value(node,name,0);
  const commit=()=>{const v=Number(input.value);if(Number.isFinite(v))setValue(node,name,v);};
  input.addEventListener("input",commit);input.addEventListener("change",commit);
  return {wrap:field(label,input), input, sync:()=>{input.value=value(node,name,0);}};
}
function combo(node,name,label){
  const sel=document.createElement("select");
  const values=widget(node,name)?.options?.values??[];
  for(const v of values){const o=document.createElement("option");o.value=String(v);o.textContent=String(v);sel.appendChild(o);}
  sel.value=String(value(node,name,"LIGHT"));
  sel.addEventListener("change",()=>setValue(node,name,sel.value));
  return {wrap:field(label,sel), input:sel, sync:()=>{sel.value=String(value(node,name,"LIGHT"));}};
}
function toggle(node,name,label){
  const wrap=document.createElement("label");wrap.className="vvh3-toggle";
  const input=document.createElement("input");input.type="checkbox";input.checked=!!value(node,name,false);
  const text=document.createElement("span");text.textContent=label;wrap.append(input,text);
  input.addEventListener("change",()=>setValue(node,name,input.checked));
  return {wrap,input,sync:()=>{input.checked=!!value(node,name,false);}};
}
function grid(...items){
  const d=document.createElement("div");d.className="vvh3-grid";
  for(const x of items)d.appendChild(x.wrap);return d;
}
function hideNative(w){
  if(!w||w.__vvRefineV145Hidden)return;
  w.__vvRefineV145Hidden=true;w.hidden=true;w.computeSize=()=>[0,-4];
}
function install(node,retries=0){
  if(typeOf(node)!==TYPE||node.__vvQualityRefineV145Installed)return;
  const shell=node.__vvh3Shell;
  if(!shell){if(retries<40)setTimeout(()=>install(node,retries+1),75);return;}
  if(!widget(node,"quality_refine_enabled"))return;
  node.__vvQualityRefineV145Installed=true;
  restoreLocal(node);

  for(const name of FIELDS) hideNative(widget(node,name));

  const refine=document.createElement("div");
  refine.className="vvh3-section vvh3-refine-section";
  const title=document.createElement("div");title.className="vvh3-section-title";
  title.textContent="QUALITY REFINE / SECOND SAMPLER";refine.appendChild(title);

  const enabled=toggle(node,"quality_refine_enabled","Enable Quality Refine");
  const mode=combo(node,"quality_refine_mode","Refine Mode");
  const steps=numeric(node,"quality_refine_custom_steps","Refine Steps","1");
  const denoise=numeric(node,"quality_refine_custom_denoise","Custom Denoise","0.01");
  const audio=toggle(node,"quality_refine_preserve_audio","Preserve Base Audio");
  const reencode=toggle(node,"quality_refine_reencode_enabled","Decode → Upscale → Re-Encode before Pass 2");
  const scale=numeric(node,"quality_refine_reencode_scale","Re-Encode Scale","0.05");

  refine.appendChild(grid(enabled,mode));
  refine.appendChild(grid(steps,denoise));
  refine.appendChild(audio.wrap);
  refine.appendChild(reencode.wrap);
  refine.appendChild(scale.wrap);

  const state=document.createElement("div");state.className="vvh3-refine-state";refine.appendChild(state);
  const hint=document.createElement("div");hint.className="vvh3-summary";
  hint.textContent="OFF = only Sampler 1 runs. LIGHT = denoise 0.12. HIGH = denoise 0.20. Refine Steps stay user-controlled in every enabled mode; CUSTOM unlocks manual denoise. Re-Encode optionally rebuilds a higher-resolution H3 AV latent before Pass 2.";
  refine.appendChild(hint);

  const turbo=sectionByTitle(shell,"TURBO / DISTILLED LORA");
  if(turbo?.parentElement) turbo.insertAdjacentElement("afterend",refine);
  else shell.appendChild(refine);

  const sync=()=>{
    enabled.sync();mode.sync();steps.sync();denoise.sync();audio.sync();reencode.sync();scale.sync();
    const on=!!value(node,"quality_refine_enabled",false);
    const m=String(value(node,"quality_refine_mode","LIGHT")).toUpperCase();
    const re=on&&!!value(node,"quality_refine_reencode_enabled",false);
    mode.input.disabled=!on;
    steps.input.disabled=!on;
    denoise.input.disabled=!on||m!=="CUSTOM";
    audio.input.disabled=!on;
    reencode.input.disabled=!on;
    scale.input.disabled=!re;
    refine.classList.toggle("is-enabled",on);
    const s=Number(value(node,"quality_refine_custom_steps",8));
    const d=m==="LIGHT"?0.12:m==="HIGH"?0.20:Number(value(node,"quality_refine_custom_denoise",0.18));
    const rs=Math.max(1,Math.min(2,Number(value(node,"quality_refine_reencode_scale",1.25))||1.25));
    state.textContent=on
      ? `ON · ${m} · PASS 2: ${s} steps · denoise ${Number(d).toFixed(2)} · ${value(node,"quality_refine_preserve_audio",true)?"BASE AUDIO PRESERVED":"JOINT AV REFINE"} · ${re?`RE-ENCODE ×${rs.toFixed(2)}`:"DIRECT LATENT"}`
      : "OFF · second sampler is lazy-bypassed · only Sampler 1 runs";
  };
  refine.addEventListener("input",()=>{saveLocal(node);setTimeout(sync,0);});
  refine.addEventListener("change",()=>{saveLocal(node);setTimeout(sync,0);});
  sync();

  node.setSize?.([Math.max(690,node.size?.[0]??0),Math.max(1090,node.size?.[1]??0)]);
  const version=[...shell.querySelectorAll(".vvh3-version")][0];
  if(version)version.textContent=String(version.textContent??"").replace(/1\.4\.4/g,"1.4.5");
}
function scan(){for(const n of app.graph?._nodes??[])install(n);}
app.registerExtension({
  name:"VelvetVice.MiniMaxH3.QualityRefineSystemHubV145",
  nodeCreated(n){setTimeout(()=>install(n),0);},
  loadedGraphNode(n){setTimeout(()=>install(n),0);},
  afterConfigureGraph(){setTimeout(scan,100);setTimeout(scan,600);}
});
