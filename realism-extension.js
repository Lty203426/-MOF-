
/* 写实实验台 v2：所有运行资源仍由本地几何、Canvas 与 WebAudio 生成。 */
(function () {
  'use strict';
  const P=VirtualLab.prototype;
  const oldEquipment=P.buildEquipment,oldEnvironment=P.buildEnvironment,oldMaterials=P.materials;
  const oldUpdate=P.updateDevices,oldState=P.updateFromState,oldBind=P.bindEvents,oldOverview=P.overview;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lerp=(a,b,t)=>a+(b-a)*t;
  P.materials=function(){oldMaterials.call(this);
    this.mat.white.roughness=.39;this.mat.white.color.set(0xe3e7e8);
    this.mat.benchTop.color.set(0xcdd4d9);this.mat.benchTop.roughness=.3;
    this.mat.glass.color.set(0xbbd4df);this.mat.glass.opacity=.19;this.mat.glass.roughness=.045;this.mat.glass.clearcoat=1;
    this.mat.opticalGlass.color.set(0xe4f1f5);this.mat.opticalGlass.roughness=.045;
    this.mat.steel.color.set(0x9ba5ae);this.mat.steel.roughness=.25;
    this.mat.chrome.color.set(0xbfc9d0);this.mat.chrome.roughness=.16;
    this.mat.blueLiquid.color.set(0x0788b6);this.mat.blueLiquid.opacity=.63;
    this.mat.amber.color.set(0x45260e);this.mat.amber.opacity=.94;
    this.mat.labBlue=new THREE.MeshStandardMaterial({color:0x234b8e,roughness:.38,metalness:.06});
    this.mat.rubber=new THREE.MeshStandardMaterial({color:0x17222d,roughness:.82});
    this.mat.frosted=new THREE.MeshPhysicalMaterial({color:0xe4eff2,transparent:true,opacity:.32,roughness:.16,clearcoat:1,depthWrite:false});
    this.realism={devices:new Map(),jobs:[],selected:null,history:[],free:false,elapsed:0,liquids:new Map(),metrics:{}};
  };
  P.buildEnvironment=function(){oldEnvironment.call(this);
    this.scene.background.set(0xc9d3db);this.scene.fog.color.set(0xc9d3db);
    this.scene.traverse(o=>{if(o.isHemisphereLight)o.intensity=.38;if(o.isDirectionalLight){o.intensity=1.05;o.shadow.bias=-.00015;o.shadow.normalBias=.025;o.shadow.camera.near=.5;o.shadow.camera.far=35;}if(o.isPointLight)o.intensity*=.55;});
    // 真实台面下的拉手、铰链与可开启柜门。
    for(let i=0;i<7;i++){
      const g=new THREE.Group();g.position.set(-4.9+i*1.62,.73,1.84);this.labRoot.add(g);
      const pivot=new THREE.Group();pivot.position.x=-.72;g.add(pivot);
      this.box(1.42,1.02,.035,this.mat.cabinet,.72,0,0,pivot);this.box(.28,.035,.07,this.mat.chrome,.99,.3,.047,pivot);
      for(const y of [-.34,.34])this.cyl(.017,.017,.13,this.mat.steel,.04,y,.015,pivot,10);
      this.registerReal(g,'drawer-'+i,'实验台储物柜 '+(i+1),'cabinet',{door:pivot,open:false},[1.7,1.3,2.5]);
    }
  };
  P.buildStudioEnvironment=function(){
    const env=new THREE.Scene();env.background=new THREE.Color(0x5e6a75);
    const room=new THREE.Mesh(new THREE.BoxGeometry(22,14,22),new THREE.MeshBasicMaterial({color:0x56616b,side:THREE.BackSide}));room.position.y=4;env.add(room);
    [[0,9,0,13,.06,3,0xffffff,2],[-8,4,0,.06,6,10,0xe6f1ff,1.5],[8,4,-3,.06,4,7,0xfff4e1,1],[0,-2,0,20,.1,20,0x85919b,.55]].forEach(v=>{const m=new THREE.Mesh(new THREE.BoxGeometry(v[3],v[4],v[5]),new THREE.MeshBasicMaterial({color:v[6]}));m.material.color.multiplyScalar(v[7]);m.position.set(v[0],v[1],v[2]);env.add(m);});
    const gen=new THREE.PMREMGenerator(this.renderer);this.studioEnvironment=gen.fromScene(env,0,.1,100);this.scene.environment=this.studioEnvironment.texture;gen.dispose();env.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
  };
  P.latheGlass=function(points,parent,material=this.mat.glass,segments=64){const m=this.mesh(new THREE.LatheGeometry(points.map(p=>new THREE.Vector2(p[0],p[1])),segments),material,parent,false);m.renderOrder=4;return m;};
  P.markPart=function(object,id,part,label){object.traverse(o=>{if(o.isMesh){o.userData.labPart={id,part,label};}});return object;};
  P.registerReal=function(group,id,name,type,data={},offset=[2,1.2,2.7]){
    if(!this.devices.has(id))this.register(group,id,name,name+' · 点击操作',offset);
    this.realism.devices.set(id,{id,name,type,group,data,home:group.position.clone(),rotation:group.rotation.clone()});
    return this.realism.devices.get(id);
  };
  P.realTexture=function(lines,{background='#f0f4f5',color='#243744',width=512,height=256,brand=true}={}){
    const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle=background;x.fillRect(0,0,width,height);x.fillStyle=color;
    lines.forEach((line,i)=>{x.font=(i===0?'bold ':'')+(i===0?38:26)+'px "Microsoft YaHei",sans-serif';x.fillText(line,24,53+i*46);});
    if(brand){x.fillStyle='#788892';x.font='17px sans-serif';x.fillText('MOF STUDIO · PRECISION LAB',24,height-15);}
    const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
  };
  P.faceLabel=function(parent,text,w,h,x,y,z,opts={}){const material=new THREE.MeshStandardMaterial({map:this.realTexture(text,opts),roughness:.62,metalness:0});const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);m.position.set(x,y,z);parent.add(m);return m;};
  P.buildBalance=function(){
    const g=new THREE.Group();g.position.set(2.65,1.31,.82);this.labRoot.add(g);
    this.box(1.5,.25,1.3,this.mat.white,0,.125,0,g);this.box(1.45,.025,1.24,this.mat.rubber,0,.022,0,g);
    for(const x of [-.58,.58])for(const z of [-.44,.44])this.cyl(.075,.08,.1,this.mat.rubber,x,-.015,z,g,16);
    this.box(1.3,.055,1.02,this.mat.white,0,.285,-.06,g);
    this.cyl(.29,.29,.028,this.mat.chrome,0,.345,-.06,g,64);this.balancePan=this.cyl(.285,.287,.02,this.mat.steel,0,.345,-.06,g,64);
    this.torus(.288,.012,this.mat.chrome,0,.358,-.06,g);
    for(const x of [-.64,.64])for(const z of [-.52,.45])this.box(.027,1.06,.027,this.mat.chrome,x,.85,z,g);
    this.box(1.32,.06,1.02,this.mat.white,0,1.4,-.04,g);
    this.box(1.28,1.04,.012,this.mat.glass,0,.85,-.53,g);
    this.balanceSideDoors=[-.643,.643].map((x,i)=>{const door=this.box(.012,1.01,.91,this.mat.opticalGlass,x,.85,-.03,g);this.markPart(door,'balance',i?'door-right':'door-left',i?'右侧玻璃推拉门':'左侧玻璃推拉门');return door;});
    this.balanceDoor=this.box(1.24,1.01,.012,this.mat.glass.clone(),0,.85,.45,g);this.markPart(this.balanceDoor,'balance','door-front','前侧防风门');
    for(const x of [-.63,.63])this.box(.024,.22,.035,this.mat.chrome,x,.85,.39,g);
    this.balanceScreen=this.box(.77,.18,.015,this.mat.screen.clone(),0,.13,.659,g);this.balanceScreen.material.map=this.screenTexture(['0.000 g','NET STABLE']);
    const buttons=[['tare','TARE'],['weigh-add','ADD'],['weigh-remove','−'],['power','ON']];
    buttons.forEach(([part,label],i)=>{const b=this.box(.16,.045,.045,i===3?this.mat.green:this.mat.labBlue,-.39+i*.26,.028,.68,g);this.markPart(b,'balance',part,label);});
    const bubble=this.cyl(.04,.04,.013,new THREE.MeshPhysicalMaterial({color:0x97c888,roughness:.12,clearcoat:1}),.58,.26,.46,g,20);this.torus(.046,.006,this.mat.chrome,.58,.27,.46,g);
    const pg=new THREE.CylinderGeometry(.125,.142,1,24);pg.translate(0,.5,0);
    this.boat=this.cyl(.19,.14,.055,this.mat.whiteSolid.clone(),0,.39,-.06,g);this.boat.visible=false;this.boatPowder=new THREE.Mesh(pg,this.mat.blueSolid.clone());this.boatPowder.scale.y=.001;this.boatPowder.position.y=.0275;this.boat.add(this.boatPowder);this.boatPowder.visible=false;
    this.faceLabel(g,['ANALYTICAL BALANCE','0.1 mg · 220 g'],.42,.13,-.47,.19,.66,{brand:false});
    this.register(g,'balance','分析天平','玻璃门 / 秤盘 / 去皮 / 实时称量',[1.8,1.05,2.4]);
    this.registerReal(g,'balance','分析天平','balance',{left:0,right:0,front:0,mass:0,tare:0,on:true,bubble});
  };
  P.bottle=function(id,name,formula,x,z,material,capColor=0x263b40,fillMat=null,powder=false){
    const g=new THREE.Group();g.position.set(x,1.31,z);this.labRoot.add(g);
    const bodyMaterial=(id==='btc'||id==='cu')?this.mat.white:material;
    this.latheGlass([[.001,.025],[.19,.025],[.245,.045],[.258,.08],[.258,.58],[.25,.65],[.19,.72],[.12,.76],[.12,.86],[.1,.86],[.1,.76],[.18,.7],[.235,.63],[.24,.08],[.19,.045],[.001,.045]],g,bodyMaterial,48);
    const cap=new THREE.Group();cap.position.y=.86;g.add(cap);const cm=new THREE.MeshStandardMaterial({color:capColor,roughness:.45});this.cyl(.139,.139,.115,cm,0,0,0,cap,32);
    const ribs=new THREE.InstancedMesh(new THREE.BoxGeometry(.011,.086,.009),cm,24),dummy=new THREE.Object3D();for(let i=0;i<24;i++){const a=i*Math.PI/12;dummy.position.set(Math.cos(a)*.14,0,Math.sin(a)*.14);dummy.rotation.y=-a;dummy.updateMatrix();ribs.setMatrixAt(i,dummy.matrix);}cap.add(ribs);this.markPart(cap,id,'cap','旋开 / 拧紧瓶盖');
    this.cyl(.112,.112,.035,this.mat.white,0,.805,0,g,32);
    const tag=new THREE.Mesh(new THREE.CylinderGeometry(.261,.261,.38,48,1,true,-.78,1.56),new THREE.MeshStandardMaterial({map:this.reagentLabel(name,formula,id),roughness:.75,side:THREE.DoubleSide}));tag.position.y=.38;tag.renderOrder=7;g.add(tag);
    let fill=null;if(fillMat){fill=this.cyl(.225,.225,powder?.19:.45,fillMat,0,powder?.14:.26,0,g,32);}
    this.register(g,id,name,formula+' · 瓶盖与内容物可操作',[1.6,1,2.2]);this.bottles=this.bottles||{};this.bottles[id]={group:g,baseY:g.position.y,tilt:0,liquid:fill};
    const d=this.registerReal(g,id,name,powder?'powder':'bottle',{cap,capOpen:false,fill,volume:powder?20:100,capacity:100,powder,formula});
    d.data.flow=new THREE.Mesh(new THREE.CylinderGeometry(.009,.018,1,10),new THREE.MeshPhysicalMaterial({color:0x45b3d3,transparent:true,opacity:.72,roughness:.08,depthWrite:false}));d.data.flow.visible=false;this.labRoot.add(d.data.flow);return g;
  };
  P.beaker=function(id,name,x,z){
    const g=new THREE.Group();g.position.set(x,1.31,z);this.labRoot.add(g);
    const body=this.latheGlass([[.001,.025],[.32,.025],[.375,.04],[.39,.075],[.4,.8],[.415,.85],[.423,.864],[.415,.879],[.399,.87],[.386,.82],[.375,.08],[.32,.047],[.001,.047]],g,this.mat.opticalGlass);
    this.torus(.408,.012,this.mat.glass,0,.86,0,g);
    const spout=new THREE.Mesh(new THREE.SphereGeometry(.09,24,12,0,Math.PI,0,Math.PI/2),this.mat.glass);spout.scale.set(1,.3,.75);spout.position.set(0,.854,.387);spout.rotation.y=Math.PI;g.add(spout);
    const c=document.createElement('canvas');c.width=512;c.height=512;const q=c.getContext('2d');q.strokeStyle=q.fillStyle='#35586c';q.lineWidth=3;q.font='29px sans-serif';for(let i=1;i<=5;i++){const yy=450-i*74;q.beginPath();q.moveTo(24,yy);q.lineTo(i%2?85:115,yy);q.stroke();q.fillText(''+i*10,130,yy+10);}q.font='20px sans-serif';q.fillText('50 mL · BORO 3.3',24,485);
    const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;const marks=new THREE.Mesh(new THREE.CylinderGeometry(.407,.391,.7,32,1,true,-.58,1.16),new THREE.MeshStandardMaterial({map:t,transparent:true,depthWrite:false,roughness:.6}));marks.position.y=.46;marks.renderOrder=7;g.add(marks);
    const liquid=this.cyl(.373,.361,.5,this.mat.clearLiquid.clone(),0,.27,0,g,48);liquid.scale.y=.02;liquid.visible=false;liquid.material.depthWrite=false;
    const surface=new THREE.Mesh(new THREE.CircleGeometry(.374,48),new THREE.MeshPhysicalMaterial({color:0x6eb8d0,roughness:.045,transparent:true,opacity:.55,side:THREE.DoubleSide,clearcoat:1,depthWrite:false}));surface.rotation.x=-Math.PI/2;surface.visible=false;surface.renderOrder=3;g.add(surface);
    const ripple=new THREE.Mesh(new THREE.TorusGeometry(.1,.006,6,40),new THREE.MeshBasicMaterial({color:0xb5f3ff,transparent:true,opacity:.5,depthWrite:false}));ripple.rotation.x=Math.PI/2;ripple.visible=false;g.add(ripple);
    const solid=this.cyl(.29,.3,.045,this.mat.blueSolid,0,.07,0,g);solid.visible=false;
    const vortex=new THREE.Mesh(new THREE.ConeGeometry(.3,.2,32,4,true),new THREE.MeshPhysicalMaterial({color:0x42a2be,transparent:true,opacity:.2,roughness:.07,side:THREE.DoubleSide,depthWrite:false}));vortex.rotation.x=Math.PI;vortex.position.y=.4;vortex.visible=false;g.add(vortex);
    const barPivot=new THREE.Group();barPivot.position.y=.065;g.add(barPivot);const bar=this.cyl(.026,.026,.19,this.mat.white,0,0,0,barPivot,16);bar.rotation.z=Math.PI/2;barPivot.visible=false;
    const rod=new THREE.Group();rod.position.set(.11,.57,.02);g.add(rod);const shaft=this.cyl(.012,.014,.72,this.mat.opticalGlass,0,0,0,rod,12);shaft.position.y=-.06;const tip=this.cyl(.014,.014,.035,this.mat.chrome,0,-.42,0,rod,12);tip.visible=false;this.markPart(rod,id,'glass-rod','玻璃棒');
    this.register(g,id,name,'50 mL 硼硅玻璃 · 液面 / 倾倒 / 搅拌',[1.15,.85,1.65]);
    const b={group:g,body,liquid,surface,ripple,solid,vortex,stirBar:barPivot,rod};this.registerReal(g,id,name,'beaker',{vessel:b,volume:0,capacity:50,temperature:22,stirSpeed:0});this.realism.liquids.set(id,b);return b;
  };
  P.makeFlask=function(id,name,x,z,size=1,color=0x8654c8){
    const g=new THREE.Group();g.position.set(x,1.31,z);g.scale.setScalar(size);this.labRoot.add(g);
    this.latheGlass([[.001,.025],[.3,.025],[.34,.06],[.345,.12],[.28,.27],[.13,.61],[.105,.69],[.105,.92],[.12,.94],[.108,.955],[.092,.94],[.09,.68],[.115,.61],[.264,.27],[.325,.1],[.3,.05],[.001,.05]],g,this.mat.glass);
    this.torus(.109,.011,this.mat.glass,0,.94,0,g);
    const liquid=this.latheGlass([[.001,.05],[.3,.05],[.315,.1],[.225,.34],[.001,.34]],g,new THREE.MeshPhysicalMaterial({color,transparent:true,opacity:.63,roughness:.07,metalness:0,depthWrite:false}),48);
    this.faceLabel(g,[name,'BORO 3.3'],.27,.13,0,.49,.185,{background:'#e8edf0',brand:false});
    this.register(g,id,name,'锥形瓶 · 定量转移 / 摇匀',[1.2,.85,1.8]);this.registerReal(g,id,name,'flask',{fill:liquid,volume:40,capacity:100,temperature:22});return g;
  };
  P.buildDecor=function(){
    // 双层试剂架：圆肩瓶、独立螺纹盖与贴体标签。
    const shelf=new THREE.Group();shelf.position.set(0,0,-6.55);this.labRoot.add(shelf);
    for(const y of [2.2,3.16]){this.box(9,.055,.72,this.mat.white,0,y,0,shelf);this.box(9,.025,.035,this.mat.chrome,0,y,.36,shelf);}
    for(const x of [-4.2,0,4.2])this.box(.04,2,.5,this.mat.chrome,x,2.68,-.21,shelf);
    const labels=[['ethanol','无水乙醇','C₂H₅OH'],['btc','均苯三甲酸','H₃BTC'],['cu','三水硝酸铜','Cu(NO₃)₂·3H₂O'],['water','去离子水','H₂O'],['dmf','DMF','C₃H₇NO']];
    for(let row=0;row<2;row++)for(let col=0;col<7;col++){
      const meta=labels[(col+row*2)%labels.length],id='shelf-'+row+'-'+col;
      const g=this.bottle(id,meta[1],meta[2],0,0,col%3===0?this.mat.white:this.mat.amber,col%3===0?0xcf3d40:0x285b9e,this.mat.clearLiquid.clone());g.position.set(-3.8+col*1.23,2.23+row*.96,-6.52);g.scale.setScalar(.7);this.realism.devices.get(id).home.copy(g.position);
    }
    this.makeFlask('flask-250','250 mL 锥形瓶',-4.35,.94,1.1,0x7452bd);this.makeFlask('flask-100','100 mL 锥形瓶',-5.18,.35,.85,0x624ec9);this.makeFlask('flask-50','50 mL 锥形瓶',-3.8,1.28,.68,0x286ad6);
    // 六孔试管架：顶板真实孔洞、圆底薄壁试管与各自液面。
    const rack=new THREE.Group();rack.position.set(.45,1.31,1.33);this.labRoot.add(rack);
    this.box(1.48,.055,.42,this.mat.white,0,.028,0,rack);for(const x of [-.67,.67])for(const z of [-.15,.15])this.cyl(.018,.018,.64,this.mat.chrome,x,.34,z,rack,12);
    const shape=new THREE.Shape();shape.moveTo(-.74,-.21);shape.lineTo(.74,-.21);shape.lineTo(.74,.21);shape.lineTo(-.74,.21);shape.closePath();
    for(let i=0;i<6;i++){const h=new THREE.Path();h.absarc(-.55+i*.22,0,.071,0,Math.PI*2,true);shape.holes.push(h);}
    const plate=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.045,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,steps:1,curveSegments:16}),this.mat.white);plate.rotation.x=-Math.PI/2;plate.position.y=.5;rack.add(plate);
    const colors=[0xc12757,0xe2a510,0xe1c536,0x36aaa1,0x009fba,0x1c7fbb];
    for(let i=0;i<6;i++){
      const g=new THREE.Group();g.position.set(-.55+i*.22,.055,0);rack.add(g);
      this.latheGlass([[.001,0],[.036,.005],[.056,.025],[.059,.06],[.059,.85],[.065,.87],[.058,.885],[.05,.874],[.049,.065],[.035,.02],[.001,.015]],g,this.mat.glass,32);
      const fill=this.cyl(.047,.045,.43,new THREE.MeshPhysicalMaterial({color:colors[i],roughness:.08,transparent:true,opacity:.68,depthWrite:false}),0,.25,0,g,24);this.torus(.06,.006,this.mat.glass,0,.876,0,g);
      this.register(g,'tube-'+i,'试管 '+(i+1),'圆底试管 · 提起 / 摇匀 / 转移液体',[.75,.65,1]);this.registerReal(g,'tube-'+i,'试管 '+(i+1),'tube',{fill,volume:6,capacity:10,parent:rack,localHome:g.position.clone()});
    }
    this.register(rack,'tube-rack','六孔试管架','六支试管可分别取用',[1.8,1,2.4]);this.registerReal(rack,'tube-rack','六孔试管架','rack',{});
    this.buildBurette();this.buildFiltration();this.buildGlassPipettes();
    // 保留教学流程所使用的器材 ID。
    const boat=new THREE.Group();boat.position.set(-2.7,1.31,1.35);this.labRoot.add(boat);this.box(.32,.022,.22,this.mat.whiteSolid,0,.018,0,boat);for(const z of [-.11,.11])this.box(.32,.045,.016,this.mat.whiteSolid,0,.04,z,boat);this.register(boat,'boatProp','称量舟','放入天平 / 加样',[1,.7,1.4]);this.registerReal(boat,'boatProp','称量舟','boat',{});
    const pip=new THREE.Group();pip.position.set(-2.4,1.31,.9);this.labRoot.add(pip);this.cyl(.05,.044,.35,this.mat.white,0,.36,0,pip,24);this.cyl(.04,.04,.11,this.mat.labBlue,0,.6,0,pip,24);this.cyl(.012,.02,.2,this.mat.glass,0,.09,0,pip,16);this.cyl(.012,.024,.12,this.mat.labBlue,0,.72,0,pip,16);this.faceLabel(pip,['1000','µL'],.065,.15,0,.36,.048,{brand:false});this.register(pip,'pipette','可调微量移液器','吸液 / 排液 / 换吸头',[.8,.7,1.2]);this.registerReal(pip,'pipette','可调微量移液器','pipette',{volume:0,capacity:1,tip:true});
    const vial=new THREE.Group();vial.position.set(4.65,1.31,1.4);this.labRoot.add(vial);const cap=new THREE.Group();cap.position.y=.32;vial.add(cap);this.latheGlass([[.001,0],[.11,0],[.12,.03],[.12,.3],[.1,.34],[.09,.34],[.1,.29],[.1,.03],[.001,.02]],vial,this.mat.glass,40);this.cyl(.12,.12,.08,this.mat.capBlue,0,0,0,cap,28);const powder=this.cyl(.09,.1,.06,this.mat.blueSolid,0,.05,0,vial,24);this.register(vial,'vial','样品瓶','瓶盖 / 样品转移',[.8,.7,1.3]);this.registerReal(vial,'vial','样品瓶','powder',{cap,capOpen:false,fill:powder,volume:5,capacity:20});
  };
  P.buildBurette=function(){
    const g=new THREE.Group();g.position.set(-1.32,1.31,.47);this.labRoot.add(g);
    this.box(.95,.075,.68,this.mat.labBlue,0,.04,0,g);for(const x of [-.35,.35])this.cyl(.045,.045,.05,this.mat.rubber,x,-.006,0,g,12);
    this.cyl(.027,.027,2.25,this.mat.chrome,-.28,1.18,-.12,g,24);this.cyl(.049,.049,.11,this.mat.chrome,-.28,.19,-.12,g,24);
    for(const y of [.85,1.73]){
      const clamp=this.box(.4,.075,.12,this.mat.steel,-.1,y,-.08,g);this.cyl(.04,.04,.13,this.mat.labBlue,-.29,y,.025,g,16).rotation.x=Math.PI/2;
      this.torus(.048,.012,this.mat.steel,.12,y,-.06,g).rotation.x=0;
      for(const z of [-.11,.01])this.box(.14,.02,.025,this.mat.steel,.1,y,z,g);
    }
    const tube=new THREE.Group();tube.position.set(.14,.47,-.06);g.add(tube);
    this.latheGlass([[.018,0],[.035,.17],[.035,1.78],[.043,1.8],[.034,1.82],[.026,1.78],[.026,.18],[.009,.01]],tube,this.mat.glass,40);
    const liquid=this.cyl(.023,.023,1.3,new THREE.MeshPhysicalMaterial({color:0x52bdd5,roughness:.05,transparent:true,opacity:.62,depthWrite:false}),0,.9,0,tube,24);
    const meniscus=new THREE.Mesh(new THREE.CircleGeometry(.024,24),new THREE.MeshPhysicalMaterial({color:0x8cdae8,transparent:true,opacity:.68,roughness:.06,side:THREE.DoubleSide,depthWrite:false}));meniscus.rotation.x=-Math.PI/2;meniscus.position.y=1.54;tube.add(meniscus);
    const tap=new THREE.Group();tap.position.y=.14;tube.add(tap);this.cyl(.045,.045,.09,this.mat.white,0,0,0,tap,24).rotation.z=Math.PI/2;this.box(.17,.027,.027,this.mat.labBlue,.055,0,.04,tap);this.markPart(tap,'burette','valve','滴定管玻璃活塞');
    const c=document.createElement('canvas');c.width=256;c.height=1024;const q=c.getContext('2d');q.strokeStyle=q.fillStyle='#29475c';q.lineWidth=2;q.font='19px sans-serif';for(let i=0;i<=50;i++){const yy=30+i*19;q.beginPath();q.moveTo(35,yy);q.lineTo(i%5===0?95:65,yy);q.stroke();if(i%5===0)q.fillText(''+i,112,yy+6);}
    const t=new THREE.CanvasTexture(c);const marks=new THREE.Mesh(new THREE.CylinderGeometry(.0365,.0365,1.58,24,1,true,-1,2),new THREE.MeshStandardMaterial({map:t,transparent:true,depthWrite:false}));marks.position.y=.96;tube.add(marks);
    this.register(g,'burette','50 mL 酸式滴定管','活塞开度 / 滴速 / 累计滴定体积',[1.3,1.1,2.1]);this.registerReal(g,'burette','50 mL 酸式滴定管','burette',{tap,liquid,meniscus,volume:50,capacity:50,rate:0,delivered:0,dropAccumulator:0,dropProgress:0});
    const receiver=this.beaker('titration-cup','滴定接收烧杯',-1.18,.49);receiver.group.scale.setScalar(.57);this.realism.devices.get('titration-cup').data.capacity=50;
    const stream=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.32,10),new THREE.MeshPhysicalMaterial({color:0x53bfda,transparent:true,opacity:.65,roughness:.04,depthWrite:false}));stream.position.set(.14,.31,-.06);stream.visible=false;g.add(stream);this.realism.devices.get('burette').data.stream=stream;
    const drop=new THREE.Mesh(new THREE.SphereGeometry(.018,16,12),new THREE.MeshPhysicalMaterial({color:0x53bfda,transparent:true,opacity:.78,roughness:.04,clearcoat:1}));drop.position.set(.14,.61,-.06);drop.visible=false;g.add(drop);this.realism.devices.get('burette').data.drop=drop;
  };
  P.buildFiltration=function(){
    const g=new THREE.Group();g.position.set(4.65,1.31,-.65);this.labRoot.add(g);
    this.latheGlass([[.001,.02],[.28,.02],[.32,.06],[.32,.13],[.2,.44],[.1,.55],[.1,.77],[.08,.77],[.08,.57],[.18,.44],[.3,.1],[.28,.04],[.001,.04]],g,this.mat.glass,56);
    const fill=this.latheGlass([[.001,.04],[.28,.04],[.29,.12],[.245,.23],[.001,.23]],g,new THREE.MeshPhysicalMaterial({color:0x05a6bf,transparent:true,opacity:.64,roughness:.06,depthWrite:false}),40);
    this.cyl(.11,.09,.065,this.mat.labBlue,0,.76,0,g,24);
    const funnel=new THREE.Group();funnel.position.y=.78;g.add(funnel);this.cyl(.085,.05,.25,this.mat.white,0,.06,0,funnel,24);this.latheGlass([[.12,.12],[.26,.15],[.28,.18],[.28,.45],[.25,.45],[.25,.2],[.12,.18]],funnel,this.mat.white,48);
    const plate=this.cyl(.245,.245,.023,this.mat.whiteSolid,0,.205,0,funnel,48);
    const holes=new THREE.InstancedMesh(new THREE.CylinderGeometry(.01,.01,.025,8),this.mat.dark,37),dummy=new THREE.Object3D();let n=0;for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++)if(i*i+j*j<=10&&n<37){dummy.position.set(i*.055,.22,j*.055);dummy.updateMatrix();holes.setMatrixAt(n++,dummy.matrix);}holes.count=n;funnel.add(holes);this.markPart(funnel,'filter','funnel','取下 / 装回布氏漏斗');
    const path=new THREE.CatmullRomCurve3([new THREE.Vector3(.1,.62,0),new THREE.Vector3(.4,.64,0),new THREE.Vector3(.58,.35,0),new THREE.Vector3(.85,.13,.1)]);this.mesh(new THREE.TubeGeometry(path,32,.027,10,false),this.mat.labBlue,g,false);
    this.register(g,'filter','布氏漏斗与抽滤瓶','漏斗 / 负压 / 滤液收集',[1.4,1,2]);this.registerReal(g,'filter','布氏漏斗与抽滤瓶','filter',{funnel,fill,vacuum:false,volume:20,funnelOpen:false});
  };
  P.buildGlassPipettes=function(){
    const holder=new THREE.Group();holder.position.set(-.2,1.31,-.86);this.labRoot.add(holder);this.box(1,.055,.42,this.mat.white,0,.027,0,holder);for(const x of [-.36,.36])this.cyl(.022,.022,.8,this.mat.chrome,x,.43,0,holder,16);this.box(1,.035,.18,this.mat.white,0,.84,0,holder);
    for(let i=0;i<3;i++){
      const g=new THREE.Group();g.position.set((i-1)*.25,.12,.1);holder.add(g);
      this.latheGlass([[.003,0],[.017,.14],[.017,.42],[i===1?.05:.017,.5],[i===1?.06:.017,.62],[.017,.72],[.017,1.1],[.01,1.1],[.01,.72],[.01,.15],[.001,0]],g,this.mat.glass,24);
      const fill=this.cyl(.009,.009,.45,new THREE.MeshPhysicalMaterial({color:0x59bdd5,transparent:true,opacity:.7}),0,.48,0,g,12);fill.visible=false;
      for(let j=0;j<7;j++)this.torus(.018,.002,this.mat.white,0,.72+j*.045,0,g);
      const id='glass-pipette-'+i;this.register(g,id,i===1?'10 mL 单标线移液管':'5 mL 刻度吸管','吸取 / 排液 / 持液量',[.65,.75,1]);this.registerReal(g,id,i===1?'10 mL 单标线移液管':'5 mL 刻度吸管','pipette',{fill,volume:0,capacity:i===1?10:5,tip:true,parent:holder,localHome:g.position.clone()});
    }
    this.register(holder,'pipette-rack','移液管架','三支玻璃移液管',[1.2,1,1.8]);this.registerReal(holder,'pipette-rack','移液管架','rack',{});
  };
  P.buildEquipment=function(){oldEquipment.call(this);
    // 采用参考图的前排布局：滴定架左、彩色试管居中、分析天平右。
    this.beakerA.group.position.set(-2.45,1.31,-.12);this.beakerB.group.position.set(-1.25,1.31,-.45);
    for(const id of ['beakerA','beakerB'])this.realism.devices.get(id).home.copy(this.devices.get(id).group.position);
    this.attachInstrumentDetails();
    this.labRoot.traverse(o=>{if(o.isSprite)o.visible=false;});
    this.assistOn=false;if(this.assistant)this.assistant.visible=false;
  };
  P.attachInstrumentDetails=function(){
    const types={stirrer:'stirrer',reactor:'reactor',centrifuge:'centrifuge',oven:'oven',ultrasonic:'ultrasonic',phmeter:'ph',desiccator:'desiccator',hood:'hood',storage:'cabinet',flammable:'cabinet',gas:'gas',pxrd:'instrument',bet:'instrument',sem:'instrument',eyewash:'eyewash',shower:'shower',extinguisher:'extinguisher',waste:'waste',ppeStation:'ppe',firstaid:'firstaid',spillkit:'spillkit',spatula:'spatula'};
    for(const [id,d] of this.devices){if(this.realism.devices.has(id))continue;const type=types[id]||(/ph/i.test(id)?'ph':'equipment');this.registerReal(d.group,id,d.name,type,{on:false,open:false,temperature:22,target:120,rpm:600,pressure:0});}
    const R=this.realism.devices;
    const cent=R.get('centrifuge');if(cent){cent.data.lidOpen=true;cent.data.balanced=false;this.centrifugeLid.material=this.mat.frosted;this.markPart(this.centrifugeLid,'centrifuge','lid','离心机透明上盖');
      for(let i=0;i<8;i++){const angle=i*Math.PI/4;const holder=this.cyl(.082,.072,.055,this.mat.dark,Math.cos(angle)*.4,.02,Math.sin(angle)*.4,this.rotor,20);this.markPart(holder,'centrifuge','load','放置并对称配平离心管');}
      const ring=this.mesh(new THREE.TorusGeometry(.56,.014,10,64),this.mat.steel,cent.group);ring.rotation.x=Math.PI/2;ring.position.y=.75;
    }
    const oven=R.get('oven');if(oven){this.markPart(this.ovenDoor,'oven','door','真空箱门与锁扣');oven.data.door=this.ovenDoor;this.faceLabel(oven.group,['VACUUM DRYING OVEN','DZF · 120 °C'],.85,.24,0,.27,.79,{brand:false});for(let i=0;i<3;i++){const rack=this.box(1.65,.016,1.05,this.mat.steel,0,.5+i*.35,-.02,oven.group);rack.visible=true;}for(let i=0;i<12;i++)this.box(.13,.015,.025,this.mat.dark,.88,.4+i*.045,.79,oven.group);}
    const reactor=R.get('reactor');if(reactor){this.markPart(this.reactorLid,'reactor','lid','反应釜螺纹盖');for(let i=0;i<9;i++)this.torus(.524,.006,this.mat.chrome,0,.77+i*.023,0,reactor.group);this.faceLabel(reactor.group,['PTFE LINED','25 mL / 180 °C'],.52,.24,0,.47,.528,{brand:false});}
    const stirrer=R.get('stirrer');if(stirrer){const knob=this.cyl(.055,.055,.045,this.mat.labBlue,.26,.12,.455,stirrer.group,24);knob.rotation.x=Math.PI/2;this.markPart(knob,'stirrer','power','磁力搅拌器旋钮');const whitePlate=this.cyl(.35,.35,.035,this.mat.white,0,.22,0,stirrer.group,64);this.faceLabel(stirrer.group,['600 rpm'],.25,.08,-.15,.11,.44,{brand:false});}
    const hood=R.get('hood');if(hood)this.markPart(this.hoodSash,'hood','sash','通风橱安全视窗');
    const sonic=R.get('ultrasonic');if(sonic)this.markPart(this.ultrasonicLid,'ultrasonic','lid','超声水槽透明盖');
    for(const id of ['pxrd','bet','sem']){const d=R.get(id);if(d){const start=this.box(.16,.06,.035,this.mat.green,.57,.26,.71,d.group);this.markPart(start,id,'start','开始扫描');for(let i=0;i<8;i++)this.box(.09,.02,.02,this.mat.dark,-.68+i*.04,.24,.7,d.group);}}
    for(const id of ['storage','flammable']){
      const d=R.get(id);if(!d)continue;const door=new THREE.Group();door.position.set(-.8,1,.62);d.group.add(door);this.box(1.6,1.6,.045,id==='flammable'?this.mat.yellow:this.mat.cabinet,.8,0,0,door);this.box(.06,.35,.06,this.mat.chrome,1.4,0,.05,door);d.data.door=door;this.markPart(door,id,'door','安全柜铰链门');
    }
  };
  P.overview=function(){if(!this.realism)return oldOverview.call(this);this.crystalMode=false;this.labRoot.visible=true;this.crystalRoot.visible=false;this.cifRoot.visible=false;this.tweenCamera(new THREE.Vector3(7.4,4.05,10.9),new THREE.Vector3(0,1.95,-.65));};
  P.bindEvents=function(){
    const original=this.callbacks.onDeviceAction;
    this.callbacks.onDeviceAction=(id,name)=>{if(this.realism.free){this.inspectReal(id);return true;}return original?original(id,name):false;};
    oldBind.call(this);
    const canvas=this.renderer.domElement;
    canvas.addEventListener('click',()=>{if(!this.realism.free||this.dragDistance>5)return;const hit=this.pick(),part=hit&&hit.object.userData.labPart;if(part){this.realAction(part.id,part.part);this.inspectReal(part.id,false);}});
    this.bindBottleHandling(canvas);
    this.bindStirringHandling(canvas);
    this.mountRealUI();
  };
  P.bindStirringHandling=function(canvas){
    let active=null,lastX=0,lastY=0,lastT=0;const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-1.31),hitPoint=new THREE.Vector3();
    canvas.addEventListener('pointerdown',e=>{if(!this.realism.free||e.button!==0)return;const hit=this.pick(),part=hit?.object.userData.labPart;if(!part||part.part!=='glass-rod')return;const d=this.realism.devices.get(part.id);if(!d)return;active=d;lastX=e.clientX;lastY=e.clientY;lastT=performance.now();this.controls.enabled=false;canvas.setPointerCapture(e.pointerId);this.inspectReal(d.id,false);e.preventDefault();});
    canvas.addEventListener('pointermove',e=>{if(!active)return;const b=active.data.vessel,rod=b.rod,dx=(e.clientX-lastX)*.003,dy=(e.clientY-lastY)*.003,now=performance.now(),speed=Math.hypot(e.clientX-lastX,e.clientY-lastY)/Math.max(1,now-lastT);rod.position.x=THREE.MathUtils.clamp(rod.position.x+dx,-.19,.19);rod.position.z=THREE.MathUtils.clamp(rod.position.z+dy,-.19,.19);rod.rotation.z=THREE.MathUtils.clamp(rod.rotation.z+dy,-.42,.42);rod.rotation.x=THREE.MathUtils.clamp(rod.rotation.x+dx,-.42,.42);active.data.stirSpeed=Math.min(8,speed*2.8);lastX=e.clientX;lastY=e.clientY;lastT=now;});
    const release=e=>{if(!active)return;active.data.stirSpeed=Math.min(active.data.stirSpeed,.5);active=null;this.controls.enabled=true;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  };
  P.bindBottleHandling=function(canvas){
    const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),ground=new THREE.Plane(new THREE.Vector3(0,1,0),-1.31),point=new THREE.Vector3();let held=null,heldCap=false,lastX=0,lastY=0;
    const locate=e=>{const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,this.camera);return ray.ray.intersectPlane(ground,point)?point.clone():null;};
    canvas.addEventListener('pointerdown',e=>{
      if(!this.realism.free||e.button!==0)return;const hit=this.pick();if(!hit)return;const part=hit.object.userData.labPart,root=hit.object.userData.deviceRoot,id=part?.id||root?.userData.device;if(!id)return;
      const d=this.realism.devices.get(id);if(!d||!['bottle','powder'].includes(d.type))return;const p=locate(e);if(!p)return;
      held=d;heldCap=part?.part==='cap'&&d.data.capOpen&&d.data.cap.userData.detached;lastX=e.clientX;lastY=e.clientY;held.data.grabOffset=(heldCap?d.data.cap.position:d.group.position).clone().sub(p);held.data.grabTilt=d.group.rotation.z;this.controls.enabled=false;canvas.setPointerCapture(e.pointerId);this.inspectReal(id,false);e.preventDefault();
    });
    canvas.addEventListener('pointermove',e=>{
      if(!held)return;const p=locate(e);if(p){if(heldCap)held.data.cap.position.set(p.x+held.data.grabOffset.x,1.31+(held.id==='vial'?.04:.058),p.z+held.data.grabOffset.z);else{const nx=THREE.MathUtils.clamp(p.x+held.data.grabOffset.x,-7.7,7.7),nz=THREE.MathUtils.clamp(p.z+held.data.grabOffset.z,-7.2,5.1),blocked=[...this.realism.devices.values()].some(o=>o!==held&&Math.abs(o.group.position.y-held.home.y)<.7&&Math.hypot(nx-o.group.position.x,nz-o.group.position.z)<.48);if(!blocked){held.group.position.x=nx;held.group.position.z=nz;}held.group.position.y=held.home.y;}}
      if(heldCap){lastX=e.clientX;lastY=e.clientY;return;}
      const dx=e.clientX-lastX,dy=e.clientY-lastY;held.group.rotation.z=THREE.MathUtils.clamp(held.group.rotation.z-dx*.012,-1.75,1.75);held.group.rotation.x=THREE.MathUtils.clamp(held.group.rotation.x+dy*.006,-.45,.45);lastX=e.clientX;lastY=e.clientY;
    });
    const release=e=>{if(!held)return;const d=held,wasCap=heldCap;held=null;heldCap=false;this.controls.enabled=true;if(!wasCap)d.group.rotation.x=lerp(d.group.rotation.x,0,.65);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  };
  P.mountRealUI=function(){
    const toolbar=document.querySelector('.camera-tools');if(!toolbar)return;
    const button=document.createElement('button');button.id='freeLabBtn';button.textContent='自由实验台';button.title='操作所有仪器与可动部件';toolbar.prepend(button);button.onclick=()=>this.setFreeMode(!this.realism.free);
    const dock=document.createElement('section');dock.id='realLabDock';dock.className='real-lab-dock hidden';dock.setAttribute('aria-label','仪器操作');this.container.parentElement.appendChild(dock);
    dock.addEventListener('click',e=>{const b=e.target.closest('[data-real-action]');if(b){const id=this.realism.selected;this.realAction(id,b.dataset.realAction);this.inspectReal(id,false);}if(e.target.closest('[data-real-close]'))dock.classList.add('hidden');});
    dock.addEventListener('change',e=>{const field=e.target.dataset.realField,d=this.realism.devices.get(this.realism.selected);if(!field||!d)return;const n=Number(e.target.value);if(!Number.isFinite(n))return;if(field==='rate')d.data.rate=Math.max(0,Math.min(3,n));else if(field==='rpm')d.data.rpm=Math.max(100,Math.min(8000,n));else if(field==='target')d.data.target=Math.max(25,Math.min(180,n));this.realLog(d.name+' 设置 '+field+' = '+n);this.inspectReal(d.id,false);});
    const tray=document.createElement('nav');tray.id='realLabInventory';tray.className='real-lab-inventory hidden';tray.setAttribute('aria-label','实验室器材目录');this.container.parentElement.appendChild(tray);tray.innerHTML='<div class="real-inventory-head"><b>全室器材</b><span>'+this.realism.devices.size+' 件 · 点选查看</span></div><div class="real-inventory-items">'+[...this.realism.devices.values()].map(d=>'<button data-real-device="'+d.id+'">'+esc(d.name)+'</button>').join('')+'</div>';
    tray.addEventListener('click',e=>{const b=e.target.closest('[data-real-device]');if(b)this.inspectReal(b.dataset.realDevice);});
    const guide=document.createElement('div');guide.id='realLabGuide';guide.className='real-lab-guide hidden';guide.innerHTML='<span class="real-guide-dot"></span><div><b>真实结构 · 自由操作</b><span>点击器材或部件 · 拖动环视 · 滚轮靠近 · 从左侧目录查找仪器</span></div>';this.container.parentElement.appendChild(guide);
  };
  P.setFreeMode=function(on){
    this.realism.free=on;document.getElementById('app').classList.toggle('real-free-mode',on);document.getElementById('freeLabBtn').classList.toggle('active',on);document.getElementById('freeLabBtn').textContent=on?'返回教学流程':'自由实验台';
    for(const id of ['realLabInventory','realLabGuide'])document.getElementById(id).classList.toggle('hidden',!on);
    document.getElementById('realLabDock').classList.add('hidden');
    if(on){this.assistOn=false;if(this.assistant)this.assistant.visible=false;this._freeEntered=true;
      const a=this.realism.devices.get('beakerA'),b=this.realism.devices.get('beakerB');if(!a.data.volume)a.data.volume=18;if(!b.data.volume)b.data.volume=12;
      this.overview();
    }else{this.resetFreeRunning();if(window.MOFApp)this.updateFromState(window.MOFApp.getState());this.focusForStep(window.MOFApp?window.MOFApp.getState().step:0);}
    requestAnimationFrame(()=>this.resize());setTimeout(()=>this.resize(),320);
  };
  P.resetFreeRunning=function(){for(const d of this.realism.devices.values()){d.data.on=false;d.data.rate=0;}this.centrifuging=this.stirring=this.sonicating=this.activating=this.vacuumOn=false;this.reactionStarted=false;};
  P.realLog=function(message){this.realism.history.push({timestamp:new Date().toISOString(),message});if(this.realism.history.length>200)this.realism.history.shift();const el=document.getElementById('realLabStatus');if(el)el.textContent=message;};
  P.inspectReal=function(id,focus=true){
    const d=this.realism.devices.get(id);if(!d)return;this.realism.selected=id;if(focus)this.focus(id);
    const h=d.data,btn=(action,label)=>'<button data-real-action="'+action+'">'+label+'</button>',pair=(l,v)=>'<div><dt>'+l+'</dt><dd>'+esc(v)+'</dd></div>';let controls='',info='';
    if(d.type==='balance'){info=pair('净质量',(h.mass-h.tare).toFixed(3)+' g')+pair('防风门',h.left||h.right||h.front?'已开启':'已关闭');controls=btn('door-left','左门')+btn('door-right','右门')+btn('door-front','前门')+btn('tare','去皮')+btn('weigh-add','加样 0.100 g')+btn('weigh-remove','减样 0.010 g')+btn('power',h.on?'关闭电源':'打开电源');}
    else if(['bottle','powder'].includes(d.type)){info=pair('瓶盖',h.capOpen?'已旋开':'密闭')+pair('剩余量',h.volume.toFixed(1)+(h.powder?' g':' mL'));controls=btn('cap',h.capOpen?'拧紧瓶盖':'旋开瓶盖')+btn('take','取到操作区 / 归位')+btn('pour','转移到溶液 A')+btn('pour-b','转移到溶液 B');}
    else if(['beaker','flask','tube'].includes(d.type)){info=pair('液体体积',h.volume.toFixed(2)+' mL')+pair('容量',h.capacity+' mL');controls=btn('take','提起 / 放回')+btn('swirl','摇匀')+btn('fill','加入 5 mL 水')+btn('pour','转移到溶液 A')+btn('pour-b','转移到溶液 B')+btn('empty','倒入废液桶');}
    else if(d.type==='burette'){info=pair('凹液面最低处读数',(50-h.volume).toFixed(2)+' mL')+pair('累计滴定',h.delivered.toFixed(2)+' mL');controls=btn('valve',h.rate?'关闭活塞':'微开活塞')+btn('single-drop','滴加一滴')+btn('half-drop','半滴操作')+btn('refill','补充至 50 mL')+'<label>活塞开度 / 滴速<input aria-label="滴定速度" data-real-field="rate" type="range" min="0" max="3" step="0.05" value="'+h.rate+'"></label>';}
    else if(d.type==='pipette'){info=pair('持液量',h.volume.toFixed(2)+' mL')+pair('量程',h.capacity+' mL');controls=btn('aspirate','从溶液 A 吸液')+btn('dispense','向溶液 B 排液')+btn('tip','装卸吸头 / 提起')+btn('take','取用 / 归位');}
    else if(d.type==='centrifuge'){info=pair('上盖',h.lidOpen?'已开启':'已关闭')+pair('对称配平',h.balanced?'完成':'尚未完成')+pair('转速',Math.round(this.anim.rotorSpeed*(h.rpm||5000))+' rpm');controls=btn('lid',h.lidOpen?'关盖':'开盖')+btn('load','装管并对称配平')+btn('power',h.on?'停止离心':'启动离心')+'<label>目标转速<input aria-label="离心转速" data-real-field="rpm" type="number" min="100" max="8000" step="100" value="'+(h.rpm||5000)+'"></label>';}
    else if(['oven','reactor','stirrer','ultrasonic'].includes(d.type)){info=pair('工作状态',h.on?'运行中':'待机')+pair('温度',(h.temperature||22).toFixed(1)+' °C')+(d.type==='oven'?pair('真空',h.vacuum?'抽气中':'关闭'):'');controls=btn(d.type==='reactor'?'lid':d.type==='ultrasonic'?'lid':'door','开启 / 关闭盖门')+btn('power',h.on?'停止运行':'启动运行');if(d.type==='oven')controls+=btn('vacuum','启停真空泵');if(d.type==='oven'||d.type==='reactor')controls+='<label>设定温度 / °C<input aria-label="设定温度" data-real-field="target" type="number" min="25" max="180" value="'+h.target+'"></label>';}
    else if(d.type==='filter'){info=pair('负压',h.vacuum?'-0.07 MPa':'0 MPa')+pair('滤液',h.volume.toFixed(1)+' mL');controls=btn('funnel','装卸布氏漏斗')+btn('vacuum','启停抽滤')+btn('fill','加悬浊液');}
    else if(d.type==='cabinet'){info=pair('柜门',h.open?'开启':'关闭');controls=btn('door','开启 / 关闭柜门');}
    else if(d.type==='instrument'){info=pair('扫描状态',h.on?'正在扫描':'就绪')+pair('扫描进度',Math.round((h.progress||0)*100)+'%');controls=btn('start','开始 / 停止扫描')+btn('take','样品台进出');}
    else if(d.type==='ph'){info=pair('溶液 pH',(h.ph||7).toFixed(2));controls=btn('measure','电极浸入 / 测量')+btn('calibrate','缓冲液校准');}
    else if(d.type==='gas'){info=pair('阀门',h.on?'开启':'关闭')+pair('出口压力',h.on?'0.20 MPa':'0 MPa');controls=btn('valve','旋转钢瓶阀门');}
    else if(d.type==='rack'){info=pair('器材','独立点选每支玻璃器皿');controls=btn('take','移动 / 归位');}
    else if(['eyewash','shower'].includes(d.type)){info=pair('水流',h.on?'开启':'关闭');controls=btn('power',h.on?'关闭水流':'开启冲洗');}
    else if(d.type==='hood'){info=pair('排风',h.on?'运行':'关闭')+pair('视窗',h.open?'抬起':'安全高度');controls=btn('sash','升降视窗')+btn('power','启停排风');}
    else if(d.type==='waste'){info=pair('分类','含铜重金属废液专用');controls=btn('cap','开关废液桶盖')+btn('take','移动 / 归位');}
    else{info=pair('状态',h.open?'已展开':'归位');controls=btn('open','取用 / 打开')+btn('take','移动 / 归位');}
    const dock=document.getElementById('realLabDock');if(!dock)return;dock.classList.remove('hidden');dock.innerHTML='<header><div><small>INSTRUMENT / '+esc(id.toUpperCase())+'</small><h3>'+esc(d.name)+'</h3></div><button data-real-close aria-label="关闭仪器操作">×</button></header><dl>'+info+'</dl><div class="real-action-grid">'+controls+'</div><p id="realLabStatus" role="status">'+esc(this.realism.history.length?this.realism.history[this.realism.history.length-1].message:'点击模型上的可动部件，或使用以上控制。')+'</p><footer>自由操作练习 · 不计入教学流程评分</footer>';
  };
  P.realAction=function(id,action){
    const d=this.realism.devices.get(id);if(!d)return;const h=d.data,R=this.realism.devices;
    const warn=text=>{this.realLog(text);return false;};
    if(this.realism.jobs.some(j=>j.id===id)&&['take','pour','pour-b','empty'].includes(action))return warn('请等待当前转移操作完成。');
    if(d.type==='balance'){
      if(action.startsWith('door-')){const k=action.slice(5).replace('door-','');h[k]=h[k]?0:1;}
      if(action==='tare')h.tare=h.mass;
      if(action==='weigh-add'){h.mass+=.1;this.dustPuff(d.group.position.x,d.group.position.y+.65,d.group.position.z,0x66a9db);}
      if(action==='weigh-remove')h.mass=Math.max(0,h.mass-.01);if(action==='power')h.on=!h.on;
      this.boat.visible=true;this.boatPowder.visible=h.mass>0;this._powTarget=.02+h.mass*.06;this._balanceTarget=h.on?h.mass-h.tare:0;this._balanceTared=true;
    }else if(['bottle','powder'].includes(d.type)&&action==='cap'){
      if(!h.capOpen){h.capOpen=true;h.cap.userData.detached=true;h.cap.rotation.set(Math.PI,0,0);h.cap.position.set(d.group.position.x+.42,1.31+(d.id==='vial'?.04:.058),d.group.position.z+.18);this.labRoot.add(h.cap);}
      else{const dx=h.cap.position.x-d.group.position.x,dz=h.cap.position.z-d.group.position.z;if(Math.hypot(dx,dz)>.2)return warn('瓶盖未对准瓶口，移动到瓶口上方再拧紧。');h.capOpen=false;h.cap.userData.detached=false;this.labRoot.remove(h.cap);d.group.add(h.cap);h.cap.position.set(0,d.id==='vial'?.32:.86,0);h.cap.rotation.set(0,0,0);}
    }
    else if(['pour','pour-b','empty'].includes(action)){
      const target=action==='empty'?'waste':action==='pour-b'?'beakerB':'beakerA';
      if(id===target)return warn('请选择另一个接收容器。');if(['bottle','powder'].includes(d.type))return warn('抓住瓶身并倾斜出液；倾角不足不会流出。');if(!(h.volume>0))return warn('容器已空。');
      this.transferReal(id,target,Math.min(h.powder?1:5,h.volume));
    }else if(action==='fill'){h.volume=Math.min(h.capacity||100,(h.volume||0)+5);this.sfx.pourLiquid(.5);}
    else if(action==='swirl'){this.realism.jobs.push({id,kind:'swirl',t:0,duration:2,base:d.group.rotation.z});}
    else if(action==='empty')h.volume=0;
    else if(d.type==='burette'){if(action==='valve')h.rate=h.rate?0:.18;if(action==='refill')h.volume=50;if(action==='single-drop'||action==='half-drop'){if(h.dropProgress>0)return warn('上一滴尚未落入接收液。');h.dropVolume=action==='half-drop'?.025:.05;h.dropProgress=.001;}}
    else if(d.type==='pipette'){
      if(action==='aspirate'){const source=R.get('beakerA');const amount=Math.min(h.capacity-h.volume,source.data.volume);h.volume+=amount;source.data.volume-=amount;}
      if(action==='dispense'){const target=R.get('beakerB'),amount=Math.min(h.volume,target.data.capacity-target.data.volume);target.data.volume+=amount;h.volume-=amount;}
      if(action==='tip')h.tip=!h.tip;if(h.fill)h.fill.visible=h.volume>0;
    }else if(d.type==='centrifuge'){
      if(action==='lid'){if(h.on||this.anim.rotorSpeed>.03)return warn('转子尚未停止，上盖联锁保持锁定。');h.lidOpen=!h.lidOpen;}
      if(action==='load'){if(!h.lidOpen)return warn('请先打开上盖再装管。');h.balanced=true;this.loadTubes(8);this.rotorTubes.forEach(o=>{o.tube.visible=true;o.liq.visible=true;});}
      if(action==='power'){if(!h.on&&(h.lidOpen||!h.balanced))return warn('离心前必须完成对称配平并关闭上盖。');h.on=!h.on;}
    }else if(d.type==='oven'||d.type==='reactor'){
      if(action==='door'||action==='lid'){if(h.on||h.temperature>45||h.vacuum)return warn('设备正在运行、带真空或仍有余温，暂不可开盖。');h.open=!h.open;}
      if(action==='power'){if(!h.on&&h.open)return warn('请先关闭并锁紧盖门。');h.on=!h.on;}
      if(action==='vacuum'){if(h.open)return warn('请先关闭箱门再启动真空泵。');h.vacuum=!h.vacuum;}
    }else if(d.type==='filter'){if(action==='funnel'){if(h.vacuum)return warn('请先停止抽滤并解除负压。');h.funnelOpen=!h.funnelOpen;}if(action==='vacuum'){if(h.funnelOpen)return warn('请先装回布氏漏斗。');h.vacuum=!h.vacuum;}}
    else if(d.type==='cabinet'&&(action==='door'||action==='open'))h.open=!h.open;
    else if(d.type==='instrument'){if(action==='start'){h.on=!h.on;h.progress=0;if(h.on)this.runInstrument(id,10000);}}
    else if(d.type==='ph'){if(action==='measure'){h.ph=4.52;h.on=!h.on;this.realism.jobs.push({id,kind:'swirl',t:0,duration:1,base:d.group.rotation.z});}if(action==='calibrate')h.ph=7;}
    else if(d.type==='hood'){if(action==='sash')h.open=!h.open;if(action==='power')h.on=!h.on;}
    else if(d.type==='ultrasonic'){if(action==='lid')h.open=!h.open;if(action==='power')h.on=!h.on;}
    else if(action==='power'||action==='valve'||action==='start')h.on=!h.on;
    else if(action==='open'||action==='cap'||action==='door'||action==='lid')h.open=!h.open;
    if(action==='take'||(d.type==='pipette'&&action==='tip')){
      h.taken=!h.taken;const from=d.group.position.clone(),to=h.taken?from.clone().add(new THREE.Vector3(0,.65,.1)):(h.localHome||d.home).clone();this.realism.jobs.push({id,kind:'move',t:0,duration:.7,from,to});
    }
    this.sfx.tap();this.realLog(d.name+' · '+({cap:'旋转瓶盖',pour:'定量转移',power:'切换运行状态',tare:'天平去皮',valve:'转动阀门',fill:'添加 5 mL',swirl:'摇匀',take:'取用或归位'}[action]||action));
    return true;
  };
  P.transferReal=function(sourceId,targetId,amount){
    const source=this.realism.devices.get(sourceId),target=this.realism.devices.get(targetId);if(!source||!target)return;
    if(target.data.capacity)amount=Math.min(amount,target.data.capacity-target.data.volume);if(amount<=0){this.realLog('接收容器已达到容量。');return;}
    const from=source.group.position.clone(),world=new THREE.Vector3();target.group.getWorldPosition(world);if(source.group.parent!==this.labRoot)source.group.parent.worldToLocal(world);
    const to=world.add(new THREE.Vector3(-.45,1.2,0));
    const stream=new THREE.Mesh(new THREE.CylinderGeometry(.012,.015,.7,12),new THREE.MeshPhysicalMaterial({color:0x45b3d3,transparent:true,opacity:.7,roughness:.08,depthWrite:false}));stream.visible=false;this.labRoot.add(stream);
    this.realism.jobs.push({id:sourceId,kind:'transfer',t:0,duration:3.2,from,to,amount,sent:0,targetId,stream,base:source.group.rotation.z});this.sfx.pourLiquid(1.6);
  };
  P.updateFromState=function(state){oldState.call(this,state);if(this.realism&&this.realism.free)return;};
  P.updateDevices=function(dt,now){
    const R=this.realism;if(!R){oldUpdate.call(this,dt,now);return;}
    if(R.free){
      const a=R.devices.get('balance').data;this.balanceOpen=false;this._balanceTarget=a.on?a.mass-a.tare:0;
      const cent=R.devices.get('centrifuge').data;this.centrifuging=cent.on;this.centrifugeOpen=cent.lidOpen;
      const oven=R.devices.get('oven').data;this.activating=oven.on;this.ovenOpen=oven.open;this.vacuumOn=oven.vacuum;
      const reactor=R.devices.get('reactor').data;this.assemblySealed=!reactor.open;this.reactionStarted=reactor.on;this.reactionCooled=!reactor.on;
      this.stirring=R.devices.get('stirrer').data.on;this.sonicating=R.devices.get('ultrasonic').data.on;const hood=R.devices.get('hood');if(hood)this.hoodActive=hood.data.on;
    }
    oldUpdate.call(this,dt,now);
    if(R.free){
      const h=R.devices.get('balance').data;this.balanceSideDoors[0].position.z=lerp(this.balanceSideDoors[0].position.z,-.03-h.left*.58,Math.min(1,dt*6));this.balanceSideDoors[1].position.z=lerp(this.balanceSideDoors[1].position.z,-.03-h.right*.58,Math.min(1,dt*6));this.balanceDoor.position.x=lerp(this.balanceDoor.position.x,h.front*.66,Math.min(1,dt*6));
      this.balanceSideDoors.forEach(m=>m.material.opacity=1);
      const hood=R.devices.get('hood');if(hood)this.hoodSash.position.y=lerp(this.hoodSash.position.y,hood.data.open?2.35:1.65,Math.min(1,dt*4));
      for(const d of R.devices.values()){
        const h=d.data;
        if(h.cap&&!h.cap.userData.detached){h.cap.position.y=lerp(h.cap.position.y,(d.id==='vial'?.32:.86)+(h.capOpen?.22:0),Math.min(1,dt*5));h.cap.rotation.y=lerp(h.cap.rotation.y,h.capOpen?Math.PI*3:0,Math.min(1,dt*4));}
        if(['bottle','powder'].includes(d.type)){
          const angle=Math.abs(d.group.rotation.z),opening=Math.max(0,Math.min(1,(angle-.62)/.9));
          if(h.capOpen&&opening>0&&h.volume>0){
            const candidates=['beakerA','beakerB','waste'].map(id=>R.devices.get(id)).filter(Boolean),target=candidates.sort((a,b)=>Math.hypot(a.group.position.x-d.group.position.x,a.group.position.z-d.group.position.z)-Math.hypot(b.group.position.x-d.group.position.x,b.group.position.z-d.group.position.z))[0];
            const aligned=target&&Math.hypot(target.group.position.x-d.group.position.x,target.group.position.z-d.group.position.z)<.72,rate=(h.powder?2.4:18)*opening*(angle>1.48?1.8:1),amount=Math.min(h.volume,rate*dt);
            if(aligned){const start=d.group.localToWorld(new THREE.Vector3(0,.83,0)),end=target.group.localToWorld(new THREE.Vector3(0,.72,0)),delta=end.sub(start),length=delta.length();h.flow.visible=length>.05&&length<2;h.flow.position.copy(start.addScaledVector(delta,.5));h.flow.scale.set(1,length,1);h.flow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());}else h.flow.visible=false;
            if(aligned&&target.data.volume!==undefined&&target.data.capacity){const received=Math.min(amount,Math.max(0,target.data.capacity-target.data.volume));h.volume-=amount;target.data.volume+=received;if(received<amount)h.spilled=(h.spilled||0)+(amount-received);}
            else{h.volume-=amount;h.spilled=(h.spilled||0)+amount;}
            if((h.spilled||0)>.05){if(!h.spillMark){h.spillMark=new THREE.Mesh(new THREE.CircleGeometry(.18,32),new THREE.MeshBasicMaterial({color:h.powder?0x8c6a45:0x357d91,transparent:true,opacity:.22,depthWrite:false}));h.spillMark.rotation.x=-Math.PI/2;h.spillMark.position.set(d.group.position.x,1.316,d.group.position.z);this.labRoot.add(h.spillMark);}h.spillMark.scale.setScalar(Math.min(2.5,.35+Math.sqrt(h.spilled)*.12));}
            if(angle>1.48&&this.realism.elapsed-(h.lastSplash||0)>.9){h.lastSplash=this.realism.elapsed;this.realLog(aligned?'倾倒过快，液体飞溅。':'瓶口未对准接收器，液体洒落台面。');}
            if(h.fill&&!h.powder){h.fill.scale.y=Math.max(.001,h.volume/(h.capacity||100));h.fill.position.y=.08+h.fill.scale.y*.23;}
          }else if(h.flow)h.flow.visible=false;
        }
        if(d.type==='burette'){
          const cup=R.devices.get('titration-cup'),open=Math.max(0,Math.min(1,h.rate/3));h.tap.rotation.z=lerp(h.tap.rotation.z,open*Math.PI*.48,Math.min(1,dt*6));let transfer=0;
          if(h.rate>0&&h.rate<=.35){h.dropAccumulator+=dt*h.rate*20;if(h.dropProgress<=0&&h.dropAccumulator>=1){h.dropAccumulator-=1;h.dropProgress=.001;h.dropVolume=.05;} }
          if(h.dropProgress>0){h.dropProgress=Math.min(1,h.dropProgress+dt*2.8);h.drop.visible=true;h.drop.position.y=lerp(.61,.475,h.dropProgress);if(h.dropProgress>=1){transfer=Math.min(h.dropVolume,h.volume,Math.max(0,cup.data.capacity-cup.data.volume));h.dropProgress=0;h.drop.visible=false;}}
          else if(h.rate>.35){const amount=Math.min(h.volume,h.rate*dt);transfer=Math.min(amount,Math.max(0,cup.data.capacity-cup.data.volume));h.stream.material.opacity=lerp(h.stream.material.opacity,.72,Math.min(1,dt*5));if(h.rate>2){const lost=Math.min(h.volume-transfer,amount-transfer);h.volume-=lost;h.spilled=(h.spilled||0)+lost;}}
          h.volume-=transfer;h.delivered+=transfer;cup.data.volume+=transfer;h.liquid.scale.y=Math.max(.001,1.3*h.volume/50);h.liquid.position.y=.25+.65*h.volume/50;h.meniscus.position.y=.25+1.3*h.volume/50;h.stream.visible=h.rate>.35&&h.volume>0&&transfer>0;h.stream.scale.x=h.stream.scale.z=.55+open*.5+Math.sin(now*.02)*.08;
          if(transfer>0){cup.data.ripplePulse=1;cup.data.vessel.ripplePulse=1;}
          if(h.rate>2&&this.realism.elapsed-(h.lastLeakLog||0)>1.5){h.lastLeakLog=this.realism.elapsed;this.realLog('活塞开度过大，液流失控并有液体溅出。');}
        }
        if(h.vessel){const v=h.vessel,ratio=Math.max(0,Math.min(1,h.volume/h.capacity));v.liquid.visible=ratio>0;v.liquid.scale.y=lerp(v.liquid.scale.y,ratio*1.4,Math.min(1,dt*4));v.liquid.position.y=.055+v.liquid.scale.y*.25;v.liquid.material.color.set(d.id==='beakerA'?0x168dc1:d.id==='titration-cup'?0x44bdd9:0x8bb8cb);v.surface.visible=v.liquid.visible;v.surface.position.y=v.liquid.position.y+.25*v.liquid.scale.y;h.stirSpeed=Math.max(0,(h.stirSpeed||0)-dt*1.8);v.vortex.visible=v.liquid.visible&&h.stirSpeed>.25;v.vortex.position.y=v.surface.position.y-.035;v.vortex.scale.setScalar(.35+Math.min(1.2,h.stirSpeed*.16));v.vortex.rotation.y+=dt*(1+h.stirSpeed*3);v.surface.scale.setScalar(1+Math.min(.07,h.stirSpeed*.012));v.ripplePulse=Math.max(0,(v.ripplePulse||0)-dt*1.7);v.ripple.visible=v.liquid.visible&&v.ripplePulse>0;v.ripple.position.y=v.surface.position.y+.004;v.ripple.position.x=.12;v.ripple.scale.setScalar(1+(1-v.ripplePulse)*2.2);v.ripple.material.opacity=v.ripplePulse*.5;if(h.stirSpeed>5&&h.volume>0){const loss=Math.min(h.volume,dt*.22);h.volume-=loss;h.spilled=(h.spilled||0)+loss;if(!h.spillMark){h.spillMark=new THREE.Mesh(new THREE.CircleGeometry(.14,24),new THREE.MeshBasicMaterial({color:0x357d91,transparent:true,opacity:.2,depthWrite:false}));h.spillMark.rotation.x=-Math.PI/2;h.spillMark.position.set(d.group.position.x+.38,1.316,d.group.position.z);this.labRoot.add(h.spillMark);}h.spillMark.scale.setScalar(Math.min(2,.4+Math.sqrt(h.spilled)*.1));}}
        if(h.fill&&!h.powder&&d.type!=='pipette'){h.fill.scale.y=Math.max(.01,h.volume/(d.type==='tube'?6:d.type==='flask'?40:100));h.fill.visible=h.volume>0;}
        if(d.type==='cabinet'&&h.door)h.door.rotation.y=lerp(h.door.rotation.y,h.open?-1.5:0,Math.min(1,dt*4));
        if(d.type==='oven'||d.type==='reactor'){h.temperature=lerp(h.temperature,h.on?h.target:22,Math.min(1,dt*.25));}
        if(d.type==='filter'){h.funnel.position.y=lerp(h.funnel.position.y,h.funnelOpen?1.12:.78,Math.min(1,dt*4));if(h.vacuum)h.volume=Math.min(100,h.volume+dt*.7);}
        if(d.type==='instrument'&&h.on){h.progress=Math.min(1,(h.progress||0)+dt/10);if(h.progress===1){h.on=false;this.realLog(d.name+' 扫描完成');}}
        if(d.type==='ultrasonic')this.ultrasonicLid.position.y=lerp(this.ultrasonicLid.position.y,h.open?1.15:.78,Math.min(1,dt*4));
      }
    }
    for(let i=R.jobs.length-1;i>=0;i--){const j=R.jobs[i],d=R.devices.get(j.id);if(!d)continue;j.t+=dt;const t=Math.min(1,j.t/j.duration),ease=t*t*(3-2*t);
      if(j.kind==='move')d.group.position.lerpVectors(j.from,j.to,ease);
      if(j.kind==='swirl')d.group.rotation.z=j.base+Math.sin(t*Math.PI*6)*.14*Math.sin(t*Math.PI);
      if(j.kind==='transfer'){
        const up=t<.25?t/.25:t>.75?(1-t)/.25:1;d.group.position.lerpVectors(j.from,j.to,Math.max(0,Math.min(1,up)));d.group.rotation.z=j.base-(t>.2&&t<.8?Math.sin((t-.2)/.6*Math.PI)*.9:0);
        const target=R.devices.get(j.targetId);if(t>.3&&t<.7){const sent=Math.min(j.amount-j.sent,j.amount/.4*dt/j.duration);j.sent+=sent;d.data.volume-=sent;if(target.data.volume!==undefined)target.data.volume+=sent;const pos=new THREE.Vector3();target.group.getWorldPosition(pos);j.stream.position.copy(pos).add(new THREE.Vector3(0,.8,0));j.stream.visible=true;}else j.stream.visible=false;
      }
      if(t>=1){if(j.kind==='transfer'){d.group.position.copy(j.from);d.group.rotation.z=j.base;this.labRoot.remove(j.stream);j.stream.geometry.dispose();j.stream.material.dispose();}R.jobs.splice(i,1);}
    }
    R.elapsed+=dt;
    if(R.elapsed-(R.lastPaint||0)>.4){R.lastPaint=R.elapsed;this.updateRealDOM();}
  };
  P.updateRealDOM=function(){
    const label=document.getElementById('fpsLabel');if(label){const info=this.renderer.info;label.dataset.drawCalls=String(info.render.calls);label.dataset.triangles=String(info.render.triangles);label.dataset.quality=this.autoDegraded?'adaptive':'full';label.title=info.render.calls+' draw calls · '+info.render.triangles+' triangles';}
    const dock=document.getElementById('realLabDock');if(this.realism.free&&dock&&!dock.classList.contains('hidden')&&!dock.contains(document.activeElement)){
      const scroll=dock.scrollTop;this.inspectReal(this.realism.selected,false);dock.scrollTop=scroll;
    }
  };
})();
