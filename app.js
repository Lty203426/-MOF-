/* MOF Studio - experiment state machine, teaching interaction and report engine. */
(() => {
'use strict';
const STORAGE_KEY = 'mof-studio-experiment-v1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => Number(n).toFixed(2);
const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const deepCopy = o => JSON.parse(JSON.stringify(o));

/* ---------------- 运行期异常可见化 ----------------
   任何未捕获异常都显示在顶部提示条并记入 RUNTIME_LOG，
   避免出现“点了没反应 / 页面像重新加载”却没有线索的情况。 */
const RUNTIME_LOG = [];
let errorBarTimer = null, lastErrorAt = 0, lastErrorKey = '';
function showErrorBar(title, detail) {
  const text = String(detail || '未知原因').slice(0, 400);
  RUNTIME_LOG.push({ t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), title, detail: text });
  if (RUNTIME_LOG.length > 40) RUNTIME_LOG.shift();
  const key = title + '|' + text.slice(0, 80);
  const now = Date.now();
  if (key === lastErrorKey && now - lastErrorAt < 5000) return;   // 同一错误 5s 内只弹一次
  lastErrorKey = key; lastErrorAt = now;
  try {
    let bar = document.getElementById('errorBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'errorBar';
      document.body.appendChild(bar);
    }
    bar.className = 'error-bar';
    bar.innerHTML = `<div class="error-bar-title"></div><div class="error-bar-detail"></div><button class="error-bar-close" title="关闭">×</button>`;
    bar.querySelector('.error-bar-title').textContent = title;
    bar.querySelector('.error-bar-detail').textContent = text;
    bar.querySelector('.error-bar-close').onclick = () => bar.classList.remove('show');
    requestAnimationFrame(() => bar.classList.add('show'));
    clearTimeout(errorBarTimer);
    errorBarTimer = setTimeout(() => bar.classList.remove('show'), 14000);
  } catch (e) { /* 提示层本身失败时静默 */ }
}
window.addEventListener('error', e => {
  if (!e) return;
  const msg = e.message || e.error?.message;
  if (!msg) return;
  showErrorBar('实验室脚本出错（当前进度已保留）', msg + (e.filename ? `　@ ${String(e.filename).split('/').pop()}:${e.lineno}` : ''));
});
window.addEventListener('unhandledrejection', e => {
  const r = e?.reason;
  showErrorBar('异步任务失败', r?.message || r || '未知原因');
});

/* 本地存储安全封装：file:// 或隐私设置下可能抛 SecurityError，降级为“不保存”而不是中断流程 */
const store = {
  ok: true,
  get(k) { try { return localStorage.getItem(k); } catch (e) { this.ok = false; return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { this.ok = false; return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch (e) { this.ok = false; } }
};

const STEPS = [
  { id:'intro', title:'实验导入', sub:'任务与原理', zone:'实验任务中心', objective:'明确 Cu-BTC 的合成目标，阅读教学参考方案与数据真实性声明。' },
  { id:'safety', title:'安全准备', sub:'PPE 与安全检查', zone:'安全检查工位', objective:'完成个人防护、设施检查和含铜废液处置知识测试。' },
  { id:'equipment', title:'器材就位', sub:'实验装置选择', zone:'器材准备区', objective:'根据溶剂热合成流程选择全部必需器材，排除不适用装置。' },
  { id:'weighing', title:'试剂称量', sub:'Cu 盐与 H₃BTC', zone:'精密称量工位', objective:'分别称取 1.688 g 三水硝酸铜和 1.050 g 均苯三甲酸，误差不超过 ±0.005 g。' },
  { id:'solution', title:'溶液配制', sub:'前驱体溶液 A / B', zone:'溶液配制工位', objective:'将两种试剂分别溶解，控制溶剂种类、体积和搅拌状态。' },
  { id:'assembly', title:'反应组装', sub:'前驱体转移与密封', zone:'反应体系组装区', objective:'将 A、B 溶液转移至聚四氟乙烯内衬反应釜，充分混合并检查密封。' },
  { id:'reaction', title:'晶体生长', sub:'溶剂热配位组装', zone:'溶剂热反应区', objective:'设置 120 ℃、24 h，观察配位组装、成核与晶体生长的概念模型。' },
  { id:'separation', title:'离心分离', sub:'固液分离', zone:'产物分离工位', objective:'配平离心管，在 5000 rpm 下分离 2.5 min，收集蓝色固体。' },
  { id:'washing', title:'洗涤纯化', sub:'水 / 乙醇各 3 次', zone:'产物洗涤工位', objective:'依次用去离子水和乙醇洗涤，各 3 次，降低残余杂质。' },
  { id:'activation', title:'真空活化', sub:'孔道溶剂脱除', zone:'真空活化工位', objective:'在真空条件下于 120 ℃ 活化 12 h，获得模拟活化产物。' },
  { id:'characterization', title:'结构表征', sub:'PXRD · BET · SEM', zone:'材料表征中心', objective:'完成三项模拟表征，比较样品与参考结果并记录结构信息。' },
  { id:'analysis', title:'数据分析', sub:'产率与结构性能关联', zone:'实验数据分析区', objective:'计算产率，分析衍射、吸附和形貌结果，建立操作—结构—性能联系。' },
  { id:'report', title:'实验报告', sub:'过程评价与导出', zone:'实验报告中心', objective:'生成基于本次真实操作记录的实验报告与过程性评价。' }
];
const REQUIRED_EQUIPMENT = ['balance','boat','spatula','beaker','pipette','stirrer','reactor','centrifuge','oven','vial'];
const EQUIPMENT = [
  ['balance','分析天平','精度 0.1 mg'],['boat','称量舟','惰性称量容器'],['spatula','药匙','少量多次加样'],['beaker','烧杯 ×2','分别配制 A / B'],['pipette','移液器','准确量取溶剂'],['stirrer','磁力搅拌器','溶解与混合'],['reactor','水热反应釜','PTFE 内衬 25 mL'],['centrifuge','高速离心机','固液分离'],['oven','真空干燥箱','样品活化'],['vial','样品瓶','产物收集'],['condenser','回流冷凝管','本方案不需要'],['volumetric','容量瓶','非本实验定容操作']
];
const REAGENTS = {
  cu:{ name:'三水硝酸铜', formula:'Cu(NO₃)₂·3H₂O', target:1.688, molar:241.60, role:'金属源，提供 Cu²⁺ 配位节点', hazard:'氧化性、刺激性；避免接触皮肤与吸入粉尘。含铜废液必须分类回收。' },
  btc:{ name:'均苯三甲酸', formula:'H₃BTC · C₉H₆O₆', target:1.050, molar:210.14, role:'有机配体，去质子化后连接铜节点', hazard:'粉尘可能刺激呼吸道；在通风良好处操作并佩戴手套。' }
};
const REFERENCE = '教学参考：公开实验方案中 Cu(NO₃)₂·3H₂O 1.688 g、H₃BTC 1.050 g，120 ℃ 溶剂热反应 24 h；水/乙醇洗涤并离心，随后真空干燥。配方与容差集中于本系统配置，正式教学或参赛前须由指导教师审核。';

/* ---------------- 合成结果判定配置（教师预设 · 确定性规则） ----------------
   对应教学设计文档第二层判定：不由模型推测，而是依据已审核实验方案事先配置。
   条件分两类：critical（关键条件，严重偏离 → 合成失败/不确定）与
   quality（一般质量条件，偏离 → 仍可得目标材料，但产率/质量下降）。 */
// 教学参数由独立 judge.js 统一维护；脚本在 DOMContentLoaded 前完成加载。
const SYNTHESIS_RULES = new Proxy({}, { get: (_, key) => window.MOFJudge.SPEC[key] });

function defaultState() {
  return {
    version:1, step:0, completed:[], demo:false, startedAt:Date.now(), elapsed:0,
    logs:[], errors:[], hints:[], safety:{ ppe:[], facilities:[], quiz:'', readProtocol:false },
    equipment:[], activeReagent:'cu',
    weigh:{ cu:{boat:false,tared:false,added:0,confirmed:false}, btc:{boat:false,tared:false,added:0,confirmed:false} },
    solutions:{ A:{solid:false,solvent:'',volume:0,added:false,stirred:false,dissolved:false}, B:{solid:false,solvent:'',volume:0,added:false,stirred:false,dissolved:false} },
    assembly:{aTransferred:false,bTransferred:false,mixed:false,sonicated:false,sealed:false},
    reaction:{temp:120,time:24,started:false,growth:0,playing:false,cooled:false},
    separation:{transferred:false,balanced:false,rpm:5000,minutes:2.5,done:false},
    washing:{water:0,ethanol:0}, activation:{temp:120,time:12,vacuum:false,vialPlaced:false,done:false},
    characterization:{pxrd:false,bet:false,sem:false}, activeChar:'pxrd',
    structure:{ mode:'cif', showH:true, showCell:true, thermal:false },
    pxrdImport:null,
    analysis:{q1:'',q2:'',q3:'',submitted:false}, settings:{lowQuality:false},
    opLog:[]   // 结构化操作事件日志：第二层判定“根据操作日志计算实验结果”的依据
  };
}
let state = defaultState(), lab = null, growthTimer = null, saveDebounce = null, timerHandle = null;
let directActionLock = false;   // 3D 直接操作动画播放中，忽略重复点击
let sessionActive = false;

function save() {
  if (!sessionActive) return;
  $('#saveStatus').textContent = '正在保存…';
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    if (!state.demo) {
      try {
        const copy = deepCopy(state); copy.reaction.playing = false;
        if (store.set(STORAGE_KEY, JSON.stringify(copy))) $('#saveStatus').textContent = '进度已本地保存';
        else $('#saveStatus').textContent = '本地保存不可用（不影响实验）';
      } catch (e) { $('#saveStatus').textContent = '本地保存不可用（不影响实验）'; }
    } else $('#saveStatus').textContent = '演示模式不保存';
  }, 250);
}
function loadSaved() {
  try {
    const raw = store.get(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s?.version !== 1) return null;
    const merged = Object.assign(defaultState(), s);
    // 老版本存档可能缺少后加的嵌套字段，逐层补齐，避免读取 undefined 时报错
    merged.structure = Object.assign(defaultState().structure, s.structure || {});
    merged.settings = Object.assign(defaultState().settings, s.settings || {});
    ['safety', 'weigh', 'solutions', 'assembly', 'reaction', 'separation', 'washing', 'activation', 'characterization', 'analysis', 'pxrdImport', 'opLog'].forEach(k => {
      if (merged[k] === undefined) merged[k] = defaultState()[k];
    });
    return merged;
  } catch (e) { return null; }
}
function addLog(message, type='info', step=state.step) {
  if (window.MOFJudge) window.MOFJudge.append(state, 'log-message', message);
  state.logs.unshift({ time:nowTime(), step:STEPS[step]?.title || '系统', message, type });
  if (state.logs.length > 160) state.logs.length = 160;
  renderLogs(); save();
}
function toast(title, message='', type='info', duration=3800) {
  const el = document.createElement('div'); el.className = `toast ${type}`;
  el.innerHTML = `<b>${title}</b><p>${message}</p>`; $('#toastRoot').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(12px)'; setTimeout(()=>el.remove(),250); }, duration);
}
/* 错误严重程度分级（教学设计第一层）：
   minor  = 轻微错误 → 提醒学生检查，但允许继续（如非关键步骤的顺序/参数偏差）；
   correct = 需要纠正的错误 → 必须重新称量、重新配液或修正参数后才能继续。 */
function recordError(title, message, severity='correct') {
  state.errors.push({ step:STEPS[state.step].title, title, message, time:nowTime(), severity });
  window.MOFJudge?.append(state, 'operation-error', title + '：' + message, { severity });
  addLog(`${severity==='minor'?'[轻微] ':''}${title}：${message}`, severity==='minor'?'warn':'error');
  toast(title, message, severity==='minor'?'warn':'error', severity==='minor'?4200:4800);
  lab?.sfx?.error();
  if (severity !== 'minor') {
    lab?.focusForStep(state.step);
    showModal('<div class="modal-head"><h3>请先纠正：'+title+'</h3></div><div class="modal-body"><p>'+message+'</p></div><div class="modal-footer"><button class="primary-btn" data-close>返回修正操作</button></div>');
  }
}
function logOp(event, detail='') {
  return window.MOFJudge?.append(state, event, detail);
}
function hint(level) {
  const h = {
    1:['操作提示', STEPS[state.step].objective],
    2:['详细提示', detailedHint(state.step)],
    3:['原理说明', principleHint(state.step)]
  }[level];
  state.hints.push({step:state.step,level,time:nowTime()}); addLog(`查看${h[0]}`, 'info'); toast(h[0],h[1],'info',6500);
}
function detailedHint(step) {
  return [
    '先勾选“已阅读教学方案与数据声明”，再点击“接受实验任务”。',
    '实验服、护目镜、丁腈手套均为必选项；通风橱和含铜废液桶都要检查。废液应分类回收。',
    '必需器材共 10 项。本实验使用水热釜而非回流装置，也不需要容量瓶定容。',
    '先放称量舟，再去皮。用 +0.100、+0.010、+0.001 g 逐步逼近目标，两个试剂都要分别确认。',
    'A 使用去离子水，B 使用乙醇，体积均为 3.0 mL；先加固试剂，再加溶剂，最后搅拌。',
    '先转移 A，再转移 B；搅拌混匀后密封。装液量 6 mL，占 25 mL 内衬容积的 24%。',
    '参考条件为 120 ℃、24 h。关键范围 90–150 ℃ / 12–36 h（严重偏离按失败规则判定）；预设范围 112–128 ℃ / 21–27 h（偏离影响产物质量）。启动后等待时间轴达到 100%，再自然冷却。',
    '离心前必须配平。参数为 5000 rpm、2.5 min，转速达到设定值后再计时。',
    '方案规定水和乙醇各洗涤 3 次；最少各 2 次可继续，少于 3 次将记录「存在偏差」并降低产物质量。每次洗涤包含重悬、离心和弃去上清液。',
    '开启真空，设置 120 ℃、12 h。温度过高可能损伤框架，过低则活化不充分。',
    '依次切换 PXRD、BET、SEM 并运行模拟表征，三个模块均完成后才可继续。',
    '根据图谱和产率数据作答。特征峰匹配说明晶相一致，充分活化有利于开放孔道。',
    '报告由本次操作记录自动生成，可打印为 PDF，也可导出 JSON 原始记录。'
  ][step];
}
function principleHint(step) {
  const map = {
    3:'相对误差 = |实际质量 − 目标质量| / 目标质量 × 100%。去皮用于扣除称量舟质量，不能省略。',
    4:'名义浓度按已加入溶质的物质的量除以配制体积计算；溶解并不改变溶质的物质的量。',
    6:'Cu²⁺ 与 BTC 羧酸根经配位组装形成桨轮节点和三维网络。本动画是教学概念模型，不是分子动力学计算。',
    9:'活化通过加热和真空脱除孔道内溶剂。开放孔道是获得高比表面积的前提，但温度过高可能破坏框架。',
    10:'PXRD 反映晶相与结晶性；BET 描述可接触表面积；SEM 提供形貌信息。三者互相补充，不能相互替代。',
    11:'理论产量按限制性试剂和 Cu₃(BTC)₂ 计量关系估算；实际产量受反应、分离和洗涤损失共同影响。'
  };
  return map[step] || '虚拟仿真用于训练实验逻辑与科学思维，所有结果均需与真实实验和仪器数据区分。';
}

function btn(action, text, primary=true, disabled=false, attrs='') { const extraClass=(attrs.match(/class="([^"]+)"/)||[])[1]||''; attrs=attrs.replace(/class="[^"]*"/,''); return `<button class="${primary?'primary-btn':'secondary-btn'} small-btn ${extraClass}" data-action="${action}" ${disabled?'disabled':''} ${attrs}>${text}</button>`; }
function feedback(type,title,text) { return `<div class="feedback ${type}"><b>${title}</b>${text}</div>`; }
function taskShell(inner) {
  const s = STEPS[state.step];
  return `<div class="task-eyebrow"><span class="task-number">STEP ${String(state.step+1).padStart(2,'0')} / 13</span><span class="task-status">${state.demo?'演示模式':'进行中'}</span></div><h2>${s.title}</h2><p class="task-desc">${s.sub} · ${s.zone}</p><div class="objective-card"><b>当前任务</b><p>${s.objective}</p></div>${inner}<details class="hint-box"><summary>需要一点帮助？</summary><div class="hint-content">${detailedHint(state.step)}</div><div class="hint-links"><button data-action="hint" data-level="2">详细提示</button><button data-action="hint" data-level="3">原理说明</button></div></details>`;
}
function field(label,path,value,unit='',type='number',extra='') {
  return `<div class="field"><label>${label}<span>${unit}</span></label><div class="input-unit"><input type="${type}" value="${value}" data-field="${path}" ${extra}>${unit?`<span>${unit}</span>`:''}</div></div>`;
}
function renderNav() {
  $('#stepNav').innerHTML = STEPS.map((s,i) => {
    const done = state.completed.includes(i), active = i===state.step, locked = !state.demo && i>state.step;
    return `<div class="step-item ${active?'active':''} ${done?'done':''} ${locked?'locked':''}" data-step="${i}"><span class="step-index">${done?'✓':String(i+1).padStart(2,'0')}</span><div class="step-copy"><b>${s.title}</b><small>${s.sub}</small></div>${locked?'<span class="step-lock">锁</span>':''}</div>`;
  }).join('');
  $('#stepCounter').textContent = `${String(state.step+1).padStart(2,'0')} / 13`;
  const pct = Math.round(state.completed.length / STEPS.length * 100);
  $('#progressText').textContent = `${pct}%`; $('#progressBar').style.width = `${pct}%`;
  $('#zoneName').textContent = STEPS[state.step].zone;
  const chip = $('#statusChip');
  if (chip) {
    chip.textContent = state.demo ? '演示模式 · 不计成绩' : (state.completed.length === STEPS.length ? '实验已完成' : '实验进行中');
    chip.classList.toggle('demo', !!state.demo);
  }
}
function renderLogs() {
  $('#logCount').textContent = state.logs.length;
  $('#logList').innerHTML = state.logs.length ? state.logs.map(l=>`<div class="log-row"><span class="log-time">${l.time}</span><span class="log-step">${l.step}</span><span class="log-message" title="${l.message}">${l.message}</span><span class="log-type ${l.type}">${l.type==='success'?'完成':l.type==='error'?'需纠正':l.type==='warn'?'提醒':'记录'}</span></div>`).join('') : '<div class="log-row"><span class="log-message">实验日志将在操作后自动生成</span></div>';
}
function renderAll(focus=false) {
  renderNav(); renderPanel(); renderLogs(); lab?.updateFromState(state); save();
  updateActionHints();
  if (focus) setTimeout(()=>lab?.focusForStep(state.step),100);
}
function completeStep(message) {
  if (!window.MOFJudge.canAdvance(state)) {
    recordError('当前步骤尚未完成','请先完成本步骤的必需操作，并等待仪器动画结束。');
    return;
  }
  if (lab?.crystalMode) { lab.overview(); $('#crystalViewBtn').classList.remove('active'); }
  const i = state.step;
  if (!state.completed.includes(i)) state.completed.push(i);
  logOp('step-complete', message || STEPS[i].title);
  addLog(message || `完成「${STEPS[i].title}」`, 'success');
  toast('步骤完成', message || STEPS[i].title, 'success');
  lab?.sfx?.stepDone();
  lab?.assistantCelebrate?.();   // 3D 实验员庆祝动作（拍手 + 轻跳）
  if (state.step < STEPS.length-1) state.step++;
  renderAll(true);
  lab?.assistantGoToStep?.(state.step, STEPS[state.step]?.title);   // 助手同步走向下一工位并播报标题
}

function renderPanel() {
  window.MOFJudge?.append(state, 'state-observed');
  const panel = $('#taskPanel');
  const renderers = [renderIntro,renderSafety,renderEquipment,renderWeighing,renderSolutions,renderAssembly,renderReaction,renderSeparation,renderWashing,renderActivation,renderCharacterization,renderAnalysis,renderReport];
  panel.innerHTML = taskShell(renderers[state.step]());
  if (state.step===10) requestAnimationFrame(drawActiveChart);
}

function renderIntro() {
  return `<div class="section-label">实验原理</div><p class="task-desc">Cu²⁺ 与均苯三甲酸根通过配位自组装，形成具有三维多孔网络的 Cu-BTC 晶体。实验将参数变化与模拟晶相、孔性能和产率关联。</p><div class="data-grid"><div class="data-cell"><small>金属源</small><b>Cu²⁺</b></div><div class="data-cell"><small>有机配体</small><b>H₃BTC</b></div><div class="data-cell"><small>反应温度</small><b>120 <em>℃</em></b></div><div class="data-cell"><small>反应时间</small><b>24 <em>h</em></b></div></div><label class="check-item ${state.safety.readProtocol?'checked':''}"><input type="checkbox" data-action="protocol" ${state.safety.readProtocol?'checked':''}>我已阅读教学方案与数据声明</label><div class="feedback info"><b>数据真实性声明</b>三维晶体生长为教学简化模型；PXRD、BET 与 SEM 为可配置模拟数据，不代表真实仪器测量。</div><button class="secondary-btn wide-btn" data-action="reference">查看参考方案与试剂信息</button>${btn('accept-task','接受实验任务',true,!state.safety.readProtocol,'class="primary-btn wide-btn"')}`;
}
function renderSafety() {
  const ppe=[['coat','实验服','覆盖身体与衣物'],['goggle','护目镜','防飞溅与粉尘'],['gloves','丁腈手套','避免皮肤接触']], facilities=[['hood','通风橱运行正常','风速与照明已检查'],['waste','含铜废液桶就位','分类标签清晰'],['eyewash','洗眼器可用','应急通道无遮挡']];
  return `<div class="section-label">01 · 个人防护装备</div><div class="check-list">${ppe.map(([id,n,d])=>`<label class="check-item ${state.safety.ppe.includes(id)?'checked':''}"><input type="checkbox" data-action="ppe" value="${id}" ${state.safety.ppe.includes(id)?'checked':''}>${n}<span class="check-meta">${d}</span></label>`).join('')}</div><div class="section-label">02 · 环境与应急设施</div><div class="check-list">${facilities.map(([id,n,d])=>`<label class="check-item ${state.safety.facilities.includes(id)?'checked':''}"><input type="checkbox" data-action="facility" value="${id}" ${state.safety.facilities.includes(id)?'checked':''}>${n}<span class="check-meta">${d}</span></label>`).join('')}</div><div class="section-label">03 · 安全知识检查</div><p class="task-desc">反应后的含铜母液应如何处理？</p>${[['drain','倒入水槽并用大量水冲洗'],['waste','倒入贴有标签的含重金属废液桶'],['bottle','装回原始试剂瓶']].map(([v,t])=>`<button class="quiz-option ${state.safety.quiz===v?'selected':''}" data-action="quiz" data-value="${v}">${t}</button>`).join('')}${btn('check-safety','确认并进入器材准备',true,false,'class="primary-btn wide-btn"')}`;
}
function renderEquipment() {
  return `<div class="section-label">从器材区选择所需设备</div><div class="equipment-grid">${EQUIPMENT.map(([id,n,d])=>`<button class="equipment-item ${state.equipment.includes(id)?'selected':''}" data-action="equipment" data-value="${id}"><b>${n}</b><small>${d}</small></button>`).join('')}</div><div class="target-line"><span>已选择</span><b>${state.equipment.length} 项 / 必需 10 项</b></div>${feedback('info','布置规则','器材选择应与溶剂热合成、离心分离及真空活化流程一致。')}${btn('check-equipment','布置到实验台',true,false,'class="primary-btn wide-btn"')}`;
}
function renderWeighing() {
  const key=state.activeReagent, r=REAGENTS[key], w=state.weigh[key], display=(w.added+(!w.tared&&w.boat?0.35:0)).toFixed(3), err=Math.abs(w.added-r.target)/r.target*100;
  return `${ruleChip('称量判定：去皮后净质量与目标值偏差 ≤ ±0.005 g；未去皮加样将记录轻微偏差并留痕。')}<div class="reagent-tabs"><button data-action="select-reagent" data-value="cu" class="${key==='cu'?'active':''}">三水硝酸铜 ${state.weigh.cu.confirmed?'✓':''}</button><button data-action="select-reagent" data-value="btc" class="${key==='btc'?'active':''}">均苯三甲酸 ${state.weigh.btc.confirmed?'✓':''}</button></div><div class="solution-card"><div class="solution-head"><b>${r.name}</b><span class="${w.confirmed?'done':''}">${w.confirmed?'称量完成':'待称量'}</span></div><div class="target-line"><span>化学式</span><b>${r.formula}</b></div><div class="target-line"><span>目标质量</span><b>${r.target.toFixed(3)} g ± ${SYNTHESIS_RULES.feeds[key].tol} g</b></div><div class="balance-display"><small>ANALYTICAL BALANCE · 0.001 g</small><strong>${display}<em>g</em></strong></div><div class="button-row">${btn('place-boat',w.boat?'称量舟已放置':'放置称量舟',false,w.boat)}${btn('tare','去皮 / TARE',false,!w.boat||w.tared)}</div><div class="section-label">使用药匙逐步加样</div><div class="mass-buttons">${btn('add-mass','+ 0.100 g',false,false,'data-value="0.1"')}${btn('add-mass','+ 0.010 g',false,false,'data-value="0.01"')}${btn('add-mass','+ 0.001 g',false,false,'data-value="0.001"')}</div><div class="button-row">${btn('remove-mass','移除 0.010 g',false,w.added<=0)}${btn('confirm-weigh','确认称量',true,false)}</div><div class="target-line"><span>实际加样 / 相对误差</span><b class="${err<0.3?'metric-good':''}">${w.added.toFixed(3)} g / ${err.toFixed(3)}%</b></div></div>${feedback('info','规范操作','称量舟未去皮时显示额外 0.350 g。达到容差后分别确认两种试剂。')}${btn('finish-weighing','进入溶液配制',true,!(state.weigh.cu.confirmed&&state.weigh.btc.confirmed),'class="primary-btn wide-btn"')}`;
}
function renderSolutions() {
  return ['A','B'].map(k=>{
    const s=state.solutions[k], isA=k==='A', r=isA?REAGENTS.cu:REAGENTS.btc, mmol=(r.target/r.molar*1000), conc=s.added?(mmol/s.volume).toFixed(3):'—';
    return `<div class="solution-card"><div class="solution-head"><b>溶液 ${k} · ${isA?'金属盐':'有机配体'}</b><span class="${s.dissolved?'done':''}">${s.dissolved?'澄清已溶解':'配制中'}</span></div><div class="target-line"><span>已称量试剂</span><b>${r.target.toFixed(3)} g</b></div><div class="button-row">${btn('add-solid',s.solid?'试剂已加入':'加入固体试剂',false,s.solid,`data-value="${k}"`)}</div><div class="field"><label>选择溶剂<span>${isA?'极性溶剂':'有机溶剂'}</span></label><select data-field="solutions.${k}.solvent" ${s.added?'disabled':''}><option value="">请选择</option><option value="water" ${s.solvent==='water'?'selected':''}>去离子水</option><option value="ethanol" ${s.solvent==='ethanol'?'selected':''}>无水乙醇</option><option value="dmf" ${s.solvent==='dmf'?'selected':''}>N,N-二甲基甲酰胺</option></select></div>${field('溶剂体积',`solutions.${k}.volume`,s.volume,'mL','number','min="0" max="10" step="0.1"')}${btn('add-solvent',s.added?'溶剂已加入':'加入溶剂',false,s.added,`data-value="${k}"`)}<div class="concentration">n = ${mmol.toFixed(3)} mmol ｜ 名义浓度 c = ${conc} mol/L</div><div class="button-row">${btn('stir-solution',s.stirred?'已完成搅拌':'启动搅拌 600 rpm',true,!s.added||s.dissolved,`data-value="${k}"`)}</div></div>`;
  }).join('')+`${ruleChip('配液判定：溶剂种类须与方案一致（A 水 / B 乙醇），体积 3.0 ± 0.1 mL；溶剂与体积由物料记录核算。')}${feedback('info','参考配制方案','A：三水硝酸铜 + 3.0 mL 去离子水；B：H₃BTC + 3.0 mL 乙醇。体积和浓度由实际数据计算。')}${btn('finish-solutions','确认前驱体溶液',true,!(state.solutions.A.dissolved&&state.solutions.B.dissolved),'class="primary-btn wide-btn"')}`;
}
function renderAssembly() {
  const a=state.assembly;
  const vol=(a.aTransferred?3:0)+(a.bTransferred?3:0);
  return `${ruleChip('组装判定：加料顺序（先 A 后 B、混合后超声）由操作事件校验；密封与填充率 ≤ 80% 为关键安全条件。')}<div class="section-label">受控液体转移</div><div class="solution-card"><div class="solution-head"><b>25 mL 聚四氟乙烯内衬</b><span class="${a.sealed?'done':''}">${a.sealed?'已密封':'未密封'}</span></div><div class="data-grid"><div class="data-cell"><small>装液体积</small><b>${vol} <em>mL</em></b></div><div class="data-cell"><small>内衬填充率</small><b>${vol?(vol/25*100).toFixed(0):0}<em>%</em></b></div></div><div class="check-list"><div class="check-item ${a.aTransferred?'checked':''}">金属盐溶液 A ${a.aTransferred?'已转移':'待转移'}</div><div class="check-item ${a.bTransferred?'checked':''}">配体溶液 B ${a.bTransferred?'已转移':'待转移'}</div><div class="check-item ${a.mixed?'checked':''}">磁力混合 ${a.mixed?'均匀':'未完成'}</div><div class="check-item ${a.sonicated?'checked':''}">超声分散 ${a.sonicated?'完成':'未完成'}</div></div></div><div class="button-row">${btn('transfer-a','转移溶液 A',false,a.aTransferred)}${btn('transfer-b','加入溶液 B',false,a.bTransferred||!a.aTransferred)}</div><div class="button-row">${btn('mix-reaction',a.mixed?'混合完成':'搅拌混合 15 min',false,!a.bTransferred||a.mixed)}${btn('sonicate',a.sonicated?'超声完成':'超声分散 10 min',false,!a.mixed||a.sonicated)}</div><div class="button-row">${btn('seal-reactor','检查并密封',true,!a.sonicated||a.sealed)}</div>${feedback(a.sealed?'success':'warn',a.sealed?'体系检查通过':'密封安全','填充率不得超过 80%；本体系为 24%，满足密闭溶剂热反应要求。')}${btn('finish-assembly','进入反应条件设置',true,!a.sealed,'class="primary-btn wide-btn"')}`;
}
function growthStage(p) { return p<0.12?['反应体系形成','前驱体均匀分散']:p<0.35?['配位组装','Cu²⁺ 与 BTC 连接']:p<0.55?['晶核出现','局部有序结构形成']:p<0.9?['晶体生长','三维网络持续扩展']:['生长结束','蓝色晶体产物形成']; }
function renderReaction() {
  const r=state.reaction, p=Math.round(r.growth*100), T=SYNTHESIS_RULES.reaction.temp, H=SYNTHESIS_RULES.reaction.time;
  let stage=growthStage(r.growth);
  if(r.started&&r.growth>=1){ const ap=productAppearance(); stage=['生长结束',`${ap.text} · 产物可取出`]; }
  return `${ruleChip(`条件判定：关键范围 ${T.hard[0]}–${T.hard[1]} ℃ / ${H.hard[0]}–${H.hard[1]} h（严重偏离按失败规则）；预设范围 ${T.soft[0]}–${T.soft[1]} ℃ / ${H.soft[0]}–${H.soft[1]} h（偏离影响质量）。`)}<div class="section-label">溶剂热反应参数</div><div class="data-grid"><div class="data-cell"><small>参考温度</small><b>120 <em>℃</em></b></div><div class="data-cell"><small>参考时间</small><b>24 <em>h</em></b></div></div>${field('反应温度','reaction.temp',r.temp,'℃','number','min="20" max="200"')}${field('反应时间','reaction.time',r.time,'h','number','min="1" max="72"')}${feedback('info','压力条件','自生压力。密闭反应釜必须在通风橱内冷却至室温后方可开启。')}${!r.started?btn('start-reaction','密封检查并启动反应',true,false,'class="primary-btn wide-btn"'):`<div class="growth-stage"><small>CRYSTAL GROWTH · ${p}%</small><b>${stage[0]}</b><p>${stage[1]}</p></div><div class="timeline"><div class="timeline-track"><i id="growthBar" style="width:${p}%"></i></div><div class="timeline-labels"><span>混合</span><span>组装</span><span>成核</span><span>生长</span><span>产物</span></div><input id="growthSlider" type="range" min="0" max="100" value="${p}" aria-label="晶体生长时间轴"></div><div class="button-row">${btn(r.playing?'pause-growth':'resume-growth',r.playing?'暂停':'继续',false,p>=100)}${btn('replay-growth','重新播放',false)}${btn('show-crystal','结构视图',true)}</div>${p>=100?synthesisVerdictCard():''}${feedback('warn','教学简化模型','时间轴为概念性配位组装与晶体生长示意，不代表真实成核速率或分子动力学结果。')}${p>=100&&!r.cooled?btn('cool-reaction','自然冷却至室温',true,false,'class="primary-btn wide-btn"'):''}${r.cooled?btn('finish-reaction','取出产物并继续',true,false,'class="primary-btn wide-btn"'):''}`}`;
}
function renderSeparation() {
  const s=state.separation, ap=productAppearance();
  return `${ruleChip('分离判定：先转移、后配平为关键安全条件；参数预设 5000 rpm · 2.5 min，偏离将影响回收率。')}<div class="section-label">离心机操作</div><label class="check-item ${s.transferred?'checked':''}"><input type="checkbox" data-action="separate-transfer" ${s.transferred?'checked':''}>反应产物已转移至离心管</label><label class="check-item ${s.balanced?'checked':''}"><input type="checkbox" data-action="balance-tubes" ${s.balanced?'checked':''}>离心管已对称配平<span class="check-meta">质量差 ≤ 0.01 g</span></label>${field('离心转速','separation.rpm',s.rpm,'rpm','number','min="1000" max="12000" step="100"')}${field('离心时间','separation.minutes',s.minutes,'min','number','min="0.5" max="20" step="0.5"')}<div class="data-grid"><div class="data-cell"><small>参考回收率</small><b>96.0 <em>%</em></b></div><div class="data-cell"><small>产物外观</small><b style="color:${ap.color}">${ap.text}</b></div></div>${btn('start-centrifuge',s.done?'固液分离完成':'启动离心分离',true,s.done,'class="primary-btn wide-btn"')}${s.done?feedback('success','分离完成',`${ap.text}沉降于离心管底部，上清液已分离。请继续洗涤纯化。`):feedback('warn','配平是必要条件','未配平高速旋转会产生剧烈振动并损伤转子。')}${btn('finish-separation','收集固体并继续',true,!s.done,'class="primary-btn wide-btn"')}`;
}
function renderWashing() {
  const w=state.washing, impurity=Math.max(0.8,100*Math.pow(0.55,w.water)*Math.pow(0.42,w.ethanol)), minEach=SYNTHESIS_RULES.post.washing.minEach;
  return `${ruleChip(`洗涤判定：方案规定水 / 乙醇各 3 次；最少各 ${minEach} 次可继续，少于 3 次将记录「存在偏差」并影响产物质量。`)}<div class="section-label">洗涤程序</div><p class="task-desc">每次洗涤：加入溶剂 → 重悬固体 → 离心 → 弃去上清液。避免将固体随上清液倒出。</p><div class="solution-card"><div class="solution-head"><b>去离子水</b><span class="${w.water>=3?'done':''}">${w.water} / 3 次</span></div><p class="task-desc">去除水溶性残余盐和无机杂质</p>${btn('wash-water','执行一次水洗',false,w.water>=3)}</div><div class="solution-card"><div class="solution-head"><b>乙醇</b><span class="${w.ethanol>=3?'done':''}">${w.ethanol} / 3 次</span></div><p class="task-desc">溶剂交换并促进后续干燥</p>${btn('wash-ethanol','执行一次醇洗',false,w.ethanol>=3)}</div><div class="data-grid"><div class="data-cell"><small>模拟杂质残留</small><b>${impurity.toFixed(2)} <em>%</em></b></div><div class="data-cell"><small>累计洗涤损失</small><b>${(w.water*0.4+w.ethanol*0.3).toFixed(1)} <em>%</em></b></div></div>${feedback('info','确定性规则模型','杂质按各次洗涤的固定去除系数递减，回收率包含可控操作损失；不使用随机数生成结果。')}${btn('finish-washing','完成洗涤并收集样品',true,!(w.water>=minEach&&w.ethanol>=minEach),'class="primary-btn wide-btn"')}`;
}
function renderActivation() {
  const a=state.activation, A=SYNTHESIS_RULES.post.activation;
  return `${ruleChip(`活化判定：真空为关键条件；预设 ${A.temp.soft[0]}–${A.temp.soft[1]} ℃ / ≥${A.time.soft[0]} h，超过 ${A.temp.damageAbove} ℃ 记录框架损伤风险。`)}<div class="section-label">活化参数</div>${field('活化温度','activation.temp',a.temp,'℃','number','min="25" max="250"')}${field('活化时间','activation.time',a.time,'h','number','min="1" max="48"')}<label class="check-item ${a.vacuum?'checked':''}"><input type="checkbox" data-action="vacuum" ${a.vacuum?'checked':''}>开启真空系统<span class="check-meta">目标 −0.09 MPa</span></label><div class="data-grid"><div class="data-cell"><small>参考条件</small><b>120 ℃ / 12 h</b></div><div class="data-cell"><small>孔道状态</small><b>${a.done?'已开放':'溶剂占据'}</b></div></div>${feedback('warn','条件影响','温度过低或时间过短会造成残余溶剂堵孔；超过 180 ℃ 将增加框架损伤风险。')}${btn('start-activation',a.done?'真空活化完成':'启动真空活化',true,a.done,'class="primary-btn wide-btn"')}${a.done?feedback('success','活化完成','孔道内溶剂已在教学模型中脱除，获得可用于模拟吸附分析的活化样品。'):''}${btn('finish-activation','进入材料表征',true,!a.done,'class="primary-btn wide-btn"')}`;
}
/* ---- 真实 CIF / PXRD 数据相关 ---- */
function cifStructure() { return lab && lab.structure ? lab.structure : null; }
function cifSummary() {
  const st = cifStructure();
  if (!st) return `<div class="feedback warn"><b>CIF 结构未载入</b>内置晶体学数据不可用，PXRD 参考谱将回退为简化教学峰位模型。</div>`;
  const c = st.cell, m = st.meta || {};
  return `<div class="section-label">晶体学数据（来自内置 CIF）</div><div class="cif-card">
    <div class="cif-head"><b>${m.name || st.name}</b><span class="cif-badge">CIF</span></div>
    <div class="data-grid">
      <div class="data-cell"><small>空间群</small><b>${st.spaceGroup || '—'}</b></div>
      <div class="data-cell"><small>晶胞参数 a</small><b>${c.a.toFixed(3)} <em>Å</em></b></div>
      <div class="data-cell"><small>晶胞体积 V</small><b>${st.volume.toFixed(1)} <em>Å³</em></b></div>
      <div class="data-cell"><small>Z</small><b>${st.Z}</b></div>
      <div class="data-cell"><small>晶体密度 ρ</small><b>${st.density.toFixed(3)} <em>g/cm³</em></b></div>
      <div class="data-cell"><small>原子数 / 晶胞</small><b>${st.atoms.length}</b></div>
    </div>
    <div class="concentration">${st.formula} ｜ M<sub>cell</sub> = ${st.formulaWeight.toFixed(1)} g/mol ｜ 对称操作 ${st.nSymmetry} 个</div>
    <div class="source-tag">${m.citation ? '文献：' + m.citation + '　·　' : ''}来源：${m.source || '内置 CIF 库'}</div>
  </div>`;
}
function structureControls() {
  const s = state.structure;
  const a = cifStructure()?.cell?.a;
  return `<div class="section-label">晶体结构三维查看</div>
  <div class="seg-toggle">
    <button data-action="struct-mode" data-value="cif" class="${s.mode==='cif'?'active':''}">真实 CIF 结构</button>
    <button data-action="struct-mode" data-value="model" class="${s.mode==='model'?'active':''}">教学概念模型</button>
  </div>
  <div class="check-list">
    <label class="check-item ${s.showH?'checked':''}"><input type="checkbox" data-action="struct-opt" data-value="showH" ${s.showH?'checked':''}>显示氢原子<span class="check-meta">球棍模型 · CPK 配色</span></label>
    <label class="check-item ${s.showCell?'checked':''}"><input type="checkbox" data-action="struct-opt" data-value="showCell" ${s.showCell?'checked':''}>显示晶胞边框<span class="check-meta">${a?`a = ${a.toFixed(3)} Å`:'单位胞'}</span></label>
    <label class="check-item ${s.thermal?'checked':''}"><input type="checkbox" data-action="struct-opt" data-value="thermal" ${s.thermal?'checked':''}>原子热振动<span class="check-meta">振幅 ∝ √U<sub>iso</sub></span></label>
  </div>
  ${btn('open-structure','在三维场景中打开晶体结构',true,false,'class="primary-btn wide-btn"')}
  <p class="task-desc">打开结构后单击任意原子，可查看元素、分数坐标、占位率、U<sub>iso</sub> 与近邻键长。</p>`;
}
function pxrdImportUI() {
  const imp = state.pxrdImport;
  return `<div class="section-label">实测 PXRD 数据导入与比对</div>
  <p class="task-desc">支持两列数值（2θ、强度），空格 / 逗号 / 制表符分隔。可直接粘贴仪器导出的 .xy / .txt / .csv 文本，也可选择本地文件。</p>
  <div class="import-row">
    <input type="file" id="pxrdFile" accept=".xy,.txt,.csv,.dat,.asc,text/plain">
    <button class="secondary-btn small-btn" data-action="pxrd-paste">粘贴数据</button>
    ${imp ? btn('pxrd-clear','清除导入',false) : ''}
  </div>
  ${imp ? pxrdComparison() : feedback('info','当前仅显示计算参考谱','衍射谱由内置 CIF 经结构因子计算得到（Cu Kα，λ = 1.5406 Å）；导入实测数据后可自动完成峰位匹配与偏差统计。')}`;
}
function pxrdComparison() {
  const imp = state.pxrdImport;
  if (!imp || !window.Crys || !lab) return '';
  let cmp = null;
  try { const ref = lab.referencePattern(); cmp = ref ? Crys.comparePatterns(imp, ref, 0.35) : null; }
  catch (e) { return feedback('warn','比对失败', e.message || String(e)); }
  if (!cmp) return '';
  const rows = cmp.matches.slice(0, 8).map(m => `<tr><td>${m.measured.toFixed(3)}</td><td>${m.calc.toFixed(3)}</td><td class="${m.delta < 0.15 ? 'metric-good' : ''}">${m.delta.toFixed(3)}</td><td>${m.h} ${m.k} ${m.l}</td><td>${m.d.toFixed(3)}</td></tr>`).join('');
  const rate = cmp.total ? cmp.matched / cmp.total * 100 : 0;
  const verdict = rate >= 80 ? '样品主体晶相与 HKUST-1 参考结构一致' : rate >= 50 ? '存在部分匹配峰，建议检查结晶性与杂相' : '匹配峰较少，可能为无定形产物或不同晶相';
  const md = (cmp.meanDelta === null || cmp.meanDelta === undefined) ? '—' : cmp.meanDelta.toFixed(3) + '°';
  return `<div class="match-wrap"><table class="match-table"><thead><tr><th>实测 2θ</th><th>计算 2θ</th><th>Δ2θ /°</th><th>hkl</th><th>d / Å</th></tr></thead><tbody>${rows || '<tr><td colspan="5">容差 0.35° 内未找到匹配峰</td></tr>'}</tbody></table></div>
  <div class="target-line"><span>峰位匹配率</span><b class="${rate >= 80 ? 'metric-good' : ''}">${rate.toFixed(0)}%（${cmp.matched} / ${cmp.total}）</b></div>
  <div class="concentration">平均偏差 Δ2θ = ${md}　｜　${verdict}</div>`;
}
function pxrdPeakText() {
  const st = cifStructure();
  if (!st || !lab.referencePattern) return '特征峰：6.7° · 9.5° · 11.6° · 13.4°';
  const ref = lab.referencePattern();
  if (!ref) return '特征峰：6.7° · 9.5° · 11.6° · 13.4°';
  // 取相对强度最高的若干个可观测峰（ref.merged 已剔除了系统消光反射）
  const pool = (ref.merged && ref.merged.length ? ref.merged : ref.reflections) || [];
  const seen = pool.filter(r => r.twoTheta <= 26)
    .slice()
    .sort((a, b) => (b.rel === undefined ? b.I : b.rel) - (a.rel === undefined ? a.I : a.rel))
    .slice(0, 5)
    .sort((a, b) => a.twoTheta - b.twoTheta);
  if (!seen.length) return '特征峰：6.7° · 9.5° · 11.6° · 13.4°';
  return 'CIF 计算特征峰（Cu Kα）：' + seen.map(r => `${r.twoTheta.toFixed(2)}° (${r.h}${r.k}${r.l})`).join(' · ');
}
function pxrdPasteDialog() {
  showModal(`<div class="modal-head"><div><h3>粘贴实测 PXRD 数据</h3><p>每行一组：2θ　强度</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><textarea id="pxrdText" class="paste-area" rows="12" placeholder="6.72  1205&#10;9.51  842&#10;11.64  1000&#10;13.43  520"></textarea><div class="button-row"><button class="primary-btn small-btn" id="pxrdConfirm">导入并比对</button><button class="secondary-btn small-btn" data-close>取消</button></div></div>`);
  $('#pxrdConfirm').onclick = () => { const t = $('#pxrdText').value; closeModal(); importPXRD(t); };
}
function importPXRD(text, sourceName) {
  if (!window.Crys) { toast('晶体学引擎未就绪', 'assets/crys.js 未加载，无法解析衍射数据。', 'error'); return; }
  const parsed = Crys.parseXY(text);
  if (!parsed.points.length) { recordError('导入数据为空', '未识别到任何 2θ–强度 数值行。请确认每行包含两个由空格、逗号或制表符分隔的数值。'); return; }
  state.pxrdImport = parsed;
  const p = parsed.points;
  addLog(`导入实测 PXRD 数据${sourceName ? '（' + sourceName + '）' : ''}：${p.length} 个数据点，2θ ${p[0][0].toFixed(2)}°–${p[p.length-1][0].toFixed(2)}°`, 'success');
  renderAll(); setTimeout(drawActiveChart, 30);
}
function readPXRDFile(file) {
  const fr = new FileReader();
  fr.onload = () => importPXRD(String(fr.result || ''), file.name);
  fr.onerror = () => recordError('文件读取失败', `无法读取 ${file.name}，请确认文件可访问后重试。`);
  fr.readAsText(file);
}

function renderCharacterization() {
  const c=state.characterization, tab=state.activeChar;
  const content = tab==='pxrd' ? `<div class="chart-wrap"><canvas id="pxrdCanvas" width="600" height="320"></canvas><div class="chart-legend"><span>模拟样品</span><span>${state.pxrdImport?'导入实测谱':'CIF 计算参考谱'}</span></div></div><div id="peakInfo" class="concentration">${pxrdPeakText()}</div>${cifSummary()}${structureControls()}${pxrdImportUI()}<span class="source-tag">参考谱由内置 CIF 计算 · 样品谱为教学模拟输出</span>` : tab==='bet' ? `<div class="chart-wrap"><canvas id="betCanvas" width="600" height="320"></canvas><div class="chart-legend"><span>N₂ 吸附等温线 · 77 K</span></div></div><div class="data-grid"><div class="data-cell"><small>模拟 BET 比表面积</small><b>${calculateBET()} <em>m²/g</em></b></div><div class="data-cell"><small>等温线类型</small><b>I 型</b></div></div><span class="source-tag">教学模拟数据 · 非实测</span>` : `<canvas id="semCanvas" class="sem-canvas" width="600" height="380"></canvas><div class="target-line"><span>模拟形貌</span><b>蓝色八面体晶体 · 50.0 kx</b></div><span class="source-tag">概念性 SEM 形貌图 · 非真实显微照片</span>`;
  return `<div class="char-tabs">${[['pxrd','PXRD'],['bet','BET 吸附'],['sem','SEM 形貌']].map(([id,n])=>`<button data-action="char-tab" data-value="${id}" class="${tab===id?'active':''}">${n} ${c[id]?'✓':''}</button>`).join('')}</div>${content}${btn('run-char',c[tab]?'重新查看模拟表征':'运行模拟表征',true,false,'class="primary-btn wide-btn"')}${feedback('info','数据来源','参考谱由内置真实 CIF 结构计算；样品谱由本次反应、洗涤和活化参数按确定性规则生成，仅用于教学分析，不得作为真实科研测试数据。')}${btn('finish-char','完成表征并分析数据',true,!(c.pxrd&&c.bet&&c.sem),'class="primary-btn wide-btn"')}`;
}
function calculateQuality() {
  const j=judgeSynthesis();
  if(j.formation==='failed') return 0.06;   // 关键条件严重偏离：仅残余无定形固体，无明显目标晶相
  let q=1;
  q*=Math.exp(-Math.abs(state.reaction.temp-120)/75);
  q*=Math.min(1,state.reaction.time/24)*0.15+0.85;
  if(state.activation.temp>180) q*=0.65;
  q*=0.92+0.08*Math.min(1,(state.washing.water+state.washing.ethanol)/6);
  return q;
}
function calculateBET() {
  const review=judgeSynthesis();
  if(review.metrics)return review.metrics.bet;
  const activationFactor = Math.min(1,state.activation.time/12)*Math.exp(-Math.abs(state.activation.temp-120)/130);
  return Math.round(1520*calculateQuality()*activationFactor);
}
function yieldData() {
  const btcMol=state.weigh.btc.added/REAGENTS.btc.molar, cuMol=state.weigh.cu.added/REAGENTS.cu.molar;
  const moles=Math.min(btcMol/2,cuMol/3), theoretical=moles*604.87;
  const separation=state.separation.done?0.96:0.75, washLoss=1-(state.washing.water*0.004+state.washing.ethanol*0.003);
  const actual=theoretical*0.84*calculateQuality()*separation*washLoss;
  const review=judgeSynthesis();
  if(review.metrics)return {theoretical,actual:theoretical*review.metrics.yieldPercent/100,yield:review.metrics.yieldPercent};
  return {theoretical,actual,yield:theoretical?actual/theoretical*100:0};
}

/* ================= 三层判定引擎 =================
   第一层：逐步操作是否正确（规则判定） → judgeSynthesis().items
   第二层：是否得到目标 MOF（教师预设规则 + 简化反应模拟） → formation
   第三层：学生表现（过程性评价） → scoreData()（见报告） */
function judgeSynthesis() {
  return window.MOFJudge.evaluate(state.opLog || []);
}
function verdictParagraph(j) {
  if(j.formation==='pending')return '实验与后处理证据尚未收齐，当前不作目标材料形成结论。';
  if(j.formation==='failed')return `关键条件失守：${j.failedLabels.join('、')}。系统按教师预设的失败规则判定本次虚拟合成未获得目标晶体，后续表征将显示无明显 HKUST-1 特征峰。可重置当前步骤并在允许范围内修正参数。`;
  if(j.formation==='partial')return `偏差发生在「${j.affectedLabels.join('、')}」。关键条件未失守，模拟仍生成目标晶相，但产率、结晶性与比表面积将按确定性规则下降。`;
  return '最终反应与后处理条件符合教师预设方案，模拟获得目标 Cu-BTC 材料。历史操作偏差与纠正记录详见第一层评审。';
}
/* 第二层判定示例卡（晶体生长完成后展示） */
const JUDGE_GROUPS=[ ['reagent','weigh','反应物选择与称量','均符合教师设定的要求。'], ['solution','feed','assembly','配液与反应体系组装','容器和反应参数符合方案。'], ['reaction','反应条件控制','温度与时间处于允许范围。'] ];
function judgeBadge(status){ return status==='fail'?['fail','未通过','✕']:status==='deviation'?['dev','存在偏差','!']:['pass','通过','✓']; }
function synthesisVerdictCard() {
  const j=judgeSynthesis();
  const rows=JUDGE_GROUPS.map(g=>{
    const keys=g.slice(0,g.length-2), label=g[g.length-2], passText=g[g.length-1];
    const list=j.items.filter(i=>keys.includes(i.key));
    const rank=s=>s==='fail'?3:s==='deviation'?2:1;
    const worst=list.reduce((m,i)=>rank(i.status)>rank(m)?i.status:m,'pass');
    const [cls,txt,icon]=judgeBadge(worst);
    const detail=worst==='pass'?passText:list.flatMap(i=>i.notes).join(' ');
    return `<div class="judge-row"><span class="judge-icon ${cls}">${icon}</span><div class="judge-copy"><b>${label}</b><p>${detail}</p></div><span class="judge-badge ${cls}">${txt}</span></div>`;
  }).join('');
  return `<div class="judgment-card"><div class="judgment-head"><b>虚拟合成判定</b><span>第一层 操作判定 · 教师预设规则</span></div>${rows}<div class="verdict-banner ${j.formation}"><small>模拟结果 · 第二层判定（确定性规则 + 简化反应模拟）</small><b>${j.formationText}</b><p>${verdictParagraph(j)}</p></div></div>`;
}
function productAppearance() {
  const j=judgeSynthesis();
  return j.formation==='failed'?{text:'灰白色无定形固体',color:'#9aa7ab'}:j.formation==='partial'?{text:'蓝色固体 · 结晶性偏低',color:'#3fa7c2'}:{text:'蓝色晶体',color:'#1686a4'};
}
function ruleChip(text){ return `<div class="rule-chip"><b>判定规则</b>${text}</div>`; }
function renderAnalysis() {
  const y=yieldData(), a=state.analysis;
  return `<div class="section-label">产率计算</div><div class="data-grid"><div class="data-cell"><small>理论产量（按限制性试剂）</small><b>${y.theoretical.toFixed(3)} <em>g</em></b></div><div class="data-cell"><small>模拟实际产量</small><b>${y.actual.toFixed(3)} <em>g</em></b></div><div class="data-cell"><small>模拟产率</small><b>${y.yield.toFixed(1)} <em>%</em></b></div><div class="data-cell"><small>模拟 BET</small><b>${calculateBET()} <em>m²/g</em></b></div></div><div class="concentration">产率 = ${y.actual.toFixed(3)} / ${y.theoretical.toFixed(3)} × 100% = ${y.yield.toFixed(1)}%</div>${[
    ['q1','PXRD 特征峰位置与参考基本一致，最合理的结论是？',[['phase','样品具有相同主体晶相'],['size','一定能确定颗粒粒径'],['surface','可直接证明比表面积极高']]],
    ['q2','活化不足最可能如何影响 N₂ 吸附结果？',[['increase','残余溶剂使比表面积升高'],['decrease','孔道堵塞使可接触表面积降低'],['none','对吸附结果没有影响']]],
    ['q3','下列哪项操作最有助于减少产物损失？',[['fast','提高洗涤次数至无限次'],['careful','转移和弃上清时避免带走固体'],['hot','立即高温开启反应釜']]]
  ].map(([q,text,opts])=>`<div class="analysis-question"><p>${text}</p>${opts.map(([v,t])=>`<button class="quiz-option ${a[q]===v?'selected':''}" data-action="answer" data-q="${q}" data-value="${v}">${t}</button>`).join('')}</div>`).join('')}${btn('submit-analysis','提交分析并生成评价',true,!(a.q1&&a.q2&&a.q3),'class="primary-btn wide-btn"')}`;
}
function scoreData() {
  const hints=state.hints.length;
  const weight=e=>(e&&e.severity==='minor')?0.5:1;   // 轻微错误折半计分，需纠正错误全额计分
  const errWeight=state.errors.reduce((s,e)=>s+weight(e),0);
  const safety=Math.max(10,20-state.errors.filter(e=>e.step==='安全准备').length*4);
  const operation=Math.max(12,30-errWeight*1.5);
  const accuracy=Math.max(10,20-state.errors.filter(e=>['试剂称量','溶液配制','晶体生长','真空活化'].includes(e.step)).reduce((s,e)=>s+weight(e),0)*2);
  const analysis=Math.max(8,20-state.errors.filter(e=>e.step==='数据分析').length*4);
  const report=Math.max(6,10-hints*0.25);
  const total=Math.round(safety+operation+accuracy+analysis+report);
  return {safety:Math.round(safety),operation:Math.round(operation),accuracy:Math.round(accuracy),analysis:Math.round(analysis),report:Math.round(report),total};
}
function renderReport() {
  const s=scoreData(), y=yieldData(), j=judgeSynthesis(), ap=productAppearance();
  const vCls=j.formation==='failed'?'error':j.formation==='partial'?'warn':'success';
  const vText=j.formation==='formed'?'关键条件与一般质量条件均符合教师预设方案。':`偏差环节：${[...j.failedLabels,...j.affectedLabels].join('、')||'—'}。详见完整报告的三层评价表。`;
  return `${feedback(vCls,`第二层判定 · ${j.formationText}`,vText)}<div class="score-ring" style="--score:${s.total*3.6}deg"><div><b>${s.total}</b><small>过程性评价 / 100</small></div></div><div class="score-breakdown"><div class="score-line">安全规范 <b>${s.safety}/20</b></div><div class="score-line">操作完整 <b>${s.operation}/30</b></div><div class="score-line">参数准确 <b>${s.accuracy}/20</b></div><div class="score-line">数据分析 <b>${s.analysis}/20</b></div><div class="score-line">报告质量 <b>${s.report}/10</b></div><div class="score-line">错误纠正 <b>${state.errors.length} 次</b></div></div><div class="section-label">实验结论</div><p class="task-desc">获得模拟产物：${ap.text}，产率 ${y.yield.toFixed(1)}%，模拟 BET 比表面积 ${calculateBET()} m²/g。结果仅用于教学分析。</p>${feedback(state.errors.length?'warn':'success',state.errors.length?'复盘建议':'操作评价',state.errors.length?`本次记录 ${state.errors.length} 次不规范操作，均保留在报告中。建议重点复盘错误原因与纠正方法。`:'全流程操作规范，未记录错误。可进一步探究温度和活化条件对结果的影响。')}${btn('open-report','预览完整实验报告',true,false,'class="primary-btn wide-btn"')}<div class="button-row">${btn('print-report','打印 / PDF',false)}${btn('export-json','导出记录',false)}</div>`;
}

function handleAction(action, el) {
  const v=el.dataset.value;
  const actions={
    'protocol':()=>{state.safety.readProtocol=el.checked;renderPanel();save();},
    'reference':showReference,
    'accept-task':()=>completeStep('已接受 Cu-BTC 合成任务，阅读教学方案'),
    'ppe':()=>{toggleArray(state.safety.ppe,v||el.value,el.checked);renderPanel();save();},
    'facility':()=>{toggleArray(state.safety.facilities,v||el.value,el.checked);renderPanel();save();},
    'quiz':()=>{state.safety.quiz=v;renderPanel();save();},
    'check-safety':checkSafety,
    'equipment':()=>{toggleArray(state.equipment,v);renderPanel();save();},
    'check-equipment':checkEquipment,
    'select-reagent':()=>{state.activeReagent=v;lab.updateFromState(state);renderPanel();save();},
    'place-boat':()=>{const w=currentWeigh();w.boat=true;w.tared=false;logOp('place-boat',REAGENTS[state.activeReagent].name);addLog(`放置${REAGENTS[state.activeReagent].name}称量舟`,'info');renderAll();},
    'tare':()=>{currentWeigh().tared=true;logOp('tare','分析天平去皮');addLog('分析天平去皮，扣除称量舟质量','info');renderAll();},
    'add-mass':()=>addMass(Number(v)),
    'remove-mass':()=>{currentWeigh().added=Math.max(0,currentWeigh().added-0.01);renderAll();},
    'confirm-weigh':confirmWeigh,
    'finish-weighing':()=>completeStep('两种试剂称量均在允许容差内'),
    'add-solid':()=>{state.solutions[v].solid=true;logOp(`add-solid:${v}`,v==='A'?'硝酸铜':'H₃BTC');lab.pour(v==='A'?'beakerA':'beakerB');addLog(`将${v==='A'?'硝酸铜':'H₃BTC'}加入溶液 ${v} 烧杯`,'info');renderAll();},
    'add-solvent':()=>addSolvent(v),
    'stir-solution':()=>stirSolution(v),
    'finish-solutions':()=>completeStep('A / B 前驱体溶液配制完成，体积与浓度一致'),
    'transfer-a':()=>{state.assembly.aTransferred=true;logOp('transfer-a','溶液 A → 反应内衬');lab.pour('reactor');addLog('金属盐溶液 A 已转移至反应内衬','info');renderAll();},
    'transfer-b':()=>{state.assembly.bTransferred=true;logOp('transfer-b','溶液 B → 反应内衬');lab.pour('reactor');addLog('配体溶液 B 已加入反应体系','info');renderAll();},
    'mix-reaction':mixReaction,
    'sonicate':sonicate,
    'seal-reactor':()=>{state.assembly.sealed=true;logOp('seal','内衬密封检查完成');addLog('检查内衬填充率 24%，超声后体系均一，反应釜密封完成','success');renderAll();},
    'finish-assembly':()=>completeStep('反应体系组装与密封检查完成'),
    'start-reaction':startReaction,
    'pause-growth':()=>{state.reaction.playing=false;clearInterval(growthTimer);renderPanel();save();},
    'resume-growth':()=>{if(state.reaction.growth<1){state.reaction.playing=true;runGrowth();renderPanel();}},
    'replay-growth':()=>{state.reaction.growth=0;state.reaction.playing=true;state.reaction.cooled=false;runGrowth();renderAll();},
    'show-crystal':()=>{lab.showCrystal(true);$('#crystalViewBtn').classList.add('active');showSceneBanner('Cu₂ 桨轮节点 · BTC 连接体 · 拖动旋转 / 滚轮缩放');},
    'cool-reaction':()=>{state.reaction.cooled=true;addLog('反应釜自然冷却至室温，可安全开启','success');renderAll();},
    'finish-reaction':()=>completeStep('溶剂热反应与晶体生长观察完成'),
    'separate-transfer':()=>{state.separation.transferred=el.checked;renderPanel();save();},
    'balance-tubes':()=>{state.separation.balanced=el.checked;renderPanel();save();},
    'start-centrifuge':startCentrifuge,
    'finish-separation':()=>completeStep('离心分离完成，蓝色固体回收'),
    'wash-water':()=>wash('water'),
    'wash-ethanol':()=>wash('ethanol'),
    'finish-washing':finishWashing,
    'vacuum':()=>{state.activation.vacuum=el.checked;renderPanel();save();},
    'start-activation':startActivation,
    'finish-activation':()=>completeStep('真空活化完成，孔道开放'),
    'char-tab':()=>{state.activeChar=v;renderPanel();save();},
    'struct-mode':()=>{state.structure.mode=v;lab.showStructure(v);addLog(v==='cif'?'切换为真实 CIF 晶体结构视图（可单击原子查看配位信息）':'切换为教学概念结构模型','info');renderPanel();save();},
    'struct-opt':()=>{const key=v;state.structure[key]=el.checked;lab.setStructureOptions({[key]:el.checked});renderPanel();save();},
    'open-structure':()=>{lab.showCrystal(true,state.structure.mode);$('#crystalViewBtn').classList.add('active');showSceneBanner(state.structure.mode==='cif'?'真实 CIF 结构 · Fm-3m · 单击原子查看配位信息':'教学概念模型：蓝色 Cu₂ 节点 · 灰色 BTC 连接体');},
    'pxrd-paste':pxrdPasteDialog,
    'pxrd-clear':()=>{state.pxrdImport=null;addLog('已清除导入的实测 PXRD 数据','info');renderAll();setTimeout(drawActiveChart,30);},
    'run-char':()=>{state.characterization[state.activeChar]=true;addLog(`完成 ${state.activeChar.toUpperCase()} 模拟表征`,'success');lab.runInstrument(state.activeChar);lab.sfx.beep();renderPanel();save();setTimeout(drawActiveChart,30);},
    'finish-char':()=>completeStep('PXRD、BET 与 SEM 模拟表征已完成'),
    'answer':()=>{state.analysis[el.dataset.q]=v;renderPanel();save();},
    'submit-analysis':submitAnalysis,
    'open-report':openReport,
    'print-report':()=>{openReport();setTimeout(()=>window.print(),200);},
    'export-json':exportJSON,
    'hint':()=>hint(Number(el.dataset.level)),
    'reset-current':resetCurrent
  };
  if (actions[action]) { actions[action](); window.MOFJudge?.append(state, 'action:' + action, String(v || '')); save(); }
}
function toggleArray(arr,value,force) { const i=arr.indexOf(value); const should=force===undefined?i<0:force; if(should&&i<0)arr.push(value);if(!should&&i>=0)arr.splice(i,1); }
function currentWeigh(){return state.weigh[state.activeReagent];}
function addMass(amount){if(!Number.isFinite(amount)||amount<=0)return;const w=currentWeigh();if(!w.boat){recordError('缺少称量舟','请先将称量舟放到天平托盘上，再加样。');return;}if(!w.tared){recordError('未去皮直接加样','当前读数包含称量舟质量，属轻微操作偏差，已提醒并留痕；建议去皮后重新核对净质量。','minor');}w.added=Math.round((w.added+amount)*1000)/1000;w.confirmed=false;logOp('add-mass',`+${amount} g（累计 ${w.added.toFixed(3)} g）`);lab.flash('balance');renderAll();}
function confirmWeigh(){const r=REAGENTS[state.activeReagent],w=currentWeigh(),tol=SYNTHESIS_RULES.feeds[state.activeReagent].tol;if(!w.tared){recordError('未执行去皮','当前读数包含称量舟质量。请去皮后重新核对实际加样质量。');return;}const diff=Math.abs(w.added-r.target);if(diff>tol+1e-9){recordError('称量超出容差',`${r.name}目标 ${r.target.toFixed(3)} g，实际 ${w.added.toFixed(3)} g，差值 ${diff.toFixed(3)} g，超出 ±${tol} g 允许偏差。请继续少量加样或移除过量试剂。`);return;}w.confirmed=true;logOp('confirm-weigh',`${r.name} ${w.added.toFixed(3)} g`);addLog(`${r.name}称量合格：${w.added.toFixed(3)} g，相对误差 ${(diff/r.target*100).toFixed(3)}%`,'success');renderAll();}
function checkSafety(){const s=state.safety,missing=[];if(s.ppe.length<3)missing.push('个人防护装备未齐全');if(s.facilities.length<3)missing.push('环境与应急设施检查未完成');if(s.quiz!=='waste')missing.push('含铜废液处置答案不正确');if(missing.length){if(s.quiz&&s.quiz!=='waste')recordError('废液处置不规范','含铜母液属于含重金属化学废液，不能排入下水道或倒回试剂瓶，应分类收集。');else recordError('安全检查未通过',missing.join('；')+'。请逐项完成后重试。');return;}completeStep('个人防护、设施检查和安全知识测试全部通过');}
function checkEquipment(){const missing=REQUIRED_EQUIPMENT.filter(x=>!state.equipment.includes(x)),wrong=['condenser','volumetric'].filter(x=>state.equipment.includes(x));if(missing.length||wrong.length){recordError('器材选择需纠正',`${missing.length?'仍有必需器材未选择':'必需器材齐全'}${wrong.length?'；本方案不需要回流冷凝管或容量瓶，请取消选择':''}。`);return;}addLog('10 项必需器材全部就位','success');completeStep('器材选择与实验流程匹配');}
function addSolvent(k){const s=state.solutions[k],expected=k==='A'?'water':'ethanol';if(!s.solid){recordError('操作顺序错误','请先加入已称量的固体试剂，再加入溶剂。');return;}if(s.solvent!==expected){recordError('溶剂选择错误',`溶液 ${k} 应使用${expected==='water'?'去离子水':'乙醇'}。请根据教学参考方案更换溶剂。`);return;}if(!Number.isFinite(s.volume)||Math.abs(s.volume-3)>0.1+1e-9){recordError('溶剂体积不准确',`目标体积为 3.0 mL，当前为 ${s.volume} mL。请将体积调整至 2.9–3.1 mL。`);return;}s.added=true;logOp(`add-solvent:${k}`,`${Number(s.volume).toFixed(1)} mL ${expected==='water'?'去离子水':'乙醇'}`);lab.pour(k==='A'?'beakerA':'beakerB');addLog(`溶液 ${k} 加入 ${s.volume.toFixed(1)} mL ${expected==='water'?'去离子水':'乙醇'}`,'info');renderAll();}
function stirSolution(k){const s=state.solutions[k];if(!s.added)return;s.stirred=true;logOp('stir',`溶液 ${k} 600 rpm`);lab.dropStirBar(k);lab.stirring=true;lab.flash(k==='A'?'beakerA':'beakerB');addLog(`溶液 ${k} 开始 600 rpm 磁力搅拌`,'info');renderAll();setTimeout(()=>{s.dissolved=true;lab.stirring=false;addLog(`溶液 ${k} 固体溶解，达到均一状态`,'success');renderAll();},1600);}
function mixReaction(){if(!state.assembly.bTransferred)return;lab.stirring=true;logOp('mix','A / B 磁力混合 15 min');addLog('A / B 溶液开始混合，模拟搅拌 15 min','info');setTimeout(()=>{state.assembly.mixed=true;lab.stirring=false;addLog('前驱体混合均匀','success');renderAll();},1600);}
function sonicate(){const a=state.assembly;if(!a.mixed){recordError('尚未完成混合','请先将 A / B 溶液磁力混合均匀，再进行超声分散。');return;}lab.sonicating=true;lab.focus('ultrasonic');logOp('sonicate','40 kHz 超声分散 10 min');addLog('将反应内衬置入超声波分散仪，40 kHz 超声分散 10 min','info');renderAll();setTimeout(()=>{a.sonicated=true;lab.sonicating=false;addLog('超声分散完成，前驱体体系均一、无可见团聚','success');renderAll();},1800);}
function startReaction(){
  const t=Number(state.reaction.temp), time=Number(state.reaction.time), C=SYNTHESIS_RULES.reaction;
  if(!Number.isFinite(t)||!Number.isFinite(time)||t<C.temp.device[0]||t>C.temp.device[1]||time<C.time.device[0]||time>C.time.device[1]){
    recordError('参数超出设备安全范围',`溶剂热反应釜允许 ${C.temp.device[0]}–${C.temp.device[1]} ℃、${C.time.device[0]}–${C.time.device[1]} h。当前 ${t} ℃ / ${time} h 无法启动，请修正参数。`);return;
  }
  const hardOut=t<C.temp.hard[0]||t>C.temp.hard[1]||time<C.time.hard[0]||time>C.time.hard[1];
  const softOut=t<C.temp.soft[0]||t>C.temp.soft[1]||time<C.time.soft[0]||time>C.time.soft[1];
  if(hardOut)recordError('关键条件严重偏离',`教师设定的关键范围为 ${C.temp.hard[0]}–${C.temp.hard[1]} ℃ / ${C.time.hard[0]}–${C.time.hard[1]} h，当前 ${t} ℃ / ${time} h。模拟将按失败规则判定本次结果。`,'minor');
  else if(softOut)recordError('反应条件偏离预设范围',`预设范围为 ${C.temp.soft[0]}–${C.temp.soft[1]} ℃ / ${C.time.soft[0]}–${C.time.soft[1]} h，当前 ${t} ℃ / ${time} h。目标材料仍可形成，但产率与结晶性受影响。`,'minor');
  state.reaction.started=true;state.reaction.playing=true;state.reaction.growth=0;state.reaction.cooled=false;
  logOp('reaction-start',`${t} ℃ / ${time} h`);
  lab.showCrystal(false);lab.focus('reactor');lab.shake(0.055);lab.sfx.clank();   // 反应釜启动：镜头震动 + 金属闷响
  addLog(`溶剂热反应启动：${t} ℃，${time} h，自生压力`,'success');runGrowth();renderAll();
}
function runGrowth(){clearInterval(growthTimer);growthTimer=setInterval(()=>{if(!state.reaction.playing)return;state.reaction.growth=Math.min(1,state.reaction.growth+0.008);lab.setGrowth(state.reaction.growth);const p=Math.round(state.reaction.growth*100);const bar=$('#growthBar');if(bar)bar.style.width=p+'%';const slider=$('#growthSlider');if(slider)slider.value=p;const stage=$('.growth-stage');if(stage){const st=growthStage(state.reaction.growth);stage.innerHTML=`<small>CRYSTAL GROWTH · ${p}%</small><b>${st[0]}</b><p>${st[1]}</p>`;}if(state.reaction.growth>=1){clearInterval(growthTimer);state.reaction.playing=false;const j=judgeSynthesis();if(j.formation==='failed')addLog('晶体生长阶段结束：关键条件严重偏离，模拟判定未获得目标晶体','error');else if(j.formation==='partial')addLog('晶体生长阶段结束：目标材料形成受到影响，详见合成判定','warn');else addLog('晶体生长阶段完成，等待自然冷却','success');renderAll();}},120);}
function startCentrifuge(){
  const s=state.separation, S=SYNTHESIS_RULES.post.separation, rpm=Number(s.rpm), min=Number(s.minutes);
  if(!s.transferred){recordError('产物尚未转移','请先将反应产物转移到离心管。');return;}
  if(!s.balanced){recordError('离心管未配平','高速离心前必须将对称位置离心管配平，防止转子损伤。');return;}
  if(!Number.isFinite(rpm)||!Number.isFinite(min)||rpm<S.rpm.device[0]||rpm>S.rpm.device[1]||min<S.minutes.device[0]||min>S.minutes.device[1]){
    recordError('离心参数超出设备范围',`设备允许 ${S.rpm.device[0]}–${S.rpm.device[1]} rpm、${S.minutes.device[0]}–${S.minutes.device[1]} min。请调整后重试。`);return;
  }
  if(rpm!==S.rpm.target||min!==S.minutes.target)recordError('离心参数偏离方案',`方案预设 ${S.rpm.target} rpm · ${S.minutes.target} min，当前 ${rpm} rpm · ${min} min，分离效果可能受影响。`,'minor');
  logOp('centrifuge-start',`${rpm} rpm / ${min} min`);
  lab.centrifuging=true;lab.shake(0.035);addLog(`离心机启动：${rpm} rpm，${min} min`,'info');   // 高速转子带来的镜头微震
  setTimeout(()=>{s.done=true;lab.centrifuging=false;const ap=productAppearance();addLog(`固液分离完成，${ap.text}与上清液分离`,'success');lab.sfx.beepDone();renderAll();},2300);
}
function wash(type){const w=state.washing;if(w[type]>=3)return;w[type]++;logOp('wash',`${type==='water'?'去离子水':'乙醇'} 第 ${w[type]} 次`);lab.pour('centrifuge');addLog(`${type==='water'?'去离子水':'乙醇'}洗涤第 ${w[type]} 次：重悬、离心、弃上清`,'info');renderAll();}
function finishWashing(){
  const w=state.washing, W=SYNTHESIS_RULES.post.washing;
  if(w.water<3||w.ethanol<3)recordError('洗涤次数少于方案规定',`方案规定水 / 乙醇各 3 次，本次为水 ${w.water} 次、乙醇 ${w.ethanol} 次。允许继续，但将记录「存在偏差」，残余杂质与产物质量受影响。`,'minor');
  completeStep('洗涤纯化完成，样品已收集');
}
function startActivation(){
  const a=state.activation, A=SYNTHESIS_RULES.post.activation;
  if(!a.vacuum){recordError('未开启真空','真空活化需要先启动真空系统并确认真空度稳定。');return;}
  if(!Number.isFinite(a.temp)||!Number.isFinite(a.time)||a.temp<A.temp.device[0]||a.temp>A.temp.device[1]||a.time<A.time.min){recordError('活化参数不合理',`温度应在 ${A.temp.device[0]}–${A.temp.device[1]} ℃，时间不少于 ${A.time.min} h。请检查参数。`);return;}
  if(a.temp>A.temp.damageAbove)recordError('活化温度过高',`超过 ${A.temp.damageAbove} ℃ 将增加框架损伤风险，模拟结构质量将下降。`,'minor');
  else if(a.temp<A.temp.soft[0]||a.temp>A.temp.soft[1]||a.time<A.time.soft[0])recordError('活化条件偏离预设',`预设 ${A.temp.target} ℃ / ${A.time.target} h（${A.temp.soft[0]}–${A.temp.soft[1]} ℃、≥${A.time.soft[0]} h），当前 ${a.temp} ℃ / ${a.time} h，孔道脱除可能不充分。`,'minor');
  logOp('activation-start',`${a.temp} ℃ / ${a.time} h${a.vacuum?' · 真空':''}`);
  lab.activating=true;addLog(`真空活化启动：${a.temp} ℃，${a.time} h`,'info');
  setTimeout(()=>{a.done=true;lab.activating=false;addLog('真空活化完成，孔道溶剂脱除','success');lab.sfx.beepDone();renderAll();},2500);
}
function submitAnalysis(){
  const a=state.analysis,correct={q1:'phase',q2:'decrease',q3:'careful'};
  let wrong=0;
  Object.keys(correct).forEach(k=>{if(a[k]!==correct[k]){wrong++;recordError(`分析问题 ${k.slice(1)} 需复盘`,'结论与表征依据不一致','minor');}});
  a.submitted=true;
  logOp('analysis-submitted',`${3-wrong} / 3 项分析正确`);
  addLog(wrong?`数据分析完成，${wrong} 项结论需复盘`:'三项数据分析全部正确',wrong?'warn':'success');
  state.step=11;completeStep('数据分析与产率计算完成');
}

function drawActiveChart(){if(state.step!==10)return;if(state.activeChar==='pxrd')drawPXRD();else if(state.activeChar==='bet')drawBET();else drawSEM();}
function prepCanvas(canvas){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fbfdfd';ctx.fillRect(0,0,w,h);return{ctx,w,h};}
function drawAxes(ctx,w,h,xlabel,ylabel){ctx.strokeStyle='#dce6e7';ctx.lineWidth=1;ctx.fillStyle='#7a8f95';ctx.font='18px sans-serif';for(let i=1;i<6;i++){const y=35+(h-85)*i/6;ctx.beginPath();ctx.moveTo(48,y);ctx.lineTo(w-20,y);ctx.stroke();}for(let i=1;i<8;i++){const x=48+(w-78)*i/8;ctx.beginPath();ctx.moveTo(x,35);ctx.lineTo(x,h-50);ctx.stroke();}ctx.fillStyle='#526e76';ctx.fillText(xlabel,w-120,h-14);ctx.save();ctx.translate(16,110);ctx.rotate(-Math.PI/2);ctx.fillText(ylabel,0,0);ctx.restore();ctx.beginPath();ctx.moveTo(48,35);ctx.lineTo(48,h-50);ctx.lineTo(w-20,h-50);ctx.strokeStyle='#8ba2a7';ctx.stroke();}
/** 高斯平滑（用于模拟结晶性下降导致的峰展宽） */
function smoothGrid(grid, s) {
  s = Math.max(0.6, s);
  const r = Math.max(1, Math.ceil(s * 2.2)), k = []; let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / s) * (i / s)); k.push(v); sum += v; }
  const out = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    let a = 0;
    for (let j = -r; j <= r; j++) { const idx = Math.min(grid.length - 1, Math.max(0, i + j)); a += grid[idx] * k[j + r]; }
    out[i] = a / sum;
  }
  return out;
}
/** 在衍射谱网格上线性插值取值 */
function gridAt(grid, ref, t) {
  const p = (t - ref.t0) / ref.step;
  if (p < 0 || p > grid.length - 1) return 0;
  const i = Math.floor(p), f = p - i;
  return i + 1 < grid.length ? grid[i] * (1 - f) + grid[i + 1] * f : grid[i];
}
/** 由 CIF 参考谱生成「本次样品谱」：结晶性越低 → 峰越宽、强度越低、本底越高 */
function pxrdCurves() {
  if (!lab || !lab.referencePattern) return null;
  let ref = null;
  try { ref = lab.referencePattern(); } catch (e) { ref = null; }
  if (!ref || !ref.grid || !ref.grid.length) return null;
  const q = calculateQuality();
  const cacheKey = 'sample:' + q.toFixed(4);
  const sample = lab.cachedPattern(cacheKey, () => {
    const sm = smoothGrid(ref.grid, (1 + (1 - q) * 7));
    let mx = 0; for (let i = 0; i < sm.length; i++) if (sm[i] > mx) mx = sm[i];
    const scale = 0.55 + 0.45 * q;
    const out = new Float64Array(sm.length);
    for (let i = 0; i < sm.length; i++) out[i] = (mx ? sm[i] / mx : 0) * scale;
    return out;
  });
  return { ref, sample, q };
}
const FALLBACK_PXRD = [[6.7,1],[9.5,.72],[11.6,.85],[13.4,.44],[14.7,.24],[16.4,.3],[17.5,.48],[19.1,.25],[20.2,.18],[21.7,.22],[23.4,.16],[25.2,.13],[26.7,.11],[29.3,.08],[35.4,.06],[39.5,.05],[43.4,.04],[47.6,.03]];
function drawPXRD(){
  const c=$('#pxrdCanvas'); if(!c) return;
  const {ctx,w,h}=prepCanvas(c);
  drawAxes(ctx,w,h,'2θ (degree)','Intensity (a.u.)');
  const xMap=t=>48+(t-4)/(50-4)*(w-78), base=h-50, amp=h-115;
  function line(fn,color,dash=[],lw=2){
    ctx.beginPath(); ctx.setLineDash(dash);
    for(let i=0;i<=600;i++){const t=4+i/600*46, x=xMap(t), y=base-Math.min(1.15,fn(t))*amp; i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.stroke(); ctx.setLineDash([]);
  }
  const d = pxrdCurves();
  let refFn, sampleFn, refList = [];
  if (d) {
    refFn = t => gridAt(d.ref.grid, d.ref, t);
    sampleFn = t => gridAt(d.sample, d.ref, t) + 0.014 * (1 - d.q) + 0.006 * Math.sin(t * 3.1) + 0.004 * Math.sin(t * 7.7);
    const pool = (d.ref.merged && d.ref.merged.length ? d.ref.merged : d.ref.reflections) || [];
    refList = pool.filter(x => x.twoTheta >= 3 && (x.rel === undefined ? x.I > 0 : x.rel > 0.005));
  } else {
    const q = calculateQuality();
    refFn = t => FALLBACK_PXRD.reduce((s,[p,a])=>s+a*Math.exp(-Math.pow(t-p,2)/.035),0);
    sampleFn = t => FALLBACK_PXRD.reduce((s,[p,a])=>s+a*q*Math.exp(-Math.pow(t-p,2)/(.035+(1-q)*.12)),0)+.015*Math.sin(t*2);
  }
  line(refFn,'#a9bbbe',[6,5],1.6);
  line(sampleFn,'#128895',[],2.2);

  /* 导入的实测谱：按最近邻采样（数据已按 2θ 升序） */
  const imp = state.pxrdImport;
  if (imp && imp.points.length > 1) {
    const pts = imp.points; let mx = 0;
    for (const p of pts) if (p[1] > mx) mx = p[1];
    let j = 0;
    ctx.beginPath();
    for (let i = 0; i <= 600; i++) {
      const t = 4 + i / 600 * 46, x = xMap(t);
      while (j < pts.length - 1 && pts[j + 1][0] < t) j++;
      const bd = Math.abs(pts[j][0] - t);
      const y = base - Math.min(1.15, bd < 0.3 ? (mx ? pts[j][1] / mx : 0) * 0.92 : 0) * amp;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = '#c2622f'; ctx.lineWidth = 1.8; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = '#c2622f'; ctx.font = '15px sans-serif';
    ctx.fillText('导入实测谱', w - 96, 52);
  }

  ctx.fillStyle='#6d858b'; ctx.font='16px monospace';
  [10,20,30,40,50].forEach(t=>ctx.fillText(t,xMap(t)-8,h-28));

  c.onmousemove=e=>{
    const info=$('#peakInfo'); if(!info) return;
    const r=c.getBoundingClientRect(), t=4+(e.clientX-r.left)/r.width*50;
    if (refList.length) {
      let best=null, bd=1e9;
      for (const x of refList) { const dd=Math.abs(x.twoTheta-t); if(dd<bd){bd=dd;best=x;} }
      if (best && bd < 0.6) {
        const rel = best.rel !== undefined ? best.rel : (refList[0].I ? best.I / refList[0].I : 0);
        info.textContent = `特征峰 2θ = ${best.twoTheta.toFixed(2)}°（hkl ${best.h} ${best.k} ${best.l}，d = ${best.d.toFixed(3)} Å）｜ 相对强度 ${(rel*100).toFixed(0)}%`;
        return;
      }
    }
    let nearest=FALLBACK_PXRD.reduce((a,b)=>Math.abs(b[0]-t)<Math.abs(a[0]-t)?b:a);
    if (Math.abs(nearest[0]-t)<1) info.textContent=`特征峰 2θ = ${nearest[0]}° ｜ 相对强度 ${(nearest[1]*100).toFixed(0)}% ｜ 与参考峰位匹配`;
  };
}
function drawBET(){const c=$('#betCanvas');if(!c)return;const{ctx,w,h}=prepCanvas(c);drawAxes(ctx,w,h,'Relative pressure P/P₀','N₂ uptake (cm³/g STP)');const max=560*calculateQuality(),x0=48,y0=h-50,pw=w-78,ph=h-105;ctx.beginPath();for(let i=0;i<=200;i++){const p=i/200,y=max*(1-Math.exp(-9*p))*.86+max*.14*p;const x=x0+p*pw,yy=y0-y/max*ph*.9;i?ctx.lineTo(x,yy):ctx.moveTo(x,yy);}ctx.strokeStyle='#128895';ctx.lineWidth=2.5;ctx.stroke();ctx.fillStyle='#128895';for(let i=1;i<=10;i++){const p=i/10,y=max*(1-Math.exp(-9*p))*.86+max*.14*p;ctx.beginPath();ctx.arc(x0+p*pw,y0-y/max*ph*.9,3,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#6d858b';ctx.font='16px monospace';[0,.2,.4,.6,.8,1].forEach(t=>ctx.fillText(t.toFixed(1),x0+t*pw-8,h-28));}
function drawSEM(){const c=$('#semCanvas');if(!c)return;const{ctx,w,h}=prepCanvas(c);ctx.fillStyle='#152126';ctx.fillRect(0,0,w,h);let seed=42;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const quality=calculateQuality();const failed=quality<0.15;const n=Math.max(4,Math.round(34*(0.25+0.75*quality)));for(let i=0;i<n;i++){const x=35+rand()*(w-70),y=30+rand()*(h-95),s=(failed?6:12)+rand()*(failed?10:33),rot=rand()*Math.PI;ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=.45+rand()*.4;const g=ctx.createLinearGradient(-s,-s,s,s);g.addColorStop(0,'#d5e1df');g.addColorStop(.45,'#71868a');g.addColorStop(1,'#263a40');ctx.fillStyle=g;ctx.strokeStyle='#b8c8c7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.82,0);ctx.lineTo(0,s);ctx.lineTo(-s*.82,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(0,0);ctx.lineTo(s*.82,0);ctx.moveTo(0,0);ctx.lineTo(0,s);ctx.moveTo(0,0);ctx.lineTo(-s*.82,0);ctx.strokeStyle='rgba(230,245,242,.45)';ctx.stroke();ctx.restore();}ctx.globalAlpha=1;ctx.fillStyle='#b4c4c4';ctx.font='15px monospace';if(failed){ctx.fillStyle='#e0a08e';ctx.fillText('未观察到目标晶相特征形貌（无定形颗粒）',20,34);}ctx.fillStyle='#b4c4c4';ctx.fillText('SE  10.0 kV   50.0 kx   Cu-BTC · SIMULATED',20,h-17);ctx.fillStyle='#d6e4e2';ctx.fillRect(w-150,h-35,100,3);ctx.fillText('2 μm',w-145,h-42);}

function showReference(){const R=SYNTHESIS_RULES;showModal(`<div class="modal-head"><div><h3>教学参考方案与数据边界</h3><p>Cu-BTC（HKUST-1）· 溶剂热合成</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><h4>参考配方</h4><table><tr><th>物料</th><th>用量</th><th>用途</th></tr><tr><td>Cu(NO₃)₂·3H₂O</td><td>1.688 g</td><td>金属源</td></tr><tr><td>H₃BTC</td><td>1.050 g</td><td>有机配体</td></tr><tr><td>去离子水 / 乙醇</td><td>各 3.0 mL</td><td>分别配制 A / B</td></tr><tr><td>溶剂热条件</td><td>120 ℃ · 24 h</td><td>自生压力</td></tr><tr><td>后处理</td><td>5000 rpm · 2.5 min；水/醇各洗 3 次</td><td>分离纯化</td></tr><tr><td>活化</td><td>真空 · 120 ℃ · 12 h</td><td>脱除孔道溶剂</td></tr></table><h4>合成结果判定配置（教师预设 · 确定性规则）</h4><table><tr><th>条件类型</th><th>判定项</th><th>允许范围 / 规则</th><th>偏离后果</th></tr><tr><td>关键条件</td><td>试剂与溶剂种类</td><td>与实验方案试剂 ID 匹配</td><td>合成失败</td></tr><tr><td>关键条件</td><td>反应温度 / 时间</td><td>${R.reaction.temp.hard[0]}–${R.reaction.temp.hard[1]} ℃ / ${R.reaction.time.hard[0]}–${R.reaction.time.hard[1]} h</td><td>合成失败或不确定结果</td></tr><tr><td>关键条件</td><td>密封 · 配平 · 真空</td><td>组装密封、离心配平、真空活化</td><td>无法进入下一步 / 失败</td></tr><tr><td>一般质量条件</td><td>反应温度 / 时间</td><td>${R.reaction.temp.soft[0]}–${R.reaction.temp.soft[1]} ℃ / ${R.reaction.time.soft[0]}–${R.reaction.time.soft[1]} h</td><td>产率与结晶性下降</td></tr><tr><td>一般质量条件</td><td>称量容差</td><td>±${R.feeds.cu.tol} g（去皮后净质量）</td><td>判定不通过，需重新称量</td></tr><tr><td>一般质量条件</td><td>离心参数</td><td>${R.post.separation.rpm.target} rpm · ${R.post.separation.minutes.target} min（±5%）</td><td>回收率受影响</td></tr><tr><td>一般质量条件</td><td>洗涤次数</td><td>水 / 乙醇各 3 次（最少各 ${R.post.washing.minEach} 次）</td><td>杂质残留升高，质量下降</td></tr><tr><td>一般质量条件</td><td>活化条件</td><td>${R.post.activation.temp.soft[0]}–${R.post.activation.temp.soft[1]} ℃ / ≥${R.post.activation.time.soft[0]} h；&gt;${R.post.activation.temp.damageAbove} ℃ 框架损伤</td><td>孔道脱除不充分 / 结构受损</td></tr></table><p>判定不采用“所有步骤正确 = 合成成功”的简单逻辑：关键条件严重偏离直接触发失败或不确定结果；一般质量条件偏离仍可获得目标材料，但产率与质量按确定性规则下降。</p><p>${REFERENCE}</p><h4>数据真实性</h4><p>本系统的动画、产率、PXRD、BET 与 SEM 均为教学模型输出。结果可用于学习实验逻辑和参数影响，不可作为真实实验测量或科研结论。</p></div>`);}
function showReagent(id){const r=REAGENTS[id];if(!r){const common={water:['去离子水','H₂O','配制金属盐溶液与水洗','按实验室规范使用。'],ethanol:['乙醇','C₂H₅OH','配体溶解、洗涤与溶剂交换','易燃，远离明火和高温表面。'],dmf:['N,N-二甲基甲酰胺','C₃H₇NO','备选极性溶剂，本教学方案未采用','有毒且具生殖毒性，避免吸入与皮肤接触。']}[id];if(common)showModal(`<div class="modal-head"><div><h3>${common[0]}</h3><p>${common[1]}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><p><b>用途：</b>${common[2]}</p><p><b>安全：</b>${common[3]}</p></div>`);return;}showModal(`<div class="modal-head"><div><h3>${r.name}</h3><p>${r.formula}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><table><tr><th>目标质量</th><td>${r.target.toFixed(3)} g</td></tr><tr><th>摩尔质量</th><td>${r.molar.toFixed(2)} g/mol</td></tr><tr><th>实验用途</th><td>${r.role}</td></tr></table><h4>安全与防护</h4><p>${r.hazard}</p></div>`);}

const DEVICE_INFO = {
  hood:['通风橱','所有涉及有机溶剂、酸碱和粉尘的操作均应在通风橱内进行，保持视窗处于安全高度。'],
  storage:['试剂储存柜','腐蚀品与氧化剂必须分区存放；三水硝酸铜属于氧化剂，应与还原性物质隔离。'],
  flammable:['易燃品安全柜','乙醇等易燃溶剂应存放于专用防火柜，远离热源、明火和氧化剂。'],
  gas:['气体钢瓶架','钢瓶必须用链条固定，搬运时佩戴瓶帽，使用环境保持良好通风。'],
  ultrasonic:['超声波分散仪','利用超声空化作用促进前驱体混合与分散；注意液面高度与定时设置。'],
  phmeter:['pH 计','优化方案中常监控体系 pH；Cu-BTC 的成核与晶相受 pH 影响明显。'],
  desiccator:['真空干燥器','用于活化后样品在干燥环境中冷却与暂存，防止吸湿。'],
  extinguisher:['灭火器','熟悉类型与安放位置，针对化学品火灾选用合适灭火介质。'],
  spillkit:['溢液应急箱','内含吸附棉与中和剂，发生泄漏时按规程处理并记录。'],
  firstaid:['急救箱','处理轻微外伤；严重暴露应立即就医并携带试剂安全信息。'],
  stirrer:['磁力搅拌器','用于加速固体溶解和溶液混合，设定合适转速避免溅出。'],
  balance:['分析天平','精度 0.1 mg；称量前务必去皮，并关闭防风门以稳定读数。']
};
function showDeviceInfo(id){const d=DEVICE_INFO[id];if(!d)return;showModal(`<div class="modal-head"><div><h3>${d[0]}</h3><p>设备说明与安全要点</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><p>${d[1]}</p><h4>使用规范</h4><p>操作前确认设备状态正常，使用后及时清理并记录使用情况。</p></div>`);}
function showModal(html,large=false){$('#modalContent').className=`modal-card${large?' large':''}`;$('#modalContent').innerHTML=html;$('#genericModal').classList.remove('hidden');}
function closeModal(){$('#genericModal').classList.add('hidden');}
function showHelp(){showModal(`<div class="modal-head"><div><h3>实验室操作指南</h3><p>鼠标、步骤导航与实验规则</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><h4>三维场景</h4><p>左键拖动旋转视角，滚轮缩放，右键拖动平移。单击设备打开对应信息，双击设备平滑聚焦。“全景视角”可随时返回实验室。</p><h4>实验流程</h4><p>右侧为当前任务与真实操作面板。只有满足完成条件才能进入下一步；已完成步骤可点击查看历史，但不能篡改记录。错误会说明原因并允许纠正。</p><h4>提示与评价</h4><p>每个步骤提供详细提示和原理说明。查看提示和错误纠正会留痕，评分依据包括安全、完整性、准确性、数据分析和报告。</p><h4>进度保存</h4><p>正常实验模式自动保存在当前浏览器 localStorage。演示模式不计成绩，也不覆盖正式实验记录。</p></div>`);}
function showSettings(){showModal(`<div class="modal-head"><div><h3>系统设置</h3><p>显示性能与当前实验</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="settings-row"><div><b>简化渲染模式</b><small>降低像素比并关闭阴影，适合低性能教学电脑</small></div><button class="switch ${state.settings.lowQuality?'on':''}" id="qualitySwitch"></button></div><div class="settings-row"><div><b>当前步骤重置</b><small>仅重置当前模块的操作状态，历史日志保留</small></div><button class="secondary-btn small-btn" data-action="reset-current">重置</button></div><div class="settings-row"><div><b>参考教学方案</b><small>查看配方、容差和数据真实性声明</small></div><button class="secondary-btn small-btn" id="referenceFromSettings">查看</button></div><div class="settings-row"><div><b>运行环境自检</b><small>查看 WebGL、显卡、帧率与异常记录，用于排查“打不开 / 卡顿”</small></div><button class="secondary-btn small-btn" id="diagBtn">检测</button></div></div>`);$('#qualitySwitch').onclick=()=>{state.settings.lowQuality=!state.settings.lowQuality;applyQuality();showSettings();save();};$('#referenceFromSettings').onclick=showReference;$('#diagBtn').onclick=showDiagnostics;}
function applyQuality(){if(!lab)return;const low=state.settings.lowQuality||lab.autoDegraded;lab.renderer.setPixelRatio(low?1:Math.min(devicePixelRatio||1,lab.pixelCap||1.75));lab.renderer.shadowMap.enabled=!low;lab.resize();}

/** 运行环境自检：把排查“打不开”所需的关键信息集中展示，可一键复制 */
function diagnosticsInfo(){
  const r=lab&&lab.renderer;
  let glVersion='不可用', gpu='不可用';
  try{
    const ctx=r.getContext();
    glVersion=ctx.getParameter(ctx.VERSION)||'未知';
    const ext=ctx.getExtension('WEBGL_debug_renderer_info');
    gpu=ext?ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL):(ctx.getParameter(ctx.RENDERER)||'未知');
  }catch(e){}
  const info=(r&&r.info)?r.info:{};
  return {
    glVersion, gpu,
    size: r?`${r.domElement.width}×${r.domElement.height} @ ${(r.getPixelRatio()||1).toFixed(2)}x`:'—',
    shadow: r?(r.shadowMap.enabled?'开启':'关闭'):'—',
    calls: info.render?info.render.calls:0,
    tris: info.render?info.render.triangles:0,
    programs: info.programs?info.programs.length:0,
    storage: store.ok?'可用':'不可用',
    dpr: window.devicePixelRatio||1,
    ua: navigator.userAgent,
    errors: RUNTIME_LOG.slice()
  };
}
function showDiagnostics(){
  const d=diagnosticsInfo();
  const soft=/swiftshader|software|basic render/i.test(d.gpu);
  const rows=[
    ['WebGL 版本',d.glVersion,d.glVersion==='不可用'?'warn':'ok'],
    ['显卡渲染器',d.gpu,soft?'warn':'ok'],
    ['渲染画布',d.size,''],
    ['阴影贴图',d.shadow,''],
    ['绘制开销',`${d.calls} draw calls · ${d.tris} 三角面 · ${d.programs} 着色器`,''],
    ['本地存储',d.storage,d.storage==='可用'?'ok':'warn'],
    ['设备像素比',String(d.dpr),''],
    ['浏览器',d.ua,'']
  ].map(([k,v,cls])=>`<div class="diag-row ${cls}"><small>${k}</small><b>${v}</b></div>`).join('');
  const errs=d.errors.length?d.errors.map(e=>`[${e.t}]\n${e.title}\n${e.detail}`).join('\n\n'):'（无异常记录）';
  showModal(`<div class="modal-head"><div><h3>运行环境自检</h3><p>排查“进入实验室打不开 / 卡顿”时，请把下方信息提供给指导教师</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="diag-grid">${rows}</div><div class="section-label">运行期异常记录（${d.errors.length}）</div><div class="diag-log" id="diagLog">${errs.replace(/</g,'&lt;')}</div><div class="feedback ${soft||d.storage!=='可用'?'warn':'info'}"><b>判读提示</b>${soft?'当前为软件渲染（SwiftShader），三维会很慢，请在浏览器设置中开启“使用图形加速”，或打开“简化渲染模式”。':'渲染器工作正常。若仍无法进入，请记录上方异常信息。'}${d.storage!=='可用'?' 本地存储不可用：进度无法保存，但不影响实验操作。':''}</div></div><div class="modal-footer"><button class="secondary-btn" data-close>关闭</button><button class="primary-btn" id="diagCopy">复制诊断信息</button></div>`,true);
  $('#diagCopy').onclick=()=>{
    const text=[`MOF Studio 环境自检 ${new Date().toLocaleString('zh-CN')}`,...rows.replace(/<[^>]+>/g,'|').split('|').filter(s=>s.trim()),'',errs].join('\n');
    try{
      const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
      toast('已复制','诊断信息已复制到剪贴板，可直接粘贴给指导教师。','success');
    }catch(e){ toast('复制失败','请手动选中文本后复制。','warn'); }
  };
}
function resetCurrent(){const d=defaultState(),i=state.step;const keys={1:'safety',3:'weigh',4:'solutions',5:'assembly',6:'reaction',7:'separation',8:'washing',9:'activation',10:'characterization',11:'analysis'};if(i===2)state.equipment=[];else if(keys[i])state[keys[i]]=deepCopy(d[keys[i]]);closeModal();addLog(`重置当前步骤「${STEPS[i].title}」`,'info');renderAll();}
function openReport(){if(state.step!==12&&!state.demo){toast('报告尚未解锁','请先完成实验与数据分析。','warn');return;}if(!state.completed.includes(12)){state.completed.push(12);renderNav();}logOp('report-submitted','提交实验报告');const s=scoreData(),y=yieldData(),j=judgeSynthesis(),ap=productAppearance();const errors=state.errors.length?state.errors.map((e,i)=>`<tr><td>${i+1}</td><td>${e.step}</td><td>${e.title}${e.severity==='minor'?'（轻微）':''}</td><td>${e.message}</td></tr>`).join(''):'<tr><td colspan="4">无错误记录，操作规范。</td></tr>';const layer1=j.items.map(i=>`<tr><td>${i.label}</td><td>${i.check}</td><td>${i.method}</td><td class="${i.status==='pass'?'layer-pass':i.status==='deviation'?'layer-dev':'layer-fail'}">${i.status==='pass'?'通过':i.status==='deviation'?'存在偏差':'未通过'}</td></tr>`).join('');const vCls=j.formation==='failed'?'layer-fail':j.formation==='partial'?'layer-dev':'layer-pass';showModal(`<div class="modal-head"><div><h3>实验报告预览</h3><p>由本次真实操作状态自动生成 · ${new Date().toLocaleString('zh-CN')}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body report-sheet"><div class="report-title"><h2>Cu-BTC（HKUST-1）合成与结构表征</h2><p>MOF 材料 3D 虚拟仿真实验报告</p></div><div class="report-section"><h4>一、实验目的与原理</h4><p>掌握金属有机框架材料的基本合成流程，理解 Cu²⁺ 与均苯三甲酸根的配位组装，训练规范称量、配液、溶剂热反应、分离、洗涤、活化及模拟表征分析能力。</p></div><div class="report-section"><h4>二、实际投料与反应条件</h4><table><tr><th>项目</th><th>本次记录</th><th>参考值</th></tr><tr><td>Cu(NO₃)₂·3H₂O</td><td>${state.weigh.cu.added.toFixed(3)} g</td><td>1.688 g</td></tr><tr><td>H₃BTC</td><td>${state.weigh.btc.added.toFixed(3)} g</td><td>1.050 g</td></tr><tr><td>溶液 A / B</td><td>${Number(state.solutions.A.volume).toFixed(1)} mL 水 / ${Number(state.solutions.B.volume).toFixed(1)} mL 乙醇</td><td>各 3.0 mL</td></tr><tr><td>反应条件</td><td>${state.reaction.temp} ℃ · ${state.reaction.time} h</td><td>120 ℃ · 24 h</td></tr><tr><td>分离与洗涤</td><td>${state.separation.rpm} rpm · ${state.separation.minutes} min；水洗 ${state.washing.water} 次、醇洗 ${state.washing.ethanol} 次</td><td>5000 rpm · 2.5 min；各 3 次</td></tr><tr><td>活化条件</td><td>真空 · ${state.activation.temp} ℃ · ${state.activation.time} h</td><td>120 ℃ · 12 h</td></tr></table></div><div class="report-section"><h4>三、模拟结果与产率</h4><p>模拟产物：${ap.text}。理论产量 ${y.theoretical.toFixed(3)} g，模拟实际产量 ${y.actual.toFixed(3)} g，产率 ${y.yield.toFixed(1)}%。模拟 BET 比表面积 ${calculateBET()} m²/g。</p><p><b>产率计算：</b>${y.actual.toFixed(3)} / ${y.theoretical.toFixed(3)} × 100% = ${y.yield.toFixed(1)}%</p></div><div class="report-section"><h4>四、三层评价体系</h4><p><b>第一层 · 操作是否正确（规则判定）：</b></p><table><tr><th>操作环节</th><th>系统检查什么</th><th>判定方式</th><th>结果</th></tr>${layer1}</table><p style="margin-top:10px"><b>第二层 · 是否得到目标 MOF（<span class="${vCls}">${j.formationText}</span>）：</b>${verdictParagraph(j)}</p><p style="margin-top:10px"><b>第三层 · 学生表现（过程性评价）：</b></p><table><tr><th>安全规范</th><th>操作完整</th><th>参数准确</th><th>数据分析</th><th>报告质量</th><th>总分</th></tr><tr><td>${s.safety}/20</td><td>${s.operation}/30</td><td>${s.accuracy}/20</td><td>${s.analysis}/20</td><td>${s.report}/10</td><td><b>${s.total}/100</b></td></tr></table><p style="margin-top:8px">三个层次相互独立：即便获得目标材料也可能存在不规范操作；操作流程完整也不代表目标材料一定形成。轻微错误折半计分，需纠正错误全额计分。</p></div><div class="report-section"><h4>五、错误与纠正记录</h4><table><tr><th>#</th><th>步骤</th><th>问题</th><th>诊断与纠正</th></tr>${errors}</table></div><div class="report-section"><h4>六、结论与复盘</h4><p>本次完成 Cu-BTC 虚拟合成全流程。第二层判定结论为「${j.formationText}」${j.affectedLabels.length||j.failedLabels.length?`，偏差环节：${[...j.failedLabels,...j.affectedLabels].join('、')}`:''}。反应、分离和活化条件共同影响模拟晶相、比表面积与产率。建议结合错误记录复盘关键操作，并在真实实验中通过仪器数据进一步验证。</p></div><div class="report-section"><h4>七、参考方案与真实性声明</h4><p>${REFERENCE}</p><p><b>声明：</b>本报告中的晶体生长、产率、PXRD、BET 和 SEM 均为教学模拟结果，不是原子级动力学计算或真实仪器测量数据。</p></div><div class="report-sign"><div>学生签名 / 日期</div><div>指导教师评语 / 签名</div></div>${window.MOFJudge.reportHTML(j)}</div><div class="modal-footer"><button class="secondary-btn" data-close>关闭</button><button class="primary-btn" data-mof-judge>查看三层评审</button><button class="secondary-btn" id="reportJSON">导出原始记录</button><button class="primary-btn" id="reportPrint">打印 / 导出 PDF</button></div>`,true);$('#reportPrint').onclick=()=>window.print();$('#reportJSON').onclick=exportJSON;addLog('生成完整实验报告与三层过程性评价','success');}
function exportJSON(){const payload={project:'MOF Studio Cu-BTC 虚拟仿真实验',exportedAt:new Date().toISOString(),judgment:judgeSynthesis(),processAssessment:window.MOFJudge.evaluate(state.opLog),score:scoreData(),yield:yieldData(),bet:calculateBET(),state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`MOF实验记录_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('记录已导出','JSON 文件包含本次操作、参数、日志与评价数据。','success');}
function showSceneBanner(text){const b=$('#sceneBanner');b.textContent=text;b.classList.remove('hidden');setTimeout(()=>b.classList.add('hidden'),4200);}

/* ========== 3D 直接操作：在仿真实验室中亲手做实验 ========== */
// handleAction 分发器引用 el.dataset.value，这里构造轻量伪元素
const withV = v => ({ dataset: { value: v } });
const NOEL = { dataset: {} };   // 无需 data-value 的动作统一传它（handleAction 会读 el.dataset）

// 返回 true = 本次 3D 点击已被“直接操作”接管，不再弹出设备信息面板
function handleDeviceAction(id, name) {
  if (!state || state.demo) return false;      // 演示模式保持引导讲解
  if (directActionLock) return true;           // 倾倒/加样动画播放中，忽略重复点击
  let r = false;
  switch (state.step) {
    case 1: r = actSafety(id); break;
    case 2: r = actEquipment(id); break;
    case 3: r = actWeighing(id); break;
    case 4: r = actSolutions(id); break;
    case 5: r = actAssembly(id); break;
    case 6: r = actReaction(id); break;
    case 7: r = actSeparation(id); break;
    case 8: r = actWashing(id); break;
    case 9: r = actActivation(id); break;
    case 10: r = actCharacter(id); break;
    default: return false;
  }
  if (r) lab?.assistantSync?.(id);   // 3D 实验员同步走到该设备旁并做演示手势
  return r;
}

/* ========== 步骤 1 · 安全准备：3D 点击穿戴 PPE / 检查设施 / 确认应急器材 ========== */
const CE = { dataset: {}, checked: true };   // 带勾选状态的伪元素（handleAction 会读 el.dataset 与 el.checked）
const PPE_NAMES = { coat: '实验服', goggle: '护目镜', gloves: '丁腈手套' };
function actSafety(id) {
  const ppe = state.safety.ppe, fac = state.safety.facilities;
  if (id === 'ppeStation') {
    const next = ['coat', 'goggle', 'gloves'].find(x => !ppe.includes(x));
    if (!next) { toast('防护已齐全', '实验服、护目镜与丁腈手套均已穿戴。请在右侧面板完成设施检查与知识测试。', 'info'); return true; }
    ppe.push(next);
    logOp('ppe-wear', PPE_NAMES[next]);
    addLog(`已穿戴${PPE_NAMES[next]}`, 'info');
    lab.flash('ppeStation');
    renderPanel(); save();
    if (ppe.length >= 3) toast('个人防护齐全', '请在右侧面板完成设施检查与含铜废液知识测试。', 'success');
    return true;
  }
  if (id === 'hood') {
    const has = fac.includes('hood');
    toggleArray(fac, 'hood', !has);
    lab.updateFromState(state);              // 同步视窗高度与气流动画
    lab.sfx.whoosh();
    addLog(has ? '取消「通风橱运行正常」勾选' : '检查通风橱：风速与照明正常，视窗降至安全线', has ? 'warn' : 'info');
    renderPanel(); save();
    return true;
  }
  if (id === 'safety' || id === 'waste') {
    const key = id === 'safety' ? 'eyewash' : 'waste';
    const has = fac.includes(key);
    toggleArray(fac, key, !has);
    lab.flash(id);
    addLog(has ? `取消「${key === 'waste' ? '含铜废液桶就位' : '洗眼器可用'}」勾选` : (key === 'waste' ? '确认含铜废液桶就位，分类标签清晰' : '确认洗眼器可用，应急通道无遮挡'), 'info');
    renderPanel(); save();
    return true;
  }
  const infoMap = {
    extinguisher: '灭火器位于实验台西侧，适用于有机溶剂火情，压力表指示正常。',
    spillkit: '溢液应急箱在安全工位旁，内含吸附棉与中和剂，可处理酸碱泄漏。',
    firstaid: '急救箱在洗眼器旁，内含烫伤膏与创可贴，严重情况立即就医。'
  };
  if (infoMap[id]) {
    lab.flash(id);
    toast('应急器材确认', infoMap[id], 'info');
    addLog(`确认${id === 'extinguisher' ? '灭火器' : id === 'spillkit' ? '溢液应急箱' : '急救箱'}位置与状态`, 'info');
    return true;
  }
  return false;
}

/* ========== 步骤 2 · 器材就位：点击 3D 设备把器材加入清单（与面板勾选等效） ========== */
const EQUIP_3D = { balance: 'balance', stirrer: 'stirrer', beakerA: 'beaker', beakerB: 'beaker', reactor: 'reactor', centrifuge: 'centrifuge', oven: 'oven', boatProp: 'boat', spatula: 'spatula', pipette: 'pipette', vial: 'vial' };
const EQUIP_NAMES = { balance: '分析天平', boat: '称量舟', spatula: '药匙', beaker: '烧杯 ×2', pipette: '移液器', stirrer: '磁力搅拌器', reactor: '水热反应釜', centrifuge: '高速离心机', oven: '真空干燥箱', vial: '样品瓶' };
function actEquipment(id) {
  const key = EQUIP_3D[id];
  if (!key) return false;
  if (state.equipment.includes(key)) { toast('已在器材清单中', '该器材已选择。集齐 10 项必需器材后，点击右侧面板按钮提交检查。', 'info'); return true; }
  state.equipment.push(key);
  logOp('select-equipment', key);
  lab.flash(id);
  lab.sfx.glass();
  const missing = REQUIRED_EQUIPMENT.filter(x => !state.equipment.includes(x));
  addLog(`器材就位：${EQUIP_NAMES[key]}（${state.equipment.length}/10）`, 'info');
  renderPanel(); save();
  if (!missing.length) toast('器材齐全', '10 项必需器材全部就位，请点击右侧面板按钮完成器材检查。', 'success');
  else toast(EQUIP_NAMES[key], `已加入器材清单，还缺 ${missing.length} 项。`, 'info', 2600);
  return true;
}

/* 步骤 3 · 称量：点击试剂瓶舀样，点击天平放舟 / 去皮 / 确认称量 */
function actWeighing(id) {
  if (id === 'cu' || id === 'btc') {
    const w = state.weigh[id];
    if (id !== state.activeReagent) { state.activeReagent = id; lab.updateFromState(state); renderPanel(); save(); }
    if (!w.boat) { toast('先放称量舟', '请点击分析天平，把称量舟放到托盘上，再取用' + REAGENTS[id].name + '。', 'warn'); return true; }
    if (w.confirmed) { toast('该试剂已称好', REAGENTS[id].name + ' 已确认 ' + w.added.toFixed(3) + ' g，请称量另一种试剂或点击天平完成本步骤。', 'info'); return true; }
    const target = REAGENTS[id].target;
    // 大份舀样 0.1 g，接近目标时改用刮刀少量补齐到目标质量（模拟真实称量手法）
    const add = w.added < target - 0.12 ? 0.1 : Math.round((target - w.added) * 1000) / 1000;
    if (add <= 0) { toast('已达目标质量', '请点击分析天平确认称量。', 'info'); return true; }
    directActionLock = true;
    lab.pourFromBottle(id, [-3.75, 1.74, 0.45], id === 'cu' ? 'powder-cu' : 'powder-btc', () => {
      directActionLock = false; addMass(add);
      if (Math.abs(currentWeigh().added - REAGENTS[id].target) <= 0.0001) toast('已达目标质量', REAGENTS[id].name + ' 加样至 ' + REAGENTS[id].target.toFixed(3) + ' g，请点击天平确认。', 'success');
    });
    return true;
  }
  if (id === 'balance') { balanceAdvance(); return true; }
  return false;
}
// 天平状态机：放舟 → 去皮 → 确认称量 → 完成步骤
function balanceAdvance() {
  const w = currentWeigh(), r = REAGENTS[state.activeReagent];
  if (!w.boat) { w.boat = true; w.tared = false; logOp('place-boat', r.name); addLog(`将${r.name}称量舟放上分析天平托盘`, 'info'); lab.flash('balance'); renderAll(); return; }
  if (!w.tared) { lab.sfx.balanceClick(); handleAction('tare', NOEL); return; }
  if (!w.confirmed) { lab.sfx.balanceClick(); handleAction('confirm-weigh', NOEL); return; }
  if (state.weigh.cu.confirmed && state.weigh.btc.confirmed) { handleAction('finish-weighing', NOEL); return; }
  toast('继续称量', state.weigh.cu.confirmed ? '硝酸铜已称好，请点击 H₃BTC 试剂瓶（白瓶蓝盖）加样。' : '请点击三水硝酸铜试剂瓶（蓝瓶红盖）加样。', 'info');
}

/* 步骤 4 · 配液：点击瓶加固体/溶剂，点击烧杯/搅拌器搅拌并完成 */
function actSolutions(id) {
  const solidMap = { cu: 'A', btc: 'B' }, liquidMap = { water: 'A', ethanol: 'B' };
  const beakerPos = k => k === 'A' ? [-1.35, 1.72, 0.45] : [0.05, 1.72, 0.45];
  if (solidMap[id]) {
    const k = solidMap[id], s = state.solutions[k];
    if (s.solid) { toast('固体已加入', `溶液 ${k} 烧杯中已加入固体试剂。`, 'info'); return true; }
    directActionLock = true;
    lab.pourFromBottle(id, beakerPos(k), id === 'cu' ? 'powder-cu' : 'powder-btc',
      () => { directActionLock = false; handleAction('add-solid', withV(k)); });
    return true;
  }
  if (liquidMap[id]) {
    const k = liquidMap[id], s = state.solutions[k], expected = k === 'A' ? 'water' : 'ethanol';
    if (!s.solid) { toast('先加固体', `请先点击${k === 'A' ? '硝酸铜' : 'H₃BTC'}试剂瓶，把固体加入溶液 ${k} 烧杯。`, 'warn'); return true; }
    if (id !== expected) { recordError('溶剂选择错误', `溶液 ${k} 应使用${expected === 'water' ? '去离子水' : '乙醇'}。`); return true; }
    directActionLock = true;
    lab.pourFromBottle(id, beakerPos(k), 'liquid', () => { directActionLock = false; handleAction('add-solvent', withV(k)); }, k);
    return true;
  }
  if (id === 'beakerA' || id === 'beakerB' || id === 'stirrer') {
    const k = id === 'beakerB' ? 'B' : (id === 'beakerA' ? 'A' : (state.solutions.A.stirred ? 'B' : 'A'));
    const s = state.solutions[k];
    if (!s.added) { toast('烧杯还是空的', `请先向溶液 ${k} 烧杯加入固体与溶剂。`, 'info'); return true; }
    if (!s.stirred) { handleAction('stir-solution', withV(k)); return true; }
    if (state.solutions.A.dissolved && state.solutions.B.dissolved) { handleAction('finish-solutions', NOEL); return true; }
    toast('继续配液', `溶液 ${k} 已搅拌，请把另一杯同样配好。`, 'info');
    return true;
  }
  if (id === 'phmeter') {
    const ready = ['A', 'B'].filter(x => state.solutions[x].added);
    if (!ready.length) { toast('还没有可测的溶液', '请先向烧杯加入固体与溶剂，再用 pH 计测量。', 'info'); return true; }
    const k = ready[0];
    const ph = k === 'A' ? 1.2 : 3.4;
    lab.sfx.scan();
    lab.flash('phmeter');
    logOp('ph-check', `溶液 ${k} pH ≈ ${ph}`);
    addLog(`pH 计读数：溶液 ${k} pH ≈ ${ph}（${k === 'A' ? 'Cu²⁺ 水溶液因水解偏酸性' : 'H₃BTC 乙醇体系弱酸性'}）`, 'info');
    toast(`溶液 ${k} pH ≈ ${ph}`, k === 'A' ? '铜盐水溶液因金属离子水解呈酸性。' : '均苯三甲酸部分解离，呈弱酸性。', 'info', 5200);
    return true;
  }
  return false;
}

/* 步骤 5 · 组装：点击烧杯倒入内衬，搅拌器混合，超声分散，反应釜密封 */
function actAssembly(id) {
  if (id === 'beakerA' || id === 'beakerB') {
    const k = id === 'beakerA' ? 'A' : 'B';
    if (!state.solutions[k].dissolved) { toast('溶液未就绪', `溶液 ${k} 尚未配制完成，请先完成配液步骤。`, 'warn'); return true; }
    if (k === 'A' ? state.assembly.aTransferred : state.assembly.bTransferred) { toast('已经转移', `溶液 ${k} 已加入反应内衬。`, 'info'); return true; }
    directActionLock = true;
    lab.stream(id === 'beakerA' ? [-1.35, 1.85, 0.45] : [0.05, 1.85, 0.45], [1.65, 1.9, -0.15], 0x2277cc, 0.6,
      () => { directActionLock = false; handleAction('transfer-' + k.toLowerCase(), null); });
    return true;
  }
  if (id === 'stirrer') {
    if (state.assembly.mixed) toast('混合已完成', '前驱体已混合均匀，请进行超声分散或密封反应釜。', 'info');
    else if (state.assembly.bTransferred) handleAction('mix-reaction', NOEL);
    else toast('请先转移', '请先点击烧杯 A / B，把溶液倒入反应内衬。', 'info');
    return true;
  }
  if (id === 'ultrasonic') {
    if (state.assembly.sonicated) toast('超声已完成', '前驱体体系均一，请点击反应釜完成密封。', 'info');
    else if (state.assembly.mixed) handleAction('sonicate', NOEL);
    else toast('请先混合', '请先完成磁力混合（点击磁力搅拌器）。', 'info');
    return true;
  }
  if (id === 'reactor') {
    if (!state.assembly.sealed) {
      if (!state.assembly.sonicated) { toast('先超声分散', '请先点击超声波分散仪完成前驱体分散，再密封反应釜。', 'warn'); return true; }
      directActionLock = true;
      lab.screwLid(() => { directActionLock = false; handleAction('seal-reactor', NOEL); lab.flash('reactor'); });
      return true;
    }
    handleAction('finish-assembly', NOEL);
    return true;
  }
  return false;
}

/* 步骤 6 · 反应：点击反应釜 = 启动 → 暂停/继续 → 冷却 → 完成 */
function actReaction(id) {
  if (id !== 'reactor') return false;
  const r = state.reaction;
  if (!r.started) { handleAction('start-reaction', NOEL); return true; }
  if (r.playing) { handleAction('pause-growth', NOEL); toast('生长暂停', '晶体生长演示已暂停，再次点击反应釜可继续。', 'info'); return true; }
  if (r.growth < 1) { handleAction('resume-growth', NOEL); return true; }
  if (!r.cooled) { handleAction('cool-reaction', NOEL); lab.flash('reactor'); return true; }
  handleAction('finish-reaction', NOEL);
  return true;
}

/* 步骤 7 · 分离：转移装管 → 补管配平 → 启动离心 → 弃上清 → 完成 */
function actSeparation(id) {
  if (id === 'reactor') { toast('反应已结束', '反应釜已冷却，请点击高速离心机回收产物。', 'info'); return true; }
  if (id !== 'centrifuge') return false;
  const s = state.separation;
  if (!s.transferred) {
    directActionLock = true;
    lab.stream([1.65, 1.9, -0.15], [3.55, 1.75, 0.55], 0x2277cc, 0.6, () => {
      lab.loadTubes(4);                      // 4 支离心管落入转子（其中 4 支带蓝色产物）
      handleAction('separate-transfer', CE);
      addLog('反应产物转移至离心管（4 支对称放置）', 'info');
      directActionLock = false;
    });
    return true;
  }
  if (!s.balanced) {
    lab.loadTubes(8);                        // 补入 4 支空白管，8 支对称完成配平（转子轻微晃动）
    handleAction('balance-tubes', CE);
    addLog('补入 4 支空白管，对称位置完成配平', 'info');
    toast('配平完成', '8 支离心管对称放置，再次点击离心机启动分离。', 'info');
    return true;
  }
  if (!s.done) { handleAction('start-centrifuge', NOEL); return true; }
  lab.pourOutTubes();                        // 弃上清：管内液体逐支排空 + 废液流
  setTimeout(() => handleAction('finish-separation', NOEL), 1300);
  return true;
}

/* 步骤 8 · 洗涤：点击试剂瓶洗涤，点击离心机完成 */
function actWashing(id) {
  if (id !== 'water' && id !== 'ethanol' && id !== 'centrifuge') return false;
  const w = state.washing;
  if (id === 'centrifuge') {
    if (w.water >= 3 && w.ethanol >= 3) handleAction('finish-washing', NOEL);
    else toast('洗涤未完成', `还需洗涤：去离子水 ×${3 - w.water}、乙醇 ×${3 - w.ethanol}，请点击相应试剂瓶。`, 'warn');
    return true;
  }
  if (w[id] >= 3) { toast('该溶剂已完成', '请用另一种溶剂继续洗涤，或点击离心机完成本步骤。', 'info'); return true; }
  directActionLock = true;
  lab.pourFromBottle(id, [3.55, 1.78, 0.55], 'liquid', () => { directActionLock = false; handleAction('wash-' + id, null); });
  return true;
}

/* 步骤 9 · 活化：放入样品瓶 → 关门抽真空 → 启动活化 → 完成 */
function actActivation(id) {
  if (id !== 'oven') return false;
  const a = state.activation;
  if (!a.vialPlaced) {
    lab.ovenOpen = true;
    lab.placeOvenVial();                     // 样品瓶落入箱内的动画与音效
    a.vialPlaced = true;
    logOp('load-oven', '盛产物样品瓶放入真空干燥箱');
    addLog('将盛有干燥产物的样品瓶放入真空干燥箱', 'info');
    renderPanel(); save();
    return true;
  }
  if (!a.vacuum) {
    lab.ovenOpen = false; lab.sfx.door();    // 关闭箱门
    handleAction('vacuum', CE);
    lab.updateFromState(state);              // 同步真空表读数与真空泵音效
    addLog('关闭箱门，真空系统启动，真空度稳定', 'info');
    return true;
  }
  if (!a.done) { handleAction('start-activation', NOEL); return true; }
  handleAction('finish-activation', NOEL);
  return true;
}

/* 步骤 10 · 表征：点击工作站，样品经传输管线送入对应仪器并采集模拟数据 */
function actCharacter(id) {
  if (!['pxrd', 'bet', 'sem'].includes(id)) return false;
  if (state.characterization[id]) { toast('表征已完成', `${id.toUpperCase()} 数据已采集，可在右侧面板查看。`, 'info'); return true; }
  state.activeChar = id; renderPanel();
  const dev = lab.devices && lab.devices.get(id);
  const p = dev && dev.group ? dev.group.position : { x: 0, z: -5.3 };
  lab.sfx.scan();
  directActionLock = true;
  lab.stream([5.25, 1.75, -4.9], [p.x, 1.95, p.z], 0xbfe3ea, 0.55, () => {
    directActionLock = false;
    handleAction('run-char', NOEL);
  });
  return true;
}

// 每步动态悬浮提示：鼠标悬停设备即可看到“现在能对它做什么”
function updateActionHints() {
  if (!lab || !lab.applyHints) return;
  if (state.demo) { lab.applyHints({}); return; }
  const H = {
    1: { ppeStation: '点击依次穿上实验服 / 护目镜 / 丁腈手套', hood: '点击通风橱：检查风速并降下视窗', safety: '点击洗眼器确认可用', waste: '点击废液桶确认分类回收就位', extinguisher: '点击确认灭火器位置', spillkit: '点击确认溢液应急箱', firstaid: '点击确认急救箱' },
    2: { boatProp: '点击把称量舟加入器材清单', spatula: '点击把药匙加入器材清单', pipette: '点击把移液器加入器材清单', beakerA: '点击把烧杯加入器材清单', beakerB: '点击把烧杯加入器材清单', stirrer: '点击把磁力搅拌器加入清单', balance: '点击把分析天平加入清单', reactor: '点击把水热反应釜加入清单', centrifuge: '点击把离心机加入清单', oven: '点击把真空干燥箱加入清单', vial: '点击把样品瓶加入清单' },
    3: { cu: '点击舀取硝酸铜加到称量舟', btc: '点击舀取 H₃BTC 加到称量舟', balance: '点击天平：放舟 / 去皮 / 确认称量' },
    4: { cu: '点击把固体加入溶液 A 烧杯', btc: '点击把固体加入溶液 B 烧杯', water: '点击向溶液 A 倒入去离子水', ethanol: '点击向溶液 B 倒入乙醇', beakerA: '点击烧杯 A：放入搅拌子搅拌 / 完成步骤', beakerB: '点击烧杯 B：放入搅拌子搅拌 / 完成步骤', stirrer: '点击搅拌未搅拌的溶液', phmeter: '点击 pH 计测量溶液酸度' },
    5: { beakerA: '点击把溶液 A 倒入反应内衬', beakerB: '点击把溶液 B 倒入反应内衬', stirrer: '点击磁力混合 A / B 溶液', ultrasonic: '点击超声分散前驱体', reactor: '点击反应釜：拧紧密封 / 完成组装' },
    6: { reactor: '点击反应釜：启动 / 暂停 / 冷却 / 完成反应' },
    7: { centrifuge: '点击离心机：转移装管 / 补管配平 / 启动 / 弃上清完成', reactor: '反应已结束，请使用离心机' },
    8: { water: '点击用去离子水洗涤（共 3 次）', ethanol: '点击用乙醇洗涤（共 3 次）', centrifuge: '洗涤齐全后点击完成' },
    9: { oven: '点击干燥箱：放入样品瓶 / 关门抽真空 / 启动活化 / 完成' },
    10: { pxrd: '点击工作站立即采集 PXRD 谱图', bet: '点击工作站立即进行 BET 测试', sem: '点击工作站立即进行 SEM 成像' }
  }[state.step] || {};
  lab.applyHints(H);
}

function handleDevice(id,name){
  const reagentIds=['cu','btc','water','ethanol','dmf'];
  if(reagentIds.includes(id)){showReagent(id);return;}
  const charMap={pxrd:'pxrd',bet:'bet',sem:'sem'};
  if(charMap[id]){
    if(state.step===10||state.demo){
      if(state.step!==10){state.step=10;renderAll();}
      state.activeChar=id;renderPanel();lab.focus(id);
    }else toast('表征工作站','完成合成与活化后，可在这里进行 PXRD、BET 和 SEM 分析。','info');
    return;
  }
  if(DEVICE_INFO[id]){lab.focus(id);showDeviceInfo(id);return;}
  const expected={1:'safety',3:'balance',4:'beakerA',5:'reactor',6:'reactor',7:'centrifuge',8:'centrifuge',9:'oven'};
  lab.focus(id);
  if(expected[state.step]===id)toast(name,'设备已聚焦，请在右侧面板完成当前操作。','info');
  else toast(name,'可双击设备聚焦。当前步骤请按照右侧任务指引操作。','info',2500);
}
function resetExperiment(){if(!confirm('确定重新开始实验吗？当前正式实验记录将被清除。'))return;clearInterval(growthTimer);store.remove(STORAGE_KEY);sessionActive=false;state=defaultState();lab.overview();addLog('开始新的 Cu-BTC 合成实验','info');renderAll(true);$('#introModal').classList.remove('hidden');$('#resumeBtn').classList.add('hidden');}
function startExperiment(resume=false,demo=false){
  sessionActive = true;
  try {
    if(!lab){ showErrorBar('三维场景未就绪','渲染器尚未初始化完成。请刷新页面；若反复出现，请在“设置 → 运行环境自检”中查看原因。'); toast('三维场景未就绪','请刷新页面后重试，或检查浏览器是否已开启图形加速。','error',6000); return; }
    clearInterval(growthTimer);
    if(demo){state=defaultState();state.demo=true;state.step=6;state.completed=[0,1,2,3,4,5];state.safety.readProtocol=true;state.equipment=deepCopy(REQUIRED_EQUIPMENT);Object.keys(state.weigh).forEach(k=>{state.weigh[k]={boat:true,tared:true,added:REAGENTS[k].target,confirmed:true};});['A','B'].forEach(k=>state.solutions[k]={solid:true,solvent:k==='A'?'water':'ethanol',volume:3,added:true,stirred:true,dissolved:true});state.assembly={aTransferred:true,bTransferred:true,mixed:true,sealed:true};state.reaction={temp:120,time:24,started:true,growth:.58,playing:false,cooled:false};state.logs=[{time:nowTime(),step:'系统',message:'竞赛演示模式已载入，演示记录不计入成绩',type:'info'}];$('#demoWatermark').classList.remove('hidden');setTimeout(()=>lab.showCrystal(true),600);}
    else{
      if(resume){
        const saved=loadSaved();
        if(saved&&saved.startedAt){
          state=saved;
          toast('进度已恢复',`继续「${STEPS[state.step].title}」，历史操作记录完整保留。`,'success');
        }
      }
      else{state=defaultState();addLog('进入虚拟实验室，等待接受实验任务','info');}
      $('#demoWatermark').classList.add('hidden');
    }
    $('#introModal').classList.add('hidden');renderAll(!demo);applyQuality();
    // 环境底噪 + 3D 实验员开场：气泡自我介绍并走向当前工位（在用户手势内启动音频，符合浏览器策略）
    lab.sfx.ambientStart();
    lab.assistantSay('同学好，我是实验助手，同步陪你完成实验', 6);
    lab.assistantGoToStep(state.step, STEPS[state.step]?.title);
    // 进入后立即落盘：即使页面被意外刷新（GPU 崩溃 / 浏览器回收标签页），也能用“恢复进度”接上
    if(!demo)save();
  } catch(err){
    console.error('[MOF Studio] 进入实验室失败', err);
    showErrorBar('进入实验室失败', err && err.message ? err.message : String(err));
    toast('进入实验室失败','已记录错误详情，可按 F12 打开控制台查看，或点击设置中的“运行环境自检”。','error',6000);
    $('#introModal').classList.remove('hidden');
  }
}

function bindUI(){
  $('#taskPanel').addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el&&!el.disabled&&el.tagName!=='INPUT'&&el.tagName!=='SELECT'){if(lab&&lab.sfx)lab.sfx.tap();handleAction(el.dataset.action,el);}});
  $('#taskPanel').addEventListener('change',e=>{const el=e.target.closest('[data-action]');if(el){handleAction(el.dataset.action,el);return;}const input=e.target.closest('[data-field]');if(input){const path=input.dataset.field.split('.');let obj=state;for(let i=0;i<path.length-1;i++)obj=obj[path[i]];obj[path.at(-1)]=input.type==='number'?Number(input.value):input.value;addLog(`设置 ${input.previousElementSibling?.textContent||path.at(-1)} = ${input.value}`,'info');renderAll();}});
  $('#taskPanel').addEventListener('change',e=>{if(e.target.id==='pxrdFile'){const f=e.target.files&&e.target.files[0];if(f)readPXRDFile(f);}});
  $('#taskPanel').addEventListener('input',e=>{if(e.target.id==='growthSlider'){state.reaction.growth=Number(e.target.value)/100;state.reaction.playing=false;clearInterval(growthTimer);lab.setGrowth(state.reaction.growth);renderPanel();save();}});
  $('#stepNav').addEventListener('click',e=>{const el=e.target.closest('[data-step]');if(!el)return;const i=Number(el.dataset.step);if(i===state.step)return;if(state.demo){state.step=i;lab.overview();renderAll(true);return;}if(state.completed.includes(i)){showModal(`<div class="modal-head"><div><h3>${STEPS[i].title} · 已完成记录</h3><p>历史步骤只读，不可篡改</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><p>${STEPS[i].objective}</p><h4>相关操作日志</h4>${state.logs.filter(l=>l.step===STEPS[i].title).slice(0,12).map(l=>`<p>${l.time}　${l.message}</p>`).join('')||'<p>本步骤无异常记录，操作已完成。</p>'}</div>`);}else toast('步骤尚未解锁','请按实验流程完成当前步骤，不能越级进入后续操作。','warn');});
  $('#genericModal').addEventListener('click',e=>{if(e.target===$('#genericModal')||e.target.closest('[data-close]'))closeModal();});
  // 入口按钮用事件委托绑定：即使后续代码覆盖了元素的 onclick，也依然可以进入实验室
  $('#introModal').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'startBtn') startExperiment(false);
    else if (b.id === 'demoBtn') startExperiment(false, true);
    else if (b.id === 'resumeBtn') startExperiment(true);
  });
  $('#helpBtn').onclick=showHelp;$('#settingsBtn').onclick=showSettings;$('#resetBtn').onclick=resetExperiment;
  $('#overviewBtn').onclick=()=>{lab.overview();$('#crystalViewBtn').classList.remove('active');};$('#focusBtn').onclick=()=>lab.focusForStep(state.step);
  $('#crystalViewBtn').onclick=()=>{if(lab.crystalMode){lab.overview();$('#crystalViewBtn').classList.remove('active');}else{const m=state.structure.mode;lab.showCrystal(true,m);$('#crystalViewBtn').classList.add('active');showSceneBanner(m==='cif'?'真实 CIF 结构 · Fm-3m · 单击原子查看配位信息':'教学结构模型：蓝色 Cu₂ 节点 · 灰色 BTC 连接体 · 拖动旋转查看');}};
  $('#fullscreenBtn').onclick=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();};
  $('#assistantBtn').onclick=()=>{const on=lab.toggleAssistant();$('#assistantBtn').classList.toggle('active',on);addLog(on?'3D 实验助手已上线：将同步演示并引导各步骤操作':'3D 实验助手已隐藏','info');if(on)lab.assistantGreet();};
  $('#leftToggle').onclick=()=>{$('#sidebar').classList.toggle('collapsed');$('#leftToggle').textContent=$('#sidebar').classList.contains('collapsed')?'›':'‹';setTimeout(()=>lab.resize(),350);};
  $('#rightToggle').onclick=()=>{$('#inspector').classList.toggle('collapsed');$('#rightToggle').textContent=$('#inspector').classList.contains('collapsed')?'‹':'›';setTimeout(()=>lab.resize(),350);};
  $('#logToggle').onclick=()=>{$('#console').classList.toggle('collapsed');$('#logToggle').textContent=$('#console').classList.contains('collapsed')?'展开':'收起';};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();if(lab?.crystalMode){lab.overview();$('#crystalViewBtn').classList.remove('active');}}});
}

function init(){
  const phases=[['初始化三维渲染器',18],['生成实验室设备',42],['解析 CIF 并计算衍射谱',68],['载入实验状态机',86],['准备就绪',100]];
  let p=0, revealed=false;
  const revealApp=()=>{
    if(revealed)return; revealed=true;
    $('#loading').style.opacity='0';
    setTimeout(()=>{$('#loading').classList.add('hidden');$('#app').classList.remove('hidden');$('#introModal').classList.remove('hidden');if(lab)lab.resize();},600);
  };
  const load=setInterval(()=>{
    const ph=phases[Math.min(p,phases.length-1)];
    $('#loadingText').textContent=ph[0];$('#loadingBar').style.width=ph[1]+'%';p++;
    if(p>=phases.length){clearInterval(load);setTimeout(revealApp,300);}
  },240);
  // 看门狗：若 12 秒仍未进入界面，说明初始化卡住，直接给出可操作的提示而不是一直转圈
  setTimeout(()=>{ if(!revealed&&!$('#loading').classList.contains('hidden')) showErrorBar('实验室加载超时','初始化耗时异常，可尝试刷新页面或在设置中开启“简化渲染模式”。'); },12000);
  try{lab=new VirtualLab($('#scene'),{onSelect:handleDevice,onDeviceAction:handleDeviceAction,onCrystalInfo:t=>showSceneBanner(t),onFPS:f=>$('#fpsLabel').textContent=`${f} FPS`,
    onContextLost:()=>{ addLog('检测到显卡渲染上下文中断，已暂停渲染并尝试自动恢复','error'); showErrorBar('显卡渲染上下文中断','已暂停三维渲染，浏览器恢复后会自动降级继续运行；如长时间无画面请刷新页面。'); },
    onContextRestored:()=>{ addLog('显卡渲染上下文已恢复，已切换到简化渲染模式','success'); toast('渲染已恢复','为保证稳定，已自动切换为简化渲染模式。','info'); },
    onAutoDegrade:fps=>{ addLog(`帧率偏低（${fps} FPS），已自动切换简化渲染模式`,'warn'); } ,
    onStructureLoad:st=>{
      addLog(`载入内置 CIF 晶体结构：${st.meta?.name||st.name}，${st.spaceGroup}，a = ${st.cell.a.toFixed(3)} Å，V = ${st.volume.toFixed(1)} Å³，${st.atoms.length} 原子/晶胞`,'success');
      setTimeout(()=>{ if(lab) lab.setStructureOptions(state.structure); },0);
    },
    onStructureError:msg=>addLog(`CIF 结构载入失败：${msg}`,'error'),
    onAtomInfo:info=>{
      const nb=info.neighbors.map(n=>`${Crys.elementInfo(n.el).symbol} ${n.d.toFixed(3)} Å（${n.kind==='coord'?'配位键':'共价键'}）`).join('，');
      addLog(`原子 ${info.label}（${info.name}）：分数坐标 (${info.frac.map(x=>x.toFixed(3)).join(', ')})，占位率 ${info.occ.toFixed(2)}，U_iso ${info.u.toFixed(4)}；近邻：${nb||'无'}`,'info');
      showSceneBanner(`${info.label} · ${info.name}　占位率 ${info.occ.toFixed(2)}　U_iso ${info.u.toFixed(4)}　近邻：${nb||'—'}`);
    },
  onHover:d=>{const tip=$('#objectTooltip');if(!d){tip.classList.add('hidden');return;}const rect=$('#stage').getBoundingClientRect();tip.style.left=(d.x-rect.left)+'px';tip.style.top=(d.y-rect.top)+'px';tip.innerHTML=`<b>${d.name}</b><span>${d.hint}</span>`;tip.classList.remove('hidden');}});}
  catch(e){
    clearInterval(load);
    console.error('[MOF Studio] 三维渲染器初始化失败', e);
    const txt=$('#loadingText');
    if(txt) txt.innerHTML='三维渲染器初始化失败：'+(e&&e.message?e.message:'未知错误')+'<br><br>请使用最新版 Chrome / Edge，并在浏览器设置中开启“使用图形加速”。';
    const bar=$('#loadingBar');
    if(bar){bar.style.width='100%';bar.style.background='linear-gradient(90deg,#ff8a6c,#ff5c5c)';}
    showErrorBar('三维渲染器初始化失败', e&&e.message?e.message:String(e));
    return;
  }
  window.__lab = lab;   // 调试 / 演示用句柄
  window.__direct = { handleDeviceAction, updateActionHints, state: () => state };   // 3D 直接操作调试句柄
  // 预热：在加载动画期间预先计算 CIF 参考衍射谱，避免进入表征步骤时卡顿
  setTimeout(()=>{ try { lab.referencePattern(); } catch(e) { console.warn('参考谱预计算失败', e); } }, 700);
  bindUI();renderAll();const saved=loadSaved();if(saved&&saved.startedAt){$('#resumeBtn').classList.remove('hidden');}
  timerHandle=setInterval(()=>{if($('#introModal').classList.contains('hidden')&&!state.demo){state.elapsed++;const h=String(Math.floor(state.elapsed/3600)).padStart(2,'0'),m=String(Math.floor(state.elapsed%3600/60)).padStart(2,'0'),s=String(state.elapsed%60).padStart(2,'0');$('#timer').textContent=`${h}:${m}:${s}`;if(state.elapsed%10===0)save();}},1000);
  window.addEventListener('beforeunload',()=>{if(sessionActive&&!state.demo){try{const copy=deepCopy(state);copy.reaction.playing=false;store.set(STORAGE_KEY,JSON.stringify(copy));}catch(e){}}});
}
window.MOFApp = { getState:()=>state, action:handleAction, openReport,
  replay:step=>{ lab?.focusForStep(step); const devices={3:'balance',4:'beakerA',5:'reactor',6:'reactor',7:'centrifuge',8:'centrifuge',9:'oven',10:'pxrd'}; lab?.replayOperation?.(devices[step]||'balance'); showSceneBanner('历史操作演示回放 · 不改变实验记录与评分'); }
};
window.addEventListener('DOMContentLoaded',init);
})();
