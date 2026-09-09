var recordingStatus=function(){"use strict";var Q=Object.defineProperty;var X=(h,a,y)=>a in h?Q(h,a,{enumerable:!0,configurable:!0,writable:!0,value:y}):h[a]=y;var b=(h,a,y)=>X(h,typeof a!="symbol"?a+"":a,y);var F,D,m,N,l;const a=(D=(F=globalThis.browser)==null?void 0:F.runtime)!=null&&D.id?globalThis.browser:globalThis.chrome;function y(e){return e}let i=null,v=null,u=null,r=null,p=null,c=null,f=null,s=null,g=null;const I=[],A=5e3;let w=null,E=!1;function M(e){const t=e==null?void 0:e.value;return typeof e=="object"&&e!==null&&e.action==="recording.statusUpdate"&&typeof t=="object"&&t!==null&&"activeRequestCount"in t&&"isFinalizing"in t}function U(e){return typeof e=="object"&&e!==null&&e.action==="recording.requestCompleted"&&typeof e.log=="object"&&e.log!==null}function _(e){return typeof e=="object"&&e!==null&&e.action==="recording.stopped"}function $(e){document.readyState==="interactive"||document.readyState==="complete"?e():document.addEventListener("DOMContentLoaded",e,{once:!0})}function j(){const e="dy-recorder-styles";if(document.getElementById(e))return;const t=document.createElement("style");t.id=e,t.textContent=`
    @keyframes fadeInSlideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeOutSlideDown {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(10px); }
    }
    .dy-recorder-widget.visible {
      display: flex;
      animation: fadeInSlideUp 0.3s ease-out forwards;
    }
    .dy-recorder-widget.hidden {
      animation: fadeOutSlideDown 0.3s ease-out forwards;
    }
    .dy-log-item {
      opacity: 0;
      transform: scale(0.98);
      animation: fadeInLogItem 0.4s ease-out forwards;
    }
    @keyframes fadeInLogItem {
      to { opacity: 1; transform: scale(1); }
    }
    .dy-recorder-close-btn {
      display: none;
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(75, 85, 99, 0.7);
      color: #F3F4F6;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      font-size: 14px;
      line-height: 24px;
      text-align: center;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .dy-recorder-close-btn:hover {
      background: rgba(110, 120, 135, 0.8);
    }
    .dy-recorder-control-btn {
      flex-grow: 1;
      padding: 6px 10px;
      border: 1px solid transparent;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s, border-color 0.2s;
    }
    .dy-recorder-stop-btn {
      background-color: #DC2626;
      color: white;
    }
    .dy-recorder-stop-btn:hover {
      background-color: #B91C1C;
    }
    .dy-recorder-disable-btn {
      background-color: transparent;
      color: #D1D5DB;
      border-color: #4B5563;
    }
    .dy-recorder-disable-btn:hover {
      background-color: #4B5563;
    }
  `,document.head.appendChild(t)}function k(){if(i)return;j(),I.length=0,E=!1,i=document.createElement("div"),i.className="dy-recorder-widget hidden",Object.assign(i.style,{position:"fixed",bottom:"20px",right:"20px",width:"350px",backgroundColor:"rgba(31, 41, 55, 0.95)",backdropFilter:"blur(4px)",color:"#F3F4F6",borderRadius:"12px",zIndex:"999999",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',boxShadow:"0 10px 25px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column",overflow:"hidden",border:"1px solid rgba(75, 85, 99, 0.8)"});const e=document.createElement("div");Object.assign(e.style,{padding:"10px 16px",fontSize:"16px",fontWeight:"600",borderBottom:"1px solid rgba(75, 85, 99, 0.8)",position:"relative"}),p=document.createElement("span"),p.innerHTML='<span style="color: #F87171;">\u{1F534}</span> Recording',c=document.createElement("button"),c.className="dy-recorder-close-btn",c.innerHTML="&times;",c.setAttribute("aria-label","Close"),e.append(p,c),u=document.createElement("div"),Object.assign(u.style,{padding:"8px 16px",backgroundColor:"rgba(55, 65, 81, 0.5)",fontSize:"13px"}),v=document.createElement("div"),Object.assign(v.style,{maxHeight:"200px",overflowY:"auto",padding:"8px 16px",fontSize:"12px",display:"flex",flexDirection:"column",gap:"6px"}),r=document.createElement("div"),Object.assign(r.style,{padding:"8px 16px",fontSize:"12px",fontStyle:"italic",color:"#9CA3AF",textAlign:"center"}),g=document.createElement("div"),Object.assign(g.style,{display:"flex",gap:"8px",padding:"0 16px 12px 16px",borderTop:"1px solid rgba(75, 85, 99, 0.8)",paddingTop:"12px"}),f=document.createElement("button"),f.textContent="Stop Now",f.className="dy-recorder-control-btn dy-recorder-stop-btn",f.onclick=()=>{a.runtime.sendMessage({action:"network.manualStop"}),f&&(f.disabled=!0),s&&(s.disabled=!0)},s=document.createElement("button"),s.textContent="Keep Recording",s.className="dy-recorder-control-btn dy-recorder-disable-btn",s.onclick=()=>{E=!0,a.runtime.sendMessage({action:"network.disableAutoStop"}),s&&(s.style.display="none"),x(),r&&(r.textContent="Auto-stop disabled. Use 'Stop Now' to finish.")},g.append(s,f),i.append(e,u,v,r,g),document.body.appendChild(i)}function O(){const e=v;if(!e)return;e.innerHTML="",I.slice(-20).forEach(n=>{const o=document.createElement("div");o.className="dy-log-item",o.style.backgroundColor="rgba(55, 65, 81, 0.3)",o.style.padding="4px 8px",o.style.borderRadius="4px",o.innerHTML=`
      <span style="font-weight: 600; color: #60A5FA;">ID ${n.matchId}:</span>
      <span style="margin-left: 8px; color: #D1D5DB; word-break: break-all;">${n.url}</span>
    `,e.appendChild(o)}),e.scrollTop=e.scrollHeight}function x(){w&&(clearInterval(w),w=null),r&&!E&&(r.textContent=`The recording will stop after ${A/1e3} seconds of inactivity.`)}function P(){if(x(),!r)return;let e=A/1e3;r.textContent=`The recording will stop in ${e} seconds.`,w=window.setInterval(()=>{e-=1,r&&(e>0?r.textContent=`The recording will stop in ${e} seconds.`:(r.textContent="Finalizing...",x()))},1e3)}function z(e,t,n){i||k(),!(!i||!u||!r||!p)&&(i.classList.add("visible"),i.classList.remove("hidden"),n&&(p.innerHTML=`<span style="color: #F87171;">\u{1F534}</span> Recording <span style="font-size: 12px; font-weight: 400; color: #9CA3AF; margin-left: 6px;">${n}</span>`),u.textContent=`Active Requests: ${e}`,t&&!E?P():x())}function B(e){i||k(),I.push(e),O()}function Y(){i&&(i.classList.add("hidden"),i.classList.remove("visible"),setTimeout(()=>{i==null||i.remove(),i=null,v=null,u=null,r=null,p=null,c=null,f=null,s=null,g=null},300))}function H(){!p||!u||!r||!c||!g||(x(),p.innerHTML="\u2705 Recording Complete",u.style.display="none",r.style.display="none",g.style.display="none",c.style.display="block",c.addEventListener("click",Y,{once:!0}))}const W={matches:["<all_urls>"],runAt:"document_start",main(e){a.runtime.onMessage.addListener(t=>{$(()=>{M(t)?z(t.value.activeRequestCount,t.value.isFinalizing,t.value.ruleSetName):U(t)?B(t.log):_(t)&&H()})})}};function C(e,...t){}const V={debug:(...e)=>C(console.debug,...e),log:(...e)=>C(console.log,...e),warn:(...e)=>C(console.warn,...e),error:(...e)=>C(console.error,...e)};var R=(m=class extends Event{constructor(t,n){super(m.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}},b(m,"EVENT_NAME",L("wxt:locationchange")),m);function L(e){var t;return`${(t=a==null?void 0:a.runtime)==null?void 0:t.id}:recording-status:${e}`}const G=typeof((N=globalThis.navigation)==null?void 0:N.addEventListener)=="function";function q(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),G?globalThis.navigation.addEventListener("navigate",o=>{const d=new URL(o.destination.url);d.href!==t.href&&(window.dispatchEvent(new R(d,t)),t=d)},{signal:e.signal}):e.setInterval(()=>{const o=new URL(location.href);o.href!==t.href&&(window.dispatchEvent(new R(o,t)),t=o)},1e3))}}}var K=(l=class{constructor(t,n){b(this,"id");b(this,"abortController");b(this,"locationWatcher",q(this));this.contentScriptName=t,this.options=n,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(t){return this.abortController.abort(t)}get isInvalid(){var t;return((t=a.runtime)==null?void 0:t.id)==null&&this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(t){return this.signal.addEventListener("abort",t),()=>this.signal.removeEventListener("abort",t)}block(){return new Promise(()=>{})}setInterval(t,n){const o=setInterval(()=>{this.isValid&&t()},n);return this.onInvalidated(()=>clearInterval(o)),o}setTimeout(t,n){const o=setTimeout(()=>{this.isValid&&t()},n);return this.onInvalidated(()=>clearTimeout(o)),o}requestAnimationFrame(t){const n=requestAnimationFrame((...o)=>{this.isValid&&t(...o)});return this.onInvalidated(()=>cancelAnimationFrame(n)),n}requestIdleCallback(t,n){const o=requestIdleCallback((...d)=>{this.signal.aborted||t(...d)},n);return this.onInvalidated(()=>cancelIdleCallback(o)),o}addEventListener(t,n,o,d){var S;n==="wxt:locationchange"&&this.isValid&&this.locationWatcher.run(),(S=t.addEventListener)==null||S.call(t,n.startsWith("wxt:")?L(n):n,o,{...d,signal:this.signal})}notifyInvalidated(){this.abort("Content script context invalidated"),V.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(l.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),window.postMessage({type:l.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},"*")}verifyScriptStartedEvent(t){var d,S;const n=((d=t.detail)==null?void 0:d.contentScriptName)===this.contentScriptName,o=((S=t.detail)==null?void 0:S.messageId)===this.id;return n&&!o}listenForNewerScripts(){const t=n=>{!(n instanceof CustomEvent)||!this.verifyScriptStartedEvent(n)||this.notifyInvalidated()};document.addEventListener(l.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(l.SCRIPT_STARTED_MESSAGE_TYPE,t))}},b(l,"SCRIPT_STARTED_MESSAGE_TYPE",L("wxt:content-script-started")),l);function Z(){}function T(e,...t){}const J={debug:(...e)=>T(console.debug,...e),log:(...e)=>T(console.log,...e),warn:(...e)=>T(console.warn,...e),error:(...e)=>T(console.error,...e)};return(async()=>{try{const{main:e,...t}=W;return await e(new K("recording-status",t))}catch(e){throw J.error('The content script "recording-status" crashed on startup!',e),e}})()}();

recordingStatus;