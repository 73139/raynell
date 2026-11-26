// Integration checks execute the final inline game script. The product is never modified.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
const body = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const clone = o => JSON.parse(JSON.stringify(o));
const v9 = 'rl-reboot-session-v09';
const v10 = 'rl-reboot-session-v10';
const v11 = 'rl-reboot-session-v11';
const v12 = 'rl-reboot-session-v36'; // Active save key used by gameplay scenarios.
const probe = `globalThis.game={
  constructionBudget,facilityConstructionSteps,constructionBudgetBody,
  facilityProductionPanel,kitSupply,facilitySearchInputs,facilitySearchPlan,facilitySearchMarkup,
  wardTrialView,wardTrialAction,wardTrialPanel,wardSaleNote,
  cashAction,cashBalance,cashCanCredit,
  fieldAppraisal,kitUnitGrams,packMassLabel,
  huntCalculateOdds,huntContainerOdds,catalogFieldMarkup,catalogFieldDisclosure,
  saleObjectiveImpact,saleQuote,saleCommit,exchangeReload,makeBox,barterOffers,barterCommit,kitCapacity,kitSlot,gearDefenseBonus,gearAttackBonus,
  marketCartView,marketCartAdd,marketCartSet,marketCartCheckout,objectiveCartView,objectiveCartApply,
  huntMaterialCases,handleHuntCase, pinBarterHunt,writeBarterHunt,selectHuntDestination,barterHuntView,huntRegions,huntBadge,weatherForecast,
  injuryView,beginInjuryTreatment,cancelInjuryTreatment,
  gearServiceQuote,performGearService,gearStrikeQuote,gearOwned,gearWorn,gearSpec,
  lootGoalView,setLootGoal,selectLootDestination,lootLockView,unlockLootBox,lootBoxIsLocked,
  survivorView,survivorAction,
  campaignView,campaignAction,finaleView,finaleAction,
  presetCurrent,presetPreview,applyPreset,savePreset,presetStock,actionDuration,get presetBook(){return presetBook},
  onboarding:onboardingView, setGuide:setOnboardingMode,
  objective:resolveObjective, pin:setObjectivePin,
  searchOwned:searchPossessions, locateOwned:resolvePossession, renameCase:renameStorageCase,
  cases:STORAGE_CASES,caseMove:caseTransfer,moveBetweenCases,caseAllowed:caseAccepts,
  periods:recurringPeriod, board:recurringBoard, cycleWork:recurringAction, draws:recurringLootFor,
  quests:TRADER_CONTRACTS, contract:contractAction, status:contractStatus, standing:traderStanding, goalLabel:contractGoalLabel,
  traders:MARKET_TRADERS, listed:marketGoods, quote:marketQuote, trade:marketTrade, accepts:marketBuys, get goods(){return GOODS},
  get s(){return snapshot()},get areas(){return FIELD_ZONES},get places(){return LANDMARKS},route:routeDistance,routeProfile,routeStepDuration,routeTimeLabel,journeyTiming,
  readField:raidPage,get w(){return writer},get fee(){return wallet},
  lookup:id=>handleDB({db:"lookup",id}),supply:buyMaterial,
  start:()=>handleRaidAction('start'), ack:()=>handleRaidAction('ack'),
  loadout:handleLoadoutUI,stashAction:handleStash,field:handleField,gear:handleEquipment,build:handleHideout,order:changeOrder,
  tick:updateRaidClock,persist,draw:renderKeep,check:validateBackup,importFile:importSave,
  exportFile:exportSave,shuffle:shuffleExits,condition:id=>exitCondition(exitBy(id)),
  window:trainWindow,settings:backupPanel,unit:kitUnit,stock:stashCount,
  prepare:()=>reconcile(),moveNow:z=>{zone=z},price:id=>GOODS[id][6],
  selectLoot:uid=>{picked={side:'loot',uid,rot:false};handleField({field:'take'})},
  sell:(id,uid)=>{handleStash({stash:'select',id,uid});handleStash({stash:'sell'})},
  level:playerLevel
};`;
const testSource = body.replace(/\}\)\(\);\s*$/, () => probe+'})();');
assert.ok(testSource.includes(probe));
const epoch = 1800000000000;
function boot(saved={},clock={now:epoch},navigator={},hash='',browserWindow={}){
  const storage = saved instanceof Map ? saved : new Map(Object.entries(saved).map(([k,v])=>[k,JSON.stringify(v)]));
  const localStorage = {
    getItem:k=>storage.has(k)?storage.get(k):null,
    setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)
  };
  const elements = new Map();
  function node(k){
    if(!elements.has(k)){const listeners=new Map();elements.set(k,{
      style:{},dataset:{},innerHTML:'',textContent:'',hidden:false,scrollTop:0, isConnected:true,
      classList:{toggle(){},add(){},remove(){}},addEventListener(event,fn){const list=listeners.get(event)||[];list.push(fn);listeners.set(event,list)},
      dispatch(event, payload){for(const fn of listeners.get(event)||[])fn(payload)},setAttribute(){},
      removeAttribute(){},scrollIntoView(){},focus(){},append(){},remove(){},click(){}
    })}
    return elements.get(k);
  }
  const document = {
    querySelector:node,querySelectorAll:()=>[],documentElement:node('html'),
    body:node('body'),addEventListener(){},createElement:k=>node('new '+k)
  };
  let random = 307, lastBlob, fixedRandom=null, randomQueue=[];
  const math = Object.create(Math);math.random=()=>randomQueue.length?randomQueue.shift():fixedRandom??((random=(Math.imul(random,1664525)+1013904223)>>>0)/2**32);
  class ClockDate extends Date{static now(){return clock.now}}
  const c = vm.createContext({
    document,window:{location:{hash},...browserWindow,addEventListener:node('window').addEventListener},navigator,matchMedia:()=>({matches:true}),
    innerWidth:390,innerHeight:844,localStorage,confirm:()=>true,console,crypto:webcrypto,
    setInterval:()=>0,setTimeout:()=>0,clearTimeout(){},Date:ClockDate,Math:math,Blob,
    URL:{createObjectURL(blob){lastBlob=blob;return 'blob:test'},revokeObjectURL(){}}
  });
  vm.runInContext(testSource,c,{filename:'rustline-final.html'});
  const g=c.game;
  function click(dataset){
    const target={dataset,closest(selector){return selector==='button'||(selector==='button[data-stash]'&&dataset.stash)?target:null}};
    node('#inside').dispatch('click',{target});
  }
  return {g,storage,clock,click,element:node,content:()=>node('.content').innerHTML,setRandom:value=>{randomQueue=[];fixedRandom=value},setRolls:(values,fallback=.1)=>{randomQueue=Array.from(values);fixedRandom=fallback}, exportData:async()=>{g.exportFile();return JSON.parse(await lastBlob.text())}};
}
// Seed current-format fixtures with matching physical notes and display balance.
function setTestCash(s,amount){
 s.wallet=amount;
 if(s.version>=29)s.cash={pocket:amount?[{uid:'s-fixture-cash',g:'cr_notes',x:0,y:0,w:1,h:1,amount,revealed:true}]:[]};
}
function valid(g){
 const d={format:'rustline-tc01',session:clone(g.s)};
 assert.equal(g.check(d),true,'the game must accept its own player snapshot');
}
function stamp(b,n){b.clock.now=n;b.g.tick()}
function finish(b){const a=b.g.s.field.action;assert.ok(a,'a timed action is required');stamp(b,a.end)}
function go(b,field,extra={}){b.g.field({field,...extra})}
function move(b,index){
  b.setRandom(0.20);
  go(b,'move',{index});
  while(b.g.s.field.action?.type==='travel-step')finish(b);
  b.setRandom(null);
  assert.equal(b.g.s.raid.zone,index);
}
function extract(b,id='b04'){go(b,'extract',{exit:id});assert.equal(b.g.s.field.action?.type,'extract');finish(b)}
module.exports={setTestCash,assert,boot,clone,epoch,extract,finish,go,move,stamp,v9,v10,v11,v12,valid};
