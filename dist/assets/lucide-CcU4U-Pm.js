function te(n,c){for(var d=0;d<c.length;d++){const y=c[d];if(typeof y!="string"&&!Array.isArray(y)){for(const k in y)if(k!=="default"&&!(k in n)){const _=Object.getOwnPropertyDescriptor(y,k);_&&Object.defineProperty(n,k,_.get?_:{enumerable:!0,get:()=>y[k]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}function re(n){return n&&n.__esModule&&Object.prototype.hasOwnProperty.call(n,"default")?n.default:n}var z={exports:{}},r={};/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var W;function ne(){if(W)return r;W=1;var n=Symbol.for("react.element"),c=Symbol.for("react.portal"),d=Symbol.for("react.fragment"),y=Symbol.for("react.strict_mode"),k=Symbol.for("react.profiler"),_=Symbol.for("react.provider"),x=Symbol.for("react.context"),w=Symbol.for("react.forward_ref"),C=Symbol.for("react.suspense"),S=Symbol.for("react.memo"),j=Symbol.for("react.lazy"),A=Symbol.iterator;function J(e){return e===null||typeof e!="object"?null:(e=A&&e[A]||e["@@iterator"],typeof e=="function"?e:null)}var q={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},V=Object.assign,L={};function g(e,t,o){this.props=e,this.context=t,this.refs=L,this.updater=o||q}g.prototype.isReactComponent={},g.prototype.setState=function(e,t){if(typeof e!="object"&&typeof e!="function"&&e!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,e,t,"setState")},g.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,"forceUpdate")};function D(){}D.prototype=g.prototype;function R(e,t,o){this.props=e,this.context=t,this.refs=L,this.updater=o||q}var E=R.prototype=new D;E.constructor=R,V(E,g.prototype),E.isPureReactComponent=!0;var T=Array.isArray,I=Object.prototype.hasOwnProperty,N={current:null},H={key:!0,ref:!0,__self:!0,__source:!0};function U(e,t,o){var u,a={},i=null,f=null;if(t!=null)for(u in t.ref!==void 0&&(f=t.ref),t.key!==void 0&&(i=""+t.key),t)I.call(t,u)&&!H.hasOwnProperty(u)&&(a[u]=t[u]);var l=arguments.length-2;if(l===1)a.children=o;else if(1<l){for(var s=Array(l),m=0;m<l;m++)s[m]=arguments[m+2];a.children=s}if(e&&e.defaultProps)for(u in l=e.defaultProps,l)a[u]===void 0&&(a[u]=l[u]);return{$$typeof:n,type:e,key:i,ref:f,props:a,_owner:N.current}}function Q(e,t){return{$$typeof:n,type:e.type,key:t,ref:e.ref,props:e.props,_owner:e._owner}}function O(e){return typeof e=="object"&&e!==null&&e.$$typeof===n}function X(e){var t={"=":"=0",":":"=2"};return"$"+e.replace(/[=:]/g,function(o){return t[o]})}var F=/\/+/g;function P(e,t){return typeof e=="object"&&e!==null&&e.key!=null?X(""+e.key):t.toString(36)}function b(e,t,o,u,a){var i=typeof e;(i==="undefined"||i==="boolean")&&(e=null);var f=!1;if(e===null)f=!0;else switch(i){case"string":case"number":f=!0;break;case"object":switch(e.$$typeof){case n:case c:f=!0}}if(f)return f=e,a=a(f),e=u===""?"."+P(f,0):u,T(a)?(o="",e!=null&&(o=e.replace(F,"$&/")+"/"),b(a,t,o,"",function(m){return m})):a!=null&&(O(a)&&(a=Q(a,o+(!a.key||f&&f.key===a.key?"":(""+a.key).replace(F,"$&/")+"/")+e)),t.push(a)),1;if(f=0,u=u===""?".":u+":",T(e))for(var l=0;l<e.length;l++){i=e[l];var s=u+P(i,l);f+=b(i,t,o,s,a)}else if(s=J(e),typeof s=="function")for(e=s.call(e),l=0;!(i=e.next()).done;)i=i.value,s=u+P(i,l++),f+=b(i,t,o,s,a);else if(i==="object")throw t=String(e),Error("Objects are not valid as a React child (found: "+(t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t)+"). If you meant to render a collection of children, use an array instead.");return f}function $(e,t,o){if(e==null)return e;var u=[],a=0;return b(e,u,"","",function(i){return t.call(o,i,a++)}),u}function Y(e){if(e._status===-1){var t=e._result;t=t(),t.then(function(o){(e._status===0||e._status===-1)&&(e._status=1,e._result=o)},function(o){(e._status===0||e._status===-1)&&(e._status=2,e._result=o)}),e._status===-1&&(e._status=0,e._result=t)}if(e._status===1)return e._result.default;throw e._result}var h={current:null},M={transition:null},ee={ReactCurrentDispatcher:h,ReactCurrentBatchConfig:M,ReactCurrentOwner:N};function B(){throw Error("act(...) is not supported in production builds of React.")}return r.Children={map:$,forEach:function(e,t,o){$(e,function(){t.apply(this,arguments)},o)},count:function(e){var t=0;return $(e,function(){t++}),t},toArray:function(e){return $(e,function(t){return t})||[]},only:function(e){if(!O(e))throw Error("React.Children.only expected to receive a single React element child.");return e}},r.Component=g,r.Fragment=d,r.Profiler=k,r.PureComponent=R,r.StrictMode=y,r.Suspense=C,r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=ee,r.act=B,r.cloneElement=function(e,t,o){if(e==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+e+".");var u=V({},e.props),a=e.key,i=e.ref,f=e._owner;if(t!=null){if(t.ref!==void 0&&(i=t.ref,f=N.current),t.key!==void 0&&(a=""+t.key),e.type&&e.type.defaultProps)var l=e.type.defaultProps;for(s in t)I.call(t,s)&&!H.hasOwnProperty(s)&&(u[s]=t[s]===void 0&&l!==void 0?l[s]:t[s])}var s=arguments.length-2;if(s===1)u.children=o;else if(1<s){l=Array(s);for(var m=0;m<s;m++)l[m]=arguments[m+2];u.children=l}return{$$typeof:n,type:e.type,key:a,ref:i,props:u,_owner:f}},r.createContext=function(e){return e={$$typeof:x,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},e.Provider={$$typeof:_,_context:e},e.Consumer=e},r.createElement=U,r.createFactory=function(e){var t=U.bind(null,e);return t.type=e,t},r.createRef=function(){return{current:null}},r.forwardRef=function(e){return{$$typeof:w,render:e}},r.isValidElement=O,r.lazy=function(e){return{$$typeof:j,_payload:{_status:-1,_result:e},_init:Y}},r.memo=function(e,t){return{$$typeof:S,type:e,compare:t===void 0?null:t}},r.startTransition=function(e){var t=M.transition;M.transition={};try{e()}finally{M.transition=t}},r.unstable_act=B,r.useCallback=function(e,t){return h.current.useCallback(e,t)},r.useContext=function(e){return h.current.useContext(e)},r.useDebugValue=function(){},r.useDeferredValue=function(e){return h.current.useDeferredValue(e)},r.useEffect=function(e,t){return h.current.useEffect(e,t)},r.useId=function(){return h.current.useId()},r.useImperativeHandle=function(e,t,o){return h.current.useImperativeHandle(e,t,o)},r.useInsertionEffect=function(e,t){return h.current.useInsertionEffect(e,t)},r.useLayoutEffect=function(e,t){return h.current.useLayoutEffect(e,t)},r.useMemo=function(e,t){return h.current.useMemo(e,t)},r.useReducer=function(e,t,o){return h.current.useReducer(e,t,o)},r.useRef=function(e){return h.current.useRef(e)},r.useState=function(e){return h.current.useState(e)},r.useSyncExternalStore=function(e,t,o){return h.current.useSyncExternalStore(e,t,o)},r.useTransition=function(){return h.current.useTransition()},r.version="18.3.1",r}var K;function oe(){return K||(K=1,z.exports=ne()),z.exports}var v=oe();const ae=re(v),Ee=te({__proto__:null,default:ae},[v]);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ue=n=>n.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),ce=n=>n.replace(/^([A-Z])|[\s-_]+(\w)/g,(c,d,y)=>y?y.toUpperCase():d.toLowerCase()),Z=n=>{const c=ce(n);return c.charAt(0).toUpperCase()+c.slice(1)},G=(...n)=>n.filter((c,d,y)=>!!c&&c.trim()!==""&&y.indexOf(c)===d).join(" ").trim(),se=n=>{for(const c in n)if(c.startsWith("aria-")||c==="role"||c==="title")return!0};/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var ie={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const le=v.forwardRef(({color:n="currentColor",size:c=24,strokeWidth:d=2,absoluteStrokeWidth:y,className:k="",children:_,iconNode:x,...w},C)=>v.createElement("svg",{ref:C,...ie,width:c,height:c,stroke:n,strokeWidth:y?Number(d)*24/Number(c):d,className:G("lucide",k),...!_&&!se(w)&&{"aria-hidden":"true"},...w},[...x.map(([S,j])=>v.createElement(S,j)),...Array.isArray(_)?_:[_]]));/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=(n,c)=>{const d=v.forwardRef(({className:y,...k},_)=>v.createElement(le,{ref:_,iconNode:c,className:G(`lucide-${ue(Z(n))}`,`lucide-${n}`,y),...k}));return d.displayName=Z(n),d};/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fe=[["path",{d:"M12 7v14",key:"1akyts"}],["path",{d:"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",key:"ruj8y"}]],Ne=p("book-open",fe);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pe=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],Oe=p("chevron-down",pe);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ye=[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]],Pe=p("chevron-up",ye);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const de=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 18V6",key:"zqpxq5"}]],ze=p("circle-dollar-sign",de);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const he=[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]],Ae=p("credit-card",he);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _e=[["path",{d:"M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z",key:"9m4mmf"}],["path",{d:"m2.5 21.5 1.4-1.4",key:"17g3f0"}],["path",{d:"m20.1 3.9 1.4-1.4",key:"1qn309"}],["path",{d:"M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z",key:"1t2c92"}],["path",{d:"m9.6 14.4 4.8-4.8",key:"6umqxw"}]],qe=p("dumbbell",_e);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ke=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]],Ve=p("file-text",ke);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const me=[["rect",{width:"7",height:"9",x:"3",y:"3",rx:"1",key:"10lvy0"}],["rect",{width:"7",height:"5",x:"14",y:"3",rx:"1",key:"16une8"}],["rect",{width:"7",height:"9",x:"14",y:"12",rx:"1",key:"1hutg5"}],["rect",{width:"7",height:"5",x:"3",y:"16",rx:"1",key:"ldoo1y"}]],Le=p("layout-dashboard",me);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ve=[["path",{d:"M4 5h16",key:"1tepv9"}],["path",{d:"M4 12h16",key:"1lakjw"}],["path",{d:"M4 19h16",key:"1djgab"}]],De=p("menu",ve);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ge=[["path",{d:"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",key:"kfwtm"}]],Te=p("moon",ge);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const we=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]],Ie=p("pencil",we);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const be=[["path",{d:"M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z",key:"1piglc"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M2 8v1a2 2 0 0 0 2 2h1",key:"1env43"}]],He=p("piggy-bank",be);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $e=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],Ue=p("settings",$e);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Me=[["circle",{cx:"8",cy:"21",r:"1",key:"jimo8o"}],["circle",{cx:"19",cy:"21",r:"1",key:"13723u"}],["path",{d:"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",key:"9zh506"}]],Fe=p("shopping-cart",Me);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xe=[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 20v2",key:"1lh1kg"}],["path",{d:"m4.93 4.93 1.41 1.41",key:"149t6j"}],["path",{d:"m17.66 17.66 1.41 1.41",key:"ptbguv"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"M20 12h2",key:"1q8mjw"}],["path",{d:"m6.34 17.66-1.41 1.41",key:"1m8zz5"}],["path",{d:"m19.07 4.93-1.41 1.41",key:"1shlcs"}]],Be=p("sun",xe);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ce=[["path",{d:"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z",key:"16rjxf"}],["path",{d:"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193",key:"178nd4"}],["circle",{cx:"10.5",cy:"6.5",r:".5",fill:"currentColor",key:"12ikhr"}]],We=p("tags",Ce);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Se=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],Ke=p("trash-2",Se);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const je=[["path",{d:"M16 7h6v6",key:"box55l"}],["path",{d:"m22 7-8.5 8.5-5-5L2 17",key:"1t1m79"}]],Ze=p("trending-up",je);/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Re=[["path",{d:"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",key:"18etb6"}],["path",{d:"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",key:"xoc0q4"}]],Ge=p("wallet",Re);export{Ne as B,ze as C,qe as D,Ve as F,Le as L,De as M,He as P,Ee as R,Fe as S,Ze as T,Ge as W,v as a,ae as b,Ae as c,We as d,Ue as e,Te as f,re as g,Be as h,Pe as i,Oe as j,Ie as k,Ke as l,oe as r};
