import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b921-b922');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(()=>{
  const R=globalThis.GKRecruitDismissDomain,E=globalThis.GKEquipmentLoadoutDomain;if(!R||!E)throw new Error('B921/B922 domains missing');
  const defaults={level:1,stats:{STR:10,VIT:10,AGI:10,DEX:10,INT:10,MND:10,LUK:10},skill_points:0,formation_position:'FRONTLINE'};
  const hire=R.planHire({characters:[],unlocked_type_ids:['TYPE-A'],unlocked_job_ids:['JOB-A'],member_capacity:2,character_defaults:defaults,gold:100,type_id:'TYPE-A',job_id:'JOB-A',name:'E2E',now:'2026-09-13T00:00:00Z',job_exists:id=>id==='JOB-A',issue_character_id:()=> 'C-E2E'});
  const cap=R.planHire({characters:[{id:'C1'},{id:'C2'}],unlocked_type_ids:['TYPE-A'],unlocked_job_ids:['JOB-A'],member_capacity:2,character_defaults:defaults,gold:100,type_id:'TYPE-A',job_id:'JOB-A',name:'Full',now:'2026-09-13T00:00:00Z',job_exists:()=>true,issue_character_id:()=> 'C3'});
  const partyBlock=R.planDismiss({characters:[{id:'C1'}],character_id:'C1',party_ids:['C1'],inventory:{equipment_instances:[],resource_stacks:[]},inventory_capacity:5,equipped_instances:[]});
  const fullBlock=R.planDismiss({characters:[{id:'C1'}],character_id:'C1',party_ids:[],inventory:{equipment_instances:[{instance_id:'I0',equipment_id:'EQ0',owner_id:null}],resource_stacks:[{resource_kind:'MAT',resource_id:'R',count:1}]},inventory_capacity:2,equipped_instances:[{instance_id:'I1',equipment_id:'EQ1',owner_id:'C1'}]});
  const dismiss=R.planDismiss({characters:[{id:'C1'},{id:'C2'}],character_id:'C1',party_ids:[],inventory:{equipment_instances:[],resource_stacks:[]},inventory_capacity:3,equipped_instances:[{instance_id:'I1',equipment_id:'EQ1',owner_id:'C1'}]});

  const defs={SW:{slot:'weapon',required:{STR:10},generation:{base_item_type:'剣'}},SH:{slot:'weapon',required:{STR:5},generation:{base_item_type:'盾'}},BW:{slot:'weapon',required:{STR:30},generation:{base_item_type:'弓'}},QV:{slot:'weapon',required:{},generation:{base_item_type:'矢筒'}},HM:{slot:'head',required:{VIT:5},generation:{base_item_type:'兜'}}};
  const instances=[{instance_id:'I-SW1',equipment_id:'SW',owner_id:'C1'},{instance_id:'I-SW2',equipment_id:'SW',owner_id:'C1'},{instance_id:'I-SH',equipment_id:'SH',owner_id:'C1'},{instance_id:'I-BW',equipment_id:'BW',owner_id:'C1'},{instance_id:'I-QV',equipment_id:'QV',owner_id:'C1'},{instance_id:'I-HM',equipment_id:'HM',owner_id:'C1'}];
  const empty={weapon1:null,weapon2:null,head:null,armor:null,gloves:null,feet:null,amulet:null,ring1:null,ring2:null,belt:null},base={character_id:'C1',stats:{STR:20,VIT:10,AGI:10,DEX:10,INT:10,MND:10,LUK:10},equipment_instances:instances,two_hand_str_multiplier:2,resolve_equipment:id=>defs[id]||null};
  const single=E.resolve({...base,combat_capabilities:[],weapon_style:'single',slots:{...empty,weapon1:'I-SW1'}});
  const two=E.resolve({...base,combat_capabilities:[],weapon_style:'two_hand',slots:{...empty,weapon1:'I-BW',weapon2:'I-BW'}});
  const dualBlocked=E.resolve({...base,combat_capabilities:[],weapon_style:'dual_wield',slots:{...empty,weapon1:'I-SW1',weapon2:'I-SW2'}});
  const dual=E.resolve({...base,combat_capabilities:['DUAL_WIELD'],weapon_style:'dual_wield',slots:{...empty,weapon1:'I-SW1',weapon2:'I-SW2'}});
  const shield=E.resolve({...base,combat_capabilities:[],weapon_style:'weapon_shield',slots:{...empty,weapon1:'I-SW1',weapon2:'I-SH'}});
  const bow=E.resolve({...base,combat_capabilities:[],weapon_style:'bow_quiver',stats:{...base.stats,STR:35},slots:{...empty,weapon1:'I-BW',weapon2:'I-QV'}});
  const duplicateBad=E.resolve({...base,combat_capabilities:['DUAL_WIELD'],weapon_style:'dual_wield',slots:{...empty,weapon1:'I-SW1',weapon2:'I-SW1'}});
  const ownerBad=E.resolve({...base,equipment_instances:[{instance_id:'I-X',equipment_id:'SW',owner_id:'OTHER'}],combat_capabilities:[],weapon_style:'single',slots:{...empty,weapon1:'I-X'}});
  const armorReqBad=E.resolve({...base,stats:{...base.stats,VIT:4},combat_capabilities:[],weapon_style:'single',slots:{...empty,weapon1:'I-SW1',head:'I-HM'}});
  return{hire,cap,partyBlock,fullBlock,dismiss,single,two,dualBlocked,dual,shield,bow,duplicateBad,ownerBad,armorReqBad};
 });
 assert(result.hire.ok&&result.hire.cost_gold===0&&result.hire.gold_after===100&&result.hire.character.id==='C-E2E'&&result.hire.character.level===1,'B921 hire failed',result.hire);assert(result.cap.ok===false&&result.cap.code==='GUILD_MEMBER_CAPACITY_REACHED','B921 capacity guard failed',result.cap);assert(result.partyBlock.ok===false&&result.partyBlock.code==='DISMISS_PARTY_MEMBER','B921 party dismiss guard failed',result.partyBlock);assert(result.fullBlock.ok===false&&result.fullBlock.code==='DISMISS_INVENTORY_FULL','B921 inventory return guard failed',result.fullBlock);assert(result.dismiss.ok&&result.dismiss.next_state.characters.length===1&&result.dismiss.next_state.inventory.equipment_instances[0].owner_id===null,'B921 dismiss/return failed',result.dismiss);
 assert(result.single.ok&&result.single.strikes.length===1&&result.single.strikes[0].instance_id==='I-SW1','B922 single failed',result.single);assert(result.two.ok&&result.two.unique_equipment_instance_ids.length===1&&result.two.strikes.length===1,'B922 two-hand duplicate occupancy failed',result.two);assert(result.dualBlocked.ok===false&&result.dualBlocked.code==='DUAL_WIELD_CAPABILITY_REQUIRED','B922 dual-wield capability guard failed',result.dualBlocked);assert(result.dual.ok&&result.dual.strikes.length===2&&result.dual.strikes[1].hand==='OFF','B922 dual wield failed',result.dual);assert(result.shield.ok&&result.shield.strikes.length===1,'B922 weapon+shield failed',result.shield);assert(result.bow.ok&&result.bow.bow_action_ready===true&&result.bow.strikes[0].equipment_id==='BW','B922 bow+quiver failed',result.bow);assert(result.duplicateBad.ok===false&&result.duplicateBad.code==='DUPLICATE_EQUIPMENT_INSTANCE_ASSIGNMENT','B922 illegal duplicate assignment guard failed',result.duplicateBad);assert(result.ownerBad.ok===false&&result.ownerBad.code==='EQUIPMENT_OWNER_MISMATCH','B922 owner guard failed',result.ownerBad);assert(result.armorReqBad.ok===false&&result.armorReqBad.code==='EQUIPMENT_REQUIREMENTS_NOT_MET','B922 non-weapon requirement guard failed',result.armorReqBad);
 ok=true;await page.screenshot({path:path.join(out,'b921-b922-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b921-b922-failure.png'),fullPage:true})}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await fs.writeFile(path.join(out,'page-errors.log'),pageErrors.join('\n'));await browser.close()}
if(!ok){console.error(failure);process.exit(1)}console.log('B921_B922_DOMAIN_E2E_PASS');
