/* MOF Studio · 确定性教学评审。此文件不依赖 Three.js，可在 Node 中验证。 */
(function (root) {
  'use strict';
  const SPEC = {
    version: '2026.11.03',
    target: { name:'Cu-BTC（HKUST-1）', id:'HKUST-1', formula:'Cu₃(C₉H₃O₆)₂', structure:'立方 Fm-3m · Cu₂ 桨轮节点' },
    feeds: { cu:{target:1.688,tol:0.005,molar:241.60}, btc:{target:1.050,tol:0.005,molar:210.14} },
    ratio: { target:1.3983, soft:[1.35,1.45], hard:[0.7,2.8] },
    solvents: { A:{id:'water',volume:3}, B:{id:'ethanol',volume:3}, volumeTol:0.1 },
    reaction: { temp:{target:120,soft:[112,128],hard:[90,150],device:[40,180]}, time:{target:24,soft:[21,27],hard:[12,36],device:[2,48]}, fillMax:80, vesselML:25 },
    post: {
      separation:{rpm:{target:5000,soft:[4700,5300],device:[3000,8000]},minutes:{target:2.5,soft:[2,3],device:[1,6]}},
      washing:{water:3,ethanol:3,minEach:2},
      activation:{temp:{target:120,soft:[110,130],device:[60,220],damageAbove:180},time:{target:12,soft:[10,14],min:2}}
    },
    safety:{seal:true,balance:true,vacuum:true},
    assessment:{weights:[0.2,0.3,0.2,0.15,0.15],minorPenalty:3,correctPenalty:8},
    simulation:{yieldPercent:78.9,bet:1520,crystalMicrons:12,penaltyPerDeviation:0.12}
  };
  const PHASES = [
    ['reagent','试剂选择',4,'beakerA'],['weigh','试剂称量',3,'balance'],
    ['solution','溶液配制',4,'beakerA'],['feed','加料顺序',5,'reactor'],
    ['assembly','反应组装',5,'reactor'],['reaction','反应控制',6,'reactor'],
    ['post','分离洗涤',8,'centrifuge'],['activation','活化',9,'oven']
  ];
  const copy = x => JSON.parse(JSON.stringify(x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const range = (v,r) => finite(v) && v>=r[0] && v<=r[1];
  const near = (v,t,tol) => finite(v) && Math.abs(v-t)<=tol+1e-9;
  const escape = x => String(x == null ? '—' : x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function observation(s) {
    const o={step:s.step,completed:s.completed||[],demo:!!s.demo};
    for (const k of ['safety','equipment','activeReagent','weigh','solutions','assembly','reaction','separation','washing','activation','characterization','analysis']) o[k]=copy(s[k] || {});
    // 播放进度和时间压缩只影响演示，不是化学反应时长的证据。
    delete o.reaction.playing; delete o.reaction.growth;
    return o;
  }
  function append(s, action, detail='', extra={}) {
    if (!Array.isArray(s.opLog)) s.opLog=[];
    const snapshot=observation(s), prev=s.opLog[s.opLog.length-1];
    if (action==='state-observed' && prev && JSON.stringify(prev.snapshot)===JSON.stringify(snapshot)) return prev;
    const k=s.activeReagent||'cu', sol=s.solutions && s.solutions[extra.solution||'A'];
    const e={id:'op-'+(s.opSequence=(s.opSequence||s.opLog.length)+1),step:s.step,action,event:action,detail,
      reagentId:extra.reagentId||k,mass:s.weigh&&s.weigh[k]?s.weigh[k].added:null,
      volume:sol?sol.volume:null,temp:s.step===9?s.activation.temp:s.reaction.temp,
      duration:s.step===9?s.activation.time:s.reaction.time,
      units:{mass:'g',volume:'mL',temp:'°C',duration:'h'},timestamp:new Date().toISOString(),
      deviceState:{sealed:!!s.assembly.sealed,balanced:!!s.separation.balanced,vacuum:!!s.activation.vacuum},snapshot,...extra};
    s.opLog.push(e); return e;
  }
  function evaluate(events, config=SPEC) {
    const started=typeof performance!=='undefined'?performance.now():Date.now();
    const log=Array.isArray(events)?events:[], observed=log.filter(e=>e.snapshot), last=observed[observed.length-1];
    const s=last?last.snapshot:{step:0,completed:[]};
    const C=config, w=s.weigh||{}, sol=s.solutions||{}, a=s.assembly||{}, r=s.reaction||{}, sep=s.separation||{}, wash=s.washing||{}, act=s.activation||{};
    const errorEvents=log.filter(e=>e.action==='operation-error');
    const items=[];
    function item(key, checks) {
      const p=PHASES.find(x=>x[0]===key), due=(s.completed||[]).includes(p[2])||s.step>p[2];
      const evidence=log.filter(e=>e.snapshot && (e.step===p[2] || key==='post' && e.step===7));
      const valid=checks.filter(Boolean), bad=valid.filter(c=>!c.ok);
      const pending=!last || !due;
      const status=pending?'pending':bad.some(c=>c.fatal)?'fail':bad.length?'deviation':'pass';
      items.push({key,label:p[1],step:p[2],device:p[3],status,check:p[1]+'与教学方案比对',method:'结构化事件与教师 SPEC 比对',
        notes:pending?['本环节尚未完成，暂不作最终结论']:valid.map(c=>c.text),checks:valid,evidenceIds:evidence.map(e=>e.id),
        evidence:evidence.slice(-8),badCount:bad.length});
    }
    const check=(ok,text,fatal=false)=>({ok:!!ok,text,fatal});
    item('reagent', ['A','B'].map(k=>check(sol[k]&&sol[k].solid&&sol[k].added&&sol[k].solvent===C.solvents[k].id,
      '溶液 '+k+'：实际 '+(sol[k]&&sol[k].solvent||'未加料')+'；规定 '+C.solvents[k].id,true)));
    const massChecks=['cu','btc'].map(k=>check(w[k]&&w[k].confirmed&&near(w[k].added,C.feeds[k].target,C.feeds[k].tol),
      k+' 实际 '+(w[k]&&w[k].added)+' g / 目标 '+C.feeds[k].target+' ± '+C.feeds[k].tol+' g',!w[k]||!finite(w[k].added)||w[k].added<=0));
    const ratio=w.cu&&w.btc&&w.btc.added>0?(w.cu.added/C.feeds.cu.molar)/(w.btc.added/C.feeds.btc.molar):null;
    massChecks.push(check(range(ratio,C.ratio.soft),'金属盐/配体摩尔比 '+(finite(ratio)?ratio.toFixed(4):'缺失')+'；允许 '+C.ratio.soft.join('–'),!range(ratio,C.ratio.hard)));
    item('weigh',massChecks);
    item('solution',['A','B'].map(k=>check(sol[k]&&sol[k].dissolved&&near(sol[k].volume,C.solvents[k].volume,C.solvents.volumeTol),
      '溶液 '+k+' 实际 '+(sol[k]&&sol[k].volume)+' mL；目标 '+C.solvents[k].volume+' ± '+C.solvents.volumeTol+' mL；'+(sol[k]&&sol[k].dissolved?'已溶解':'未记录溶解'))));
    const order=log.map(e=>e.action||e.event), idx=n=>order.lastIndexOf(n);
    item('feed', [['add-solid:A','add-solvent:A'],['add-solid:B','add-solvent:B'],['transfer-a','transfer-b'],['mix','sonicate']].map(([x,y])=>check(idx(x)>=0&&idx(y)>idx(x),'事件顺序 '+x+' → '+y+'：'+(idx(x)>=0&&idx(y)>idx(x)?'符合':'缺失或顺序偏差'))));
    const fill=((a.aTransferred&&sol.A?sol.A.volume:0)+(a.bTransferred&&sol.B?sol.B.volume:0))/C.reaction.vesselML*100;
    item('assembly',[check(a.aTransferred&&a.bTransferred,'两种前驱体均转入反应内衬',true),check(a.sealed===C.safety.seal,'密封状态 '+!!a.sealed+'；规定 '+C.safety.seal,true),check(finite(fill)&&fill<=C.reaction.fillMax,'填充率 '+fill.toFixed(1)+'% / 上限 '+C.reaction.fillMax+'%',true)]);
    item('reaction',[check(r.started&&r.cooled,'反应启动与自然冷却记录完整'),...['temp','time'].map(k=>check(range(r[k],C.reaction[k].soft),
      '反应'+(k==='temp'?'温度':'时间')+' '+r[k]+(k==='temp'?' ℃':' h')+'；允许 '+C.reaction[k].soft.join('–'),!range(r[k],C.reaction[k].hard)))]);
    item('post',[check(sep.done&&sep.balanced===C.safety.balance,'离心完成 / 配平 '+!!sep.balanced),
      check(range(sep.rpm,C.post.separation.rpm.soft),'转速 '+sep.rpm+' rpm；允许 '+C.post.separation.rpm.soft.join('–')),
      check(range(sep.minutes,C.post.separation.minutes.soft),'离心 '+sep.minutes+' min；允许 '+C.post.separation.minutes.soft.join('–')),
      ...['water','ethanol'].map(k=>check(finite(wash[k])&&wash[k]>=C.post.washing[k],k+' 洗涤 '+(wash[k]||0)+' / '+C.post.washing[k]+' 轮'))]);
    item('activation',[check(act.done,'活化完成记录 '+!!act.done),check(act.vacuum===C.safety.vacuum,'真空状态 '+!!act.vacuum),
      check(range(act.temp,C.post.activation.temp.soft),'活化 '+act.temp+' ℃；允许 '+C.post.activation.temp.soft.join('–')),
      check(range(act.time,C.post.activation.time.soft),'活化 '+act.time+' h；允许 '+C.post.activation.time.soft.join('–'))]);
    // 历史错误保留于第一层；已纠正偏差不再决定第二层物料结局。
    for(const i of items) {
      const errors=errorEvents.filter(e=>e.step===i.step || i.key==='post'&&e.step===7);
      i.history=errors;
      if(errors.length&&i.status==='pass') { i.status='deviation'; i.notes.push('存在 '+errors.length+' 次操作偏差（最终参数已纠正）'); }
    }
    const failed=items.filter(i=>i.status==='fail'), affected=items.filter(i=>i.status==='deviation');
    const outcomeAffected=items.filter(i=>i.status!=='pending'&&i.checks.some(c=>!c.ok));
    const pending=items.some(i=>i.status==='pending');
    const formation=failed.length?'failed':pending?'pending':outcomeAffected.length?'partial':'formed';
    const penalties=outcomeAffected.reduce((n,i)=>n+i.badCount,0), quality=Math.max(0.1,1-penalties*C.simulation.penaltyPerDeviation);
    const metrics=formation==='pending'?null:{yieldPercent:formation==='failed'?0:+(C.simulation.yieldPercent*quality).toFixed(1),bet:formation==='failed'?0:Math.round(C.simulation.bet*quality),crystalMicrons:formation==='failed'?0:+(C.simulation.crystalMicrons*quality).toFixed(1),color:formation==='failed'?'非目标相/无定形沉淀':'蓝色至蓝紫色'};
    const minor=errorEvents.filter(e=>e.severity==='minor').length, correct=errorEvents.length-minor;
    const clamp=v=>Math.max(0,Math.min(100,Math.round(v)));
    const safety=s.safety||{}, safeCount=(safety.ppe||[]).length+(safety.facilities||[]).length;
    const analysis=s.analysis||{}, reportKeys={q1:'phase',q2:'decrease',q3:'careful'};
    const resolved=errorEvents.filter(e=>{
      const phases=items.filter(i=>i.step===e.step || i.key==='post'&&e.step===7);
      if(phases.some(i=>i.checks.some(c=>!c.ok)))return false;
      if(e.step===11&&!Object.keys(reportKeys).every(k=>analysis[k]===reportKeys[k]))return false;
      return log.some(l=>l.snapshot&&l.step===e.step&&l.action==='step-complete'&&log.indexOf(l)>log.indexOf(e));
    });
    const dimensions=[
      {label:'安全规范',score:clamp(Math.min(1,safeCount/6)*100-errorEvents.filter(e=>/安全|配平|真空|密封|去皮/.test(e.detail)).length*8),evidence:errorEvents.filter(e=>/安全|配平|真空|密封|去皮/.test(e.detail)).map(e=>e.id)},
      {label:'操作准确度',score:clamp(100-outcomeAffected.length*10-minor*C.assessment.minorPenalty-correct*C.assessment.correctPenalty),evidence:errorEvents.map(e=>e.id)},
      {label:'方案执行',score:clamp((s.completed||[]).length/13*100-penalties*3),evidence:log.filter(e=>e.action==='step-complete').map(e=>e.id)},
      {label:'错误纠正能力',score:errorEvents.length?clamp(resolved.length/errorEvents.length*100):100,evidence:resolved.map(e=>e.id)},
      {label:'报告质量',score:analysis.submitted?Math.round(Object.keys(reportKeys).filter(k=>analysis[k]===reportKeys[k]).length/3*100):0,evidence:log.filter(e=>e.snapshot&&e.snapshot.analysis&&e.snapshot.analysis.submitted).slice(-1).map(e=>e.id)}
    ];
    const score=clamp(dimensions.reduce((n,d,i)=>n+d.score*C.assessment.weights[i],0));
    const reasons=[
      '防护与设施检查 '+Math.min(6,safeCount)+'/6；安全相关错误按每次 8 分计。',
      '条件偏差 '+outcomeAffected.length+' 项；轻微错误 '+minor+' × '+C.assessment.minorPenalty+' 分，需纠正错误 '+correct+' × '+C.assessment.correctPenalty+' 分。',
      '已完成 '+(s.completed||[]).length+'/13 步；未达标条件 '+penalties+' 项，每项扣 3 分。',
      errorEvents.length?'已纠正 '+resolved.length+'/'+errorEvents.length+' 次；依据后续完成事件及最终参数复核。':'未发生错误，本项计 100 分。',
      '报告分析题答对 '+Object.keys(reportKeys).filter(k=>analysis[k]===reportKeys[k]).length+'/3；'+(analysis.submitted?'已提交':'尚未提交')+'。'
    ];
    dimensions.forEach((d,i)=>d.reason=reasons[i]);
    const result={specVersion:C.version,items,failed,affected,formation,formationText:{formed:'目标材料形成',partial:'目标材料形成受到影响',failed:'未能形成目标材料',pending:'证据未齐 · 实验尚未完成'}[formation],
      affectedLabels:outcomeAffected.filter(i=>i.status!=='fail').map(i=>i.label),failedLabels:failed.map(i=>i.label),metrics,dimensions,score,
      errorStats:{minor,correct,byStep:errorEvents.reduce((o,e)=>(o[e.step]=(o[e.step]||0)+1,o),{})},demo:!!s.demo,eventCount:log.length};
    result.elapsedMs=(typeof performance!=='undefined'?performance.now():Date.now())-started;
    return result;
  }
  function canAdvance(s) {
    const checks=[
      ()=>s.safety.readProtocol,
      ()=>s.safety.ppe.length===3&&s.safety.facilities.length===3&&s.safety.quiz==='waste',
      ()=>['balance','boat','spatula','beaker','pipette','stirrer','reactor','centrifuge','oven','vial'].every(k=>s.equipment.includes(k)),
      ()=>['cu','btc'].every(k=>s.weigh[k].confirmed&&near(s.weigh[k].added,SPEC.feeds[k].target,SPEC.feeds[k].tol)),
      ()=>s.solutions.A.dissolved&&s.solutions.B.dissolved,
      ()=>s.assembly.aTransferred&&s.assembly.bTransferred&&s.assembly.mixed&&s.assembly.sonicated&&s.assembly.sealed,
      ()=>s.reaction.started&&s.reaction.growth>=1&&s.reaction.cooled,
      ()=>s.separation.done&&s.separation.balanced,
      ()=>s.washing.water>=1&&s.washing.ethanol>=1,
      ()=>s.activation.done&&s.activation.vacuum,
      ()=>['pxrd','bet','sem'].every(k=>s.characterization[k]),
      ()=>s.analysis.submitted,
      ()=>true
    ];
    return !!s.demo || !!(checks[s.step] && checks[s.step]());
  }
  let returnFocus=null;
  function reportHTML(r) {
    return '<section class="report-section"><h4>独立日志评审 · '+escape(SPEC.version)+'</h4><p>'+escape(r.formationText)+' · 五维过程评价 '+r.score+'/100'+(r.demo?' · 演示记录不计成绩':'')+'</p><p>偏差环节：'+escape([...r.failedLabels,...r.affectedLabels].join('、')||'无')+'</p><table><tr><th>维度</th><th>得分</th><th>依据</th></tr>'+r.dimensions.map(d=>'<tr><td>'+escape(d.label)+'</td><td>'+d.score+'/100</td><td>'+escape(d.reason)+' 日志：'+escape(d.evidence.join('、')||'无扣分事件')+'</td></tr>').join('')+'</table><button class="secondary-btn" type="button" data-mof-judge>查看三层评审与日志依据</button></section>';
  }
  function show() {
    if(!root.document||!root.MOFApp)return;
    close(); returnFocus=document.activeElement;
    const r=evaluate(root.MOFApp.getState().opLog), overlay=document.createElement('section');
    overlay.id='mofJudgePanel'; overlay.className='mof-judge';overlay.tabIndex=-1;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','judgeTitle');
    const statusText={pass:'✓ 通过',deviation:'△ 存在偏差',fail:'✕ 未通过',pending:'○ 待完成'};
    overlay.innerHTML='<div class="mof-judge-shell"><header><div><small>MOF STUDIO / EVIDENCE REVIEW</small><h2 id="judgeTitle">三层实验评审</h2><p>'+r.eventCount+' 条日志 · SPEC '+escape(SPEC.version)+' · 判定 '+r.elapsedMs.toFixed(2)+' ms'+(r.demo?' · 演示模式，不计学生成绩':'')+'</p></div><button class="secondary-btn" data-judge-close>返回实验室 ×</button></header>'+
      '<div class="mof-judge-summary"><article><small>01 / 操作规范</small><strong>'+r.items.filter(i=>i.status==='pass').length+' / 8 环节通过</strong><span>保留历史偏差与纠正记录</span></article><article class="'+r.formation+'"><small>02 / 材料结果</small><strong>'+escape(r.formationText)+'</strong><span>教师预设规则 · 教学模拟结果</span></article><article><small>03 / 学习表现</small><strong>'+r.score+'<em> / 100</em></strong><span>五维过程性评价 · 含日志依据</span></article></div>'+
      '<div class="mof-judge-grid"><main><h3>第一层 · 操作是否正确</h3>'+r.items.map(i=>'<details class="mof-rule '+i.status+'"><summary><span>'+escape(i.label)+'</span><b>'+statusText[i.status]+'</b></summary><div>'+i.notes.map(n=>'<p>'+escape(n)+'</p>').join('')+i.checks.map(c=>'<div class="mof-check"><i style="width:'+(c.ok?'100':'38')+'%;background:'+(c.ok?'#62dfbb':'#f3b858')+'"></i><span>'+escape(c.text)+'</span></div>').join('')+'<h4>操作日志原文（最近 8 条）</h4><pre>'+escape(i.evidence.map(e=>JSON.stringify(e,null,2)).join('\n')||'尚无本环节结构化日志')+'</pre><button class="secondary-btn" data-judge-replay="'+i.step+'">回放'+escape(i.label)+'演示</button></div></details>').join('')+'</main><aside><h3>第二层 · 模拟材料结果</h3><div class="mof-outcome '+r.formation+'"><strong>'+escape(r.formationText)+'</strong><p>'+escape([...r.failedLabels,...r.affectedLabels].join(' → ')|| (r.formation==='pending'?'请继续完成实验收集证据':'反应与后处理条件符合方案'))+'</p>'+ (r.metrics?'<dl><dt>模拟产率</dt><dd>'+r.metrics.yieldPercent+'%</dd><dt>模拟 BET</dt><dd>'+r.metrics.bet+' m²/g</dd><dt>模拟晶体尺寸</dt><dd>'+r.metrics.crystalMicrons+' μm</dd></dl>':'')+'</div><div class="mof-timeline">'+Array.from({length:13},(_,n)=>'<span class="'+(r.items.some(i=>i.step===n&&i.status==='fail')?'fail':r.items.some(i=>i.step===n&&i.status==='deviation')?'deviation':'')+'" title="第 '+(n+1)+' 步">'+(n+1)+'</span>').join('')+'</div><h3>第三层 · 学生表现</h3><canvas id="judgeRadar" width="420" height="310" aria-label="五维过程性评价"></canvas>'+r.dimensions.map(d=>'<details class="mof-dimension"><summary>'+d.label+' <b>'+d.score+'/100</b></summary><p>'+escape(d.reason)+'</p><p>日志事件：'+escape(d.evidence.join('、')||'本项无扣分事件；未完成内容按进度计分')+'</p></details>').join('')+'<p class="mof-note">轻微错误 '+r.errorStats.minor+' 次 · 需纠正错误 '+r.errorStats.correct+' 次。结论来自教学规则，不代表真实合成实验测量。</p></aside></div></div>';
    document.body.appendChild(overlay); overlay.focus();
    overlay.addEventListener('click',e=>{if(e.target.closest('[data-judge-close]'))close();const b=e.target.closest('[data-judge-replay]');if(b){close();root.MOFApp.replay(Number(b.dataset.judgeReplay));}});
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,summary')],first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    drawRadar(r.dimensions);
  }
  function close(){if(!root.document)return;const p=document.getElementById('mofJudgePanel');if(p){p.remove();if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}}
  function drawRadar(ds) {
    const canvas=document.getElementById('judgeRadar');if(!canvas)return;
    const ctx=canvas.getContext('2d'),start=performance.now(),reduced=root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function frame(now){if(!canvas.isConnected)return;const t=reduced?1:Math.min(1,(now-start)/650);ctx.clearRect(0,0,420,310);const point=(i,v)=>[210+Math.sin(i*Math.PI*2/5)*v,150-Math.cos(i*Math.PI*2/5)*v];
      ctx.lineWidth=1;for(let j=1;j<=4;j++){ctx.beginPath();for(let i=0;i<5;i++){const p=point(i,j*25);i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.closePath();ctx.strokeStyle='#31475c';ctx.stroke();}
      ctx.beginPath();ds.forEach((d,i)=>{const p=point(i,Math.max(2,d.score)*t);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.fillStyle='rgba(80,222,191,.18)';ctx.strokeStyle='#63e2c1';ctx.fill();ctx.stroke();ctx.fillStyle='#dceaf4';ctx.font='13px sans-serif';ctx.textAlign='center';ds.forEach((d,i)=>{const p=point(i,126);ctx.fillText(d.label,...p);});if(t<1)requestAnimationFrame(frame);
    }requestAnimationFrame(frame);
  }
  function mount(){if(!root.document)return;const host=document.querySelector('.header-actions');if(host&&!document.getElementById('judgeOpenBtn')){const b=document.createElement('button');b.id='judgeOpenBtn';b.className='secondary-btn';b.textContent='三层评审';b.onclick=show;host.prepend(b);}document.addEventListener('click',e=>{if(e.target.closest('[data-mof-judge]'))show();});}
  const api={SPEC,append,observation,evaluate,canAdvance,show,close,reportHTML,mount};root.MOFJudge=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root.document)document.addEventListener('DOMContentLoaded',mount);
})(typeof window!=='undefined'?window:globalThis);
