// Generates the invented OMP task library (deterministic). Used to build seed-tasks.sql.
// Every reference, title, part number and figure here is invented for the demo.
function genTasks(){
  let seed=20261020;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const half=x=>Math.max(0.5,Math.round(x*2)/2);
  // [ata, system, components[], trade profile M/B1/B2 weights, test set]
  const SYS=[
    ['05','Zonal inspection',['Zone 100 lower fuselage','Zone 200 upper fuselage','Zone 300 empennage','Zone 400 nacelles','Zone 500 LH wing','Zone 600 RH wing','Zone 700 landing gear bays','Zone 800 doors'],[1,.6,0],null],
    ['12','Servicing',['Engine 1 oil','Engine 2 oil','Engine 3 oil','Engine 4 oil','Hydraulic system 1','Hydraulic system 2','MLG shock struts','NLG shock strut','Potable water','Toilet system','Oxygen bottles','Tyre pressures'],[1,.3,0],null],
    ['21','Air conditioning',['Pack 1','Pack 2','Recirculation fan','Cabin pressure controller','Outflow valve','Cargo heating'],[.8,.5,.4],'Pressure test set'],
    ['22','Auto flight',['Autopilot computer','Flight control unit','Autothrust system'],[.1,.2,1],'AFCS test set'],
    ['23','Communications',['VHF 1','VHF 2','HF','SATCOM','Intercom','Cockpit voice recorder'],[.1,0,1],'Radio test set'],
    ['24','Electrical power',['Main battery','APU battery','IDG 1','IDG 2','Static inverter','TRU 1','TRU 2'],[.4,.1,1],'Battery test set'],
    ['25','Equipment / furnishings',['Crew seats','Troop seats','Cargo loading system','Emergency equipment','Galley'],[1,.3,.1],null],
    ['26','Fire protection',['Engine fire detection','APU fire detection','Cargo smoke detection','Fire extinguisher bottles'],[.5,.3,.8],'Fire detection test set'],
    ['27','Flight controls',['LH aileron','RH aileron','Elevators','Rudder','LH flaps','RH flaps','Spoilers','Trim system'],[1,.8,.3],'Rigging kit'],
    ['28','Fuel',['Centre tank','LH inner tank','RH inner tank','LH outer tank','RH outer tank','Refuel panel','Fuel quantity indication'],[1,.6,.4],'Fuel quantity test set'],
    ['29','Hydraulic power',['System 1 pump','System 2 pump','Accumulators','Reservoir','Hydraulic filters'],[1,.6,.1],'Hydraulic test rig'],
    ['30','Ice and rain protection',['Wing de-ice','Engine intake anti-ice','Windshield heat','Wipers','Probe heat'],[.6,.3,.6],null],
    ['31','Indicating / recording',['Flight data recorder','Display units','Warning system','Maintenance computer'],[.1,0,1],'FDR download unit'],
    ['32','Landing gear',['LH MLG','RH MLG','NLG','MLG wheels and brakes','NLG wheels','Steering','Gear doors','Brake control'],[1,.7,.2],'Gear swing kit'],
    ['33','Lights',['Navigation lights','Landing lights','Anti-collision lights','Cabin lighting','Emergency lighting'],[.4,0,.8],null],
    ['34','Navigation',['Pitot static system','Air data computer','Weather radar','Radio altimeter','GPS','TCAS','ILS'],[.2,0,1],'Pitot static test set'],
    ['35','Oxygen',['Crew oxygen','Passenger oxygen','Portable oxygen'],[.8,.4,.2],'O2 trolley'],
    ['36','Pneumatic',['Bleed air valves','Pre-cooler','Pneumatic ducting'],[.8,.6,.2],null],
    ['38','Water / waste',['Water tanks','Waste tank','Drain masts'],[1,.2,0],null],
    ['49','APU',['APU','APU starter','APU inlet door'],[.8,.7,.3],'APU test set'],
    ['51','Structures',['Fuselage frames','Wing lower skin','Cargo floor','Tail cone'],[1,.5,0],null],
    ['52','Doors',['Crew door','Para doors','Cargo ramp','Cargo door','Emergency exits'],[1,.6,.2],null],
    ['53','Fuselage',['Forward fuselage','Centre fuselage','Rear fuselage'],[1,.5,0],null],
    ['55','Stabilisers',['Horizontal stabiliser','Vertical stabiliser'],[1,.6,0],null],
    ['57','Wings',['LH wing box','RH wing box','Leading edges','Wing tips'],[1,.6,0],null],
    ['61','Propellers',['Propeller 1','Propeller 2','Propeller 3','Propeller 4'],[1,.7,.1],'Prop balancing kit'],
    ['71','Power plant',['Engine 1 cowls','Engine 2 cowls','Engine 3 cowls','Engine 4 cowls','Engine mounts'],[1,.6,0],null],
    ['72','Engine',['Engine 1','Engine 2','Engine 3','Engine 4'],[.6,1,0],null],
    ['73','Engine fuel and control',['Engine 1 fuel filter','Engine 2 fuel filter','Engine 3 fuel filter','Engine 4 fuel filter','FADEC'],[1,.6,.4],null],
    ['79','Engine oil',['Engine 1 oil filter','Engine 2 oil filter','Engine 3 oil filter','Engine 4 oil filter','Chip detectors'],[1,.5,0],null],
    ['80','Starting',['Engine starters','Start valves'],[.8,.6,.2],null]
  ];
  // [action, base hours, applies-to predicate, materials?, extra tooling, flags]
  const ACT=[
    ['General visual inspection',1.5,()=>true,false,['Access platform'],{}],
    ['Detailed inspection',3,(a)=>!['23','31','22'].includes(a),false,['Inspection torch and mirror'],{}],
    ['Functional test',2,(a,_,t)=>!!t,false,[],{}],
    ['Operational check',1,(a)=>!['05','51','53','55','57'].includes(a),false,[],{}],
    ['Lubrication',1.5,(a)=>['27','32','52','61','25'].includes(a),true,['Grease gun'],{}],
    ['Filter replacement',1.5,(a,c)=>/filter|Pack|Hydraulic/.test(c),true,['Filter wrench'],{}],
    ['Removal and installation',4,(a)=>['24','27','29','32','35','49','61','71','72','73','80'].includes(a),true,['Torque wrench 200-800 Nm'],{dup:1}],
    ['Leak check',1.5,(a)=>['21','28','29','35','36','38','79'].includes(a),false,['Leak detection kit'],{}],
    ['Corrosion inspection and treatment',4,(a)=>['51','52','53','55','57','32'].includes(a),true,['Paint kit','Extraction unit'],{paint:1,hangar:1}],
    ['Borescope inspection',3,(a)=>['72'].includes(a),false,['Borescope kit'],{hangar:1,dup:1}],
    ['NDT inspection',3,(a)=>['32','51','55','57','61','71'].includes(a),false,['Eddy current set'],{dup:1}],
    ['Servicing',1,(a)=>a==='12',true,['Servicing trolley'],{}]
  ];
  const out=[],seen=new Set();
  SYS.forEach(([ata,sys,comps,w,testSet],si)=>{
    let seq=0;
    comps.forEach((comp,ci)=>{
      ACT.forEach(([act,base,ok,mat,tools,flags],ai)=>{
        if(!ok(ata,comp,testSet))return;
        if(rnd()<0.25)return; // not every combination is a task
        const title=`${comp} — ${act.toLowerCase()}`;
        if(seen.has(title))return;seen.add(title);
        seq++;
        const ref=`OMP-${ata}-${String(5+ai)}${String(ci).padStart(2,'0')}-${String(seq).padStart(2,'0')}`;
        const size=0.7+rnd()*0.9;
        const hrs={};['Mech','B1','B2'].forEach((t,k)=>{const v=base*w[k]*size;hrs[t]=w[k]?half(v):0});
        if(!hrs.Mech&&!hrs.B1&&!hrs.B2)hrs.Mech=0.5;
        const tooling=[...tools];if(act==='Functional test'&&testSet)tooling.push(testSet);
        if(/cowl|Engine \d$|APU$/.test(comp)&&act==='Removal and installation')tooling.push('Mobile crane');
        const materials=[];
        if(mat){const n=1+Math.floor(rnd()*2);for(let i=0;i<n;i++)materials.push({pn:`DEMO-${ata}${pick(['A','B','C','F','G','K','S'])}-${String(1000+Math.floor(rnd()*8999))}`,qty:pick([1,1,1,2,2,4])})}
        const f={...flags};
        if(/wing|Wing|stabiliser|Propeller|Engine|cowl|Tail|tail/.test(comp))f.stand=1;
        if(ata==='28'&&/tank/.test(comp)&&/Detailed|Leak/.test(act)){f.defuel=1;f.hangar=1}
        if(/Mobile crane/.test(tooling.join()))f.crane=1;
        if(ata==='27'&&/Removal|Functional/.test(act))f.dup=1;
        out.push({ref,title,hrs,tooling,materials,flags:f,ind:rnd()>0.08});
      });
    });
  });
  return out;
}
if(typeof module!=='undefined')module.exports=genTasks;
