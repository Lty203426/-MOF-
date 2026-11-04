# MOF Studio · Cu-BTC 虚拟仿真实验（源代码）

Cu-BTC（HKUST-1）金属有机框架材料合成与表征的 **3D 沉浸式虚拟仿真实验**，纯前端单页应用（SPA）。
无构建步骤、无网络依赖，双击 `index.html` 即可离线运行。

- 发布页面：https://workbuddy.link/p/RHVTSp1E3Ap1myus4gs207
- 源码整理时间：2026-10-27

---

## 一、快速运行

**方式 1（最简单）**：双击 `index.html`，用 Chrome / Edge 打开。

**方式 2（推荐，避免个别浏览器对本地文件的限制）**：在本目录下启动一个静态服务再访问。

```bash
# Python 3
python -m http.server 8080
# 然后浏览器打开 http://127.0.0.1:8080/index.html
```

> 运行环境要求：支持 WebGL 的现代浏览器（Chrome 90+ / Edge 90+）。首次加载约 1–3 秒（解析 CIF 结构并计算衍射谱）。

---

## 二、目录结构

```
MOF-Studio_源码/
├── index.html                 入口页面：加载动画、顶栏、侧边流程栏、场景容器、各弹窗容器
├── styles.css                 全部样式（深色科技风主题、面板、弹窗、表征图表、评审卡片等）
├── app.js                     应用主逻辑：13 步实验状态机、UI 渲染、评分、报告、PXRD 导入比对
├── scene.js                   三维场景：程序化生成实验室、仪器动画、CIF 晶体结构查看器、射线拾取
├── assets/
│   ├── three.min.js           Three.js r128（第三方库，本地化，MIT 许可）
│   ├── OrbitControls.js       Three.js 轨道控制器（第三方，本地化）
│   ├── cif-data.js            内置真实 HKUST-1 CIF 数据（RASPA 结构库分发版）
│   └── crys.js                晶体学与衍射引擎：CIF 解析、对称展开、结构因子、PXRD 计算、寻峰、谱图比对
└── _平台元数据/
    └── janus.data.json        WorkBuddy 页面编辑器节点树（不参与运行，仅存档）
```

脚本加载顺序（`index.html` 末尾，有依赖关系，不可调换）：

```html
<script src="assets/three.min.js"></script>     <!-- 1. 三维引擎 -->
<script src="assets/OrbitControls.js"></script> <!-- 2. 相机控制器 -->
<script src="assets/cif-data.js"></script>      <!-- 3. 真实 CIF 数据 -->
<script src="assets/crys.js"></script>          <!-- 4. 衍射计算引擎（暴露 window.Crys） -->
<script src="scene.js"></script>                <!-- 5. 场景类 VirtualLab -->
<script src="app.js"></script>                  <!-- 6. 应用入口（依赖以上全部） -->
```

---

## 三、文件职责说明

| 文件 | 行数量级 | 主要职责 |
| --- | --- | --- |
| `index.html` | ~110 行 | 页面骨架、加载遮罩、顶栏/侧栏/底栏布局、各功能弹窗挂载点 |
| `styles.css` | ~1900 行 | 全站样式：主题变量、栅格布局、仪器面板、图表、评审表、打印样式 |
| `app.js` | ~2400 行 | `defaultState()` 状态机、`renderAll()` 渲染、`handleAction()` 动作分发、称量/配液/组装/反应/分离/洗涤/活化/表征各环节 UI、评分 `calculateQuality()`、报告生成、PXRD 实测数据导入与峰位匹配 |
| `scene.js` | ~1900 行 | `VirtualLab` 类：渲染器/相机/光照、程序化建模（实验台、通风橱、天平、反应釜、离心机、干燥箱、PXRD、SEM、BET 等）、仪器交互动画、`buildCIFStructure()` 真实晶体结构、原子拾取与信息回传、热振动动画、性能自动降级 |
| `assets/crys.js` | ~700 行 | CIF 1.1 解析器、对称操作展开（192 个操作）、等价原子合并、共价/配位成键判定、Cromer–Mann 散射因子、结构因子与洛伦兹-偏振校正、高斯峰形、中心化格子消光预判、`findPeaks()` 寻峰、`comparePatterns()` 实测-计算峰位匹配、`parseXY()` 数据解析 |
| `assets/cif-data.js` | ~20 行 | 内置 HKUST-1 CIF 原文（F m -3 m，a = 26.343 Å，V = 18280.8 Å³） |

---

## 四、功能与技术要点

**1. 实验流程（13 步状态机）**
实验导入 → 安全培训与检查 → 器材选择与布置 → 试剂称量 → 溶液配制 → 反应体系组装 → 反应条件设置 → 晶体成核与生长 → 产物分离 → 洗涤纯化 → 活化处理 → 材料表征 → 实验报告与评价。
每步含前置条件校验，未完成关键操作不能进入下一步；进度写入 `localStorage`，刷新可恢复。

**2. 全程序化三维场景（无外部模型）**
所有仪器、器皿、家具均由 Three.js 几何体组合生成，共约 40+ 类设备；关键仪器带交互动画：
天平防风门与称量舟落放、磁力搅拌与涡旋、反应釜旋盖与烘箱升温、离心机转子启停、真空干燥箱门与真空表、超声波清洗气泡、通风橱视窗、PXRD 测角仪摆臂、BET 杜瓦瓶升降、SEM 电子束逐行扫描。

**3. 真实 CIF 数据接入与三维晶体结构查看器**
- `crys.js` 解析内置真实 CIF，按 192 个对称操作展开非对称单位 → 完整晶胞（624 原子：Cu 48 / O 192 / C 288 / H 96）；
- 依据共价半径自动成键，区分**共价键**（灰）与 **Cu–O 配位键**（橙），呈现 Cu₂ 桨轮（paddle-wheel）次级构筑单元；
- 支持原子点击查询（元素、分数坐标、近邻距离）、晶胞线框开关、氢原子显隐、热振动（各向同性 U_iso 位移）动画。

**4. 由结构计算粉末衍射（PXRD）参考谱**
结构因子 `F(hkl) = Σ f_j·exp[2πi(hx+ky+lz)]·occ·DW`，配 Cromer–Mann（IT92）散射因子、洛伦兹-偏振因子、高斯峰形。
含**中心化格子系统消光预判**（F 心），反射数由 16104 降至 4014，浏览器实测计算耗时约 256 ms。
计算峰位与 JCPDS 00-064-0936 卡片 15 个特征峰全部吻合（最大偏差 0.044°）。

**5. 实测数据导入与峰位比对**
支持选择文件（XY/TXT/CSV）或粘贴两列数据，自动解析为 2θ–强度曲线并以橙色叠加到理论谱上；`comparePatterns()` 用寻峰 + 最近邻匹配输出「实测 2θ / 计算 2θ / Δ2θ / hkl / d 值」对照表与匹配率。

**6. 评分与报告**
`calculateQuality()` 依据实际称量偏差、配液体积、反应温度时间、洗涤轮次、活化温度等计算产物质量（产率、BET、晶体尺寸、颜色），并生成可打印实验报告（含操作日志、失误记录、数据分析问答、结论）。

---

## 五、二次开发提示

- 改实验参数（试剂目标量、容差、温度/时间范围、评分权重）：`app.js` 顶部的 `REAGENTS`、`STEPS` 等常量；
- 改三维设备造型与动作：`scene.js` 中各 `buildXxx()` 方法；仪器动画统一走 `tween()` 补间；
- 换晶体结构：替换 `assets/cif-data.js` 中的 CIF 文本（保持 `window.MOF_CIF_LIBRARY` 结构），引擎会自动完成对称展开与衍射计算；
- 性能调优：`scene.js` 中 `pixelCap`、阴影贴图尺寸、连续低帧自动降级逻辑。

---

## 六、许可与来源

- `assets/three.min.js`、`assets/OrbitControls.js`：Three.js r128，MIT License，© three.js authors。
- CIF 数据：HKUST-1 结构取自 RASPA 结构库分发版，原始文献 Chui et al., *Science* 283 (1999) 1148–1150。
- 其余代码为本项目原创，供教学与参赛使用。
