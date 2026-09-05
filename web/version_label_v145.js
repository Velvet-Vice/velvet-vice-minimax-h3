import { app } from "../../scripts/app.js";

const TYPES = new Set([
  "VelvetViceControlHub",
  "VelvetVicePreflightConsole",
  "VelvetViceMiniMaxH3OutputStudio",
  "VelvetViceMiniMaxH3PowerLoraAV",
  "VelvetViceMiniMaxH3PromptDirector",
  "VelvetViceMiniMaxH3FinalPromptPreview",
  "VelvetViceMiniMaxH3SystemHub",
  "VelvetViceMiniMaxH3Director",
  "VelvetViceMiniMaxH3OutputHub",
]);

function typeOf(node){return String(node?.comfyClass??node?.type??"");}
function patchText(root){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[]; while(walker.nextNode())nodes.push(walker.currentNode);
  for(const n of nodes){
    if(n.nodeValue?.includes("1.4.4"))n.nodeValue=n.nodeValue.replaceAll("1.4.4","1.4.5");
  }
}
function patch(node){
  const t=typeOf(node);
  if(!t.startsWith("VelvetViceMiniMaxH3")&&!TYPES.has(t))return;
  for(const root of [
    node.__vvh3Shell,node.__vvH3PromptShell,node.__vvH3FinalPromptShell,
    node.__vvPowerLoraShell,node.__vvOutputShell,node.__vvWatermarkShell,
    node.__vvH3MonitorShell,node.__vvh3PreviewDisplay?.shell
  ])patchText(root);
}
function scan(){for(const n of app.graph?._nodes??[])patch(n);}
app.registerExtension({
  name:"VelvetVice.MiniMaxH3.VersionLabelV145",
  nodeCreated(n){setTimeout(()=>patch(n),100);},
  loadedGraphNode(n){setTimeout(()=>patch(n),100);},
  afterConfigureGraph(){setTimeout(scan,150);setTimeout(scan,800);}
});
