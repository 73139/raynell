// IDs and ordering also identify offers in active saved periods.
const RECURRING_POOL = (() => {
  const kill = (target, zone) => zone === undefined ? {type:'kill', target} : {type:'kill', target, zone};
  const give = (item, target) => ({type:'delivery', item, target});
  const lists = {};
  function board(cadence, trader, type, rows) {
    const key = [cadence, trader, type].join('-');
    lists[key] = rows.map(([slug, title, brief, baseCR, xp, ...goals]) => ({
      id:key + '-' + slug, cadence, trader, type, title, brief, goals, xp,
      cr:trader === 'supply' ? Math.round(baseCR * 135 / 100) : baseCR
    }));
  }

  board('daily','supply','kill',[
    ['clatter','국솥 뚜껑 소리','배식 차례만 되면 깡통 소리를 듣고 따라오는 기체가 있어요. 하나만 멈춰 줘요.',6500,30,kill(1)],
    ['barrow','빈 수레 귀갓길','오늘 외곽 장터에서 수레가 돌아와요. 길 위를 맴도는 정찰 드론 한 대를 치워 줘요.',8000,35,kill(1,0)],
    ['queue','줄 서는 자리','검문소에서 밥을 기다리는 분들이 또 흩어졌어요. 초소 주변 기체 한 대만 부탁해요.',8500,40,kill(1,1)],
    ['lunch','두 번째 도시락','먼저 떠난 배달원이 두 번이나 쫓겼대요. 오늘 순찰 기체 둘을 멈춰 줘요.',10500,50,kill(2)]
  ]);
  board('daily','supply','delivery',[
    ['tin','교대조 도시락','오늘 늦게 올 두 사람 몫이에요. 통조림 두 개를 내게 건네줘요.',8500,35,give('food',2)],
    ['kettle','주전자 비상분','취사장 수도가 멎었어요. 물통 하나면 주전자부터 채울 수 있어요.',4000,25,give('water',1)],
    ['cup','야간 당번 찻잔','새벽 당번들이 종이컵을 들고 기다려요. 차 음료 두 개만 내 손에 쥐여 줘요.',6500,30,give('tea',2)],
    ['rag','식탁보 덧대기','배식대 모서리에 또 구멍이 났네요. 덧댈 천 두 조각만 부탁해요.',3000,25,give('cloth',2)]
  ]);
  board('weekly','supply','kill',[
    ['cart','일주일치 장터 호송','이번 주엔 외곽으로 세 번 나가요. 수레가 다니는 동안 외곽 드론 세 대를 정리해 줘요.',32000,140,kill(3,0)],
    ['stops','두 곳의 배식 줄','외곽 배식대와 검문소 차단기 앞에 줄이 생겨요. 양쪽에서 기체 두 대씩 처리해 줘요.',45000,190,kill(2,0),kill(2,1)],
    ['supper','마지막 배식차','막차 기사들이 늦은 밤에는 문 열기가 겁난대요. 한 주 동안 기체 다섯 대를 멈춰 줘요.',39000,160,kill(5)],
    ['depot','창고 문 여는 날','창고 당번에게도 따뜻한 걸 보내야죠. 군수 창고 방호 기체 세 대를 정리해 줘요.',44000,185,kill(3,2)]
  ]);
  board('weekly','supply','delivery',[
    ['rice','야간 식권 일곱 장','늦은 교대조의 식사를 미리 떼어 둬야 해요. 즉석 죽 네 개와 차 음료 두 개를 내게 가져와요.',26000,130,give('rl_09_10',4),give('tea',2)],
    ['water','배식차 물통 칸','수도관 교체가 며칠 걸려요. 물통 여섯 개를 받아 두면 취사장 문은 열 수 있어요.',26500,120,give('water',6)],
    ['workers','삶을 수 없는 점심','현장 배식엔 불을 피울 곳이 없대요. 전투식량 두 개와 건빵 세 봉지를 내가 받을게요.',36500,155,give('ration',2),give('biscuit',3)],
    ['parcels','끊긴 버스편','이번 주에는 보따리를 미리 싸 둬야겠어요. 참치 통조림 여섯 개를 가져와요.',28000,135,give('rl_09_01',6)]
  ]);

  board('daily','medic','kill',[
    ['round','왕진 가는 길','외곽 임시 진료소에서 왕진을 부릅니다. 외곽 정찰 드론 한 대를 먼저 멈춰 주세요.',8000,35,kill(1,0)],
    ['stretcher','들것이 멈춘 자리','이송팀이 검문소에서 발이 묶였어요. 검문소 경비 기체 한 대의 가동을 끝내 주세요.',8500,40,kill(1,1)],
    ['night','야간 환자 이송','어느 길을 택하든 경보가 울려요. 운행 중인 경비 기체 한 대를 무력화해 주세요.',6500,30,kill(1)],
    ['quiet','병동의 조용한 밤','오늘은 경보를 덜 듣고 싶다는 환자가 있어요. 순찰 기체 두 대만 멈춰 주세요.',10500,50,kill(2)]
  ]);
  board('daily','medic','delivery',[
    ['gauze','처치 쟁반 두 개','오늘 쓸 멸균 거즈 두 개를 제게 건네주세요. 제가 환자별로 나눠 둘게요.',7000,30,give('gauze',2)],
    ['soap','손 씻는 순서','교대할 때마다 비누가 금세 닳아요. 새 비누 두 장을 가져다주세요.',4200,25,give('soap',2)],
    ['roll','왕진 가방 빈칸','왕진 가방의 붕대를 다 썼어요. 구급 붕대 하나를 제게 채워 주세요.',3800,25,give('bandage',1)],
    ['saline','비어 있는 선반','오늘 받아야 할 생리식염수가 끊겼어요. 한 개만 제게 가져다주세요.',9500,40,give('saline',1)]
  ]);
  board('weekly','medic','kill',[
    ['route','환자 이송로 두 갈래','외곽 길목의 드론 둘과 검문소 경비 기체 하나를 정리해 주세요. 두 길 모두 쓰게 될 거예요.',36000,155,kill(2,0),kill(1,1)],
    ['signal','주간 호출표','새벽에만 환자를 옮기는 건 한계가 있어요. 한 주에 기체 다섯 대를 멈춰 주세요.',39000,160,kill(5)],
    ['crossing','검역소 인계 시간','검문소 교대 시간에 구급차가 들어가야 해요. 그 권역에서 경비 기체 세 대를 처리해 주세요.',39000,165,kill(3,1)],
    ['transfer','창고 의무 인계반','군수 창고로 의무반이 들어갑니다. 창고 방호 기체 둘, 외곽 드론 하나를 무력화해 주세요.',45000,185,kill(2,2),kill(1,0)]
  ]);
  board('weekly','medic','delivery',[
    ['shift','일주일치 처치대','멸균 거즈 네 개와 구급 붕대 세 개를 제게 주세요. 야간과 주간 처치대에 나눠 둘게요.',25000,130,give('gauze',4),give('bandage',3)],
    ['satchel','순회 진료 짐','한 팀이 벙커를 비워요. 치료 키트 두 개를 미리 제게 인계해 주세요.',43500,155,give('medkit',2)],
    ['brace','이송 때 쓸 부목','다음 이송조는 짐을 둘로 나눕니다. 부목 네 개를 제게 건네주세요.',29500,135,give('splint',4)],
    ['clean','검역 천막 보급','검역 천막에 보낼 손 씻을 물자예요. 비누 다섯 장과 생리식염수 두 개를 부탁드려요.',30000,140,give('soap',5),give('saline',2)]
  ]);

  board('daily','quarter','kill',[
    ['gate','첫 교대 경계','첫 교대 차량이 외곽을 통과합니다. 정찰 드론 한 대를 무력화해 주십시오.',8000,35,kill(1,0)],
    ['lock','창고 셔터 점검','셔터를 올리면 방호 기체에 걸립니다. 군수 창고 기체 한 대부터 처리합시다.',9500,45,kill(1,2)],
    ['patrol','밀린 순찰 보고','오늘 순찰표에 비어 있는 칸이 둘입니다. 권역을 가리지 말고 기체 두 대를 처리해 주십시오.',10500,50,kill(2)],
    ['pass','하역조 통행표','하역조 통행 시간이 다가옵니다. 검문소 경비 기체 한 대를 멈춰 주십시오.',8500,40,kill(1,1)]
  ]);
  board('daily','quarter','delivery',[
    ['glove','짝을 맞춘 작업 장갑','새 하역조에 나눌 장갑이 모자랍니다. 작업 장갑 두 개를 제게 인계해 주십시오.',6800,30,give('rl_14_12',2)],
    ['tag','대원 인계 표식','예비 근무자의 인계 표식이 없습니다. 군용 표식 한 개를 제가 받겠습니다.',4200,25,give('patch',1)],
    ['socks','마른 양말 지급','야간부터 비가 샙니다. 근무자 몫으로 면 양말 두 개를 제게 전달해 주십시오.',6800,30,give('rl_14_11',2)],
    ['lamp','야간 창구 조명','야간 창구 등이 끊겼습니다. 휴대용 조명 한 개를 받아 교대조에 넘기겠습니다.',10500,40,give('flash',1)]
  ]);
  board('weekly','quarter','kill',[
    ['rail','주간 하역 일정','열차 하역을 세 차례 잡았습니다. 군수 창고 방호 기체 세 대를 처리해 주십시오.',44000,185,kill(3,2)],
    ['convoy','다음 수송대 편성','검문소와 군수 창고를 연결할 겁니다. 두 권역의 기체 두 대씩을 처리해 주십시오.',51000,205,kill(2,1),kill(2,2)],
    ['sweep','미결 순찰 일지','한 주 동안 경비 기체 여섯 대를 처리해 밀린 순찰 일지를 마감합시다.',46000,190,kill(6)],
    ['north','외곽 교대 통로','예비대는 외곽에서 들어옵니다. 외곽 정찰 드론 네 대를 무력화해 주십시오.',38500,165,kill(4,0)]
  ]);
  board('weekly','quarter','delivery',[
    ['gear','보초 둘의 보호구','두 사람 몫이 필요합니다. B-04 방호 헬멧 두 개와 작업 장갑 두 개를 인계해 주십시오.',26500,135,give('rl12_helmet',2),give('rl_14_12',2)],
    ['packs','교대조 배낭 표찰','다음 교대조에 같은 규격으로 지급하겠습니다. 정찰 배낭 세 개를 제게 주십시오.',33000,145,give('rl10_pack',3)],
    ['lights','순찰등과 표식','순찰등이 세 개, 새 근무자 둘의 군용 표식이 필요합니다. 제게 직접 넘겨주십시오.',40500,150,give('flash',3),give('patch',2)],
    ['pouch','보급 파우치 인수','이번 주 정찰조의 파우치가 낡았습니다. 전술 보급 파우치 두 개를 제가 받겠습니다.',39500,150,give('rl_13_16',2)]
  ]);

  board('daily','repair','kill',[
    ['roof','지붕 안테나 점검','외곽에서 기체가 계속 맴돌면 지붕에 못 올라가요. 정찰 드론 하나만 멈춰 줘요.',8000,35,kill(1,0)],
    ['meter','검문소의 잡음','검문소 쪽에서 기체가 지나갈 때마다 잡음이 납니다. 거기 기체 한 대를 정리해 줘요.',8500,40,kill(1,1)],
    ['press','하역동 변압기','하역동에서 작업하려니 방호 기체가 돌아다녀요. 군수 창고에서 한 대만 부탁해요.',9500,45,kill(1,2)],
    ['tone','끊어지는 호출음','기체 둘이 줄곧 호출음을 가로채요. 오늘 안에 경비 기체 두 대를 멈춰 줘요.',10500,50,kill(2)]
  ]);
  board('daily','repair','delivery',[
    ['spool','빈 실패 두 개','천장에 선을 다시 돌릴 거예요. 전선 묶음 두 개만 내게 건네줘요.',8500,35,give('wire',2)],
    ['bolt','작업등 받침','받침대를 세우려면 볼트가 더 필요해요. 볼트 묶음 한 개를 받아야 시작할 수 있어요.',3800,25,give('bolt',1)],
    ['tape','절연 공사','잡고 일할 손잡이가 다 닳았네요. 접착 테이프 두 롤을 내게 가져다줘요.',5900,30,give('tape',2)],
    ['fan','구형 냉각기','베어링이 닳아 밤새 소리가 났어요. 냉각팬 하나만 가져오면 바꿔 달게요.',5600,30,give('fan',1)]
  ]);
  board('weekly','repair','kill',[
    ['branch','두 갈래 중계선','외곽 점검탑과 검문소 배선을 같이 봐야 해요. 양쪽에서 기체 둘씩을 처리해 줘요.',45000,190,kill(2,0),kill(2,1)],
    ['noise','주간 잡음 기록','기체가 멈출 때마다 간섭이 사라지는지 기록하려고요. 한 주에 다섯 대만 부탁해요.',39000,160,kill(5)],
    ['relay','창고 중계기 야근','창고 안에서 며칠 밤을 새워야 해요. 군수 창고 방호 기체 세 대를 멈춰 줘요.',44000,185,kill(3,2)],
    ['pole','외곽 전봇대 공사','외곽에 남은 전봇대 네 곳을 손볼 겁니다. 공사 기간에 외곽 드론 네 대를 치워 줘요.',38500,165,kill(4,0)]
  ]);
  board('weekly','repair','delivery',[
    ['jack','중계함 결선','통신 케이블 세 개와 전선 두 묶음을 써야 중계함을 닫겠어요. 내게 건네줘요.',29500,140,give('cable',3),give('wire',2)],
    ['boards','부품 맞교환','기판을 둘 다 갈아야 시험이 돼요. 회로 기판 두 개를 가져오면 내 쪽 부품도 내놓죠.',44000,155,give('board',2)],
    ['waterproof','빗물 막는 덮개','다음 비 전에는 점검함을 막아야 해요. 방수 밀봉재 세 개와 너트 세 묶음을 부탁해요.',26500,135,give('seal',3),give('nut',3)],
    ['case','출장 공구함','작업반 둘이 서로 다른 권역으로 나가요. 공구 세트 두 개를 제 손으로 받아 둘게요.',49000,160,give('tool',2)]
  ]);
  return lists;
})();

const REC_LOOT_LABELS = {common:'잡동사니', useful:'보급품', rare:'희귀품', jackpot:'특급품'};
const RECURRING_WEIGHTS = {
  daily:{standard:[60,28,10,2], supply:[48,30,18,4]},
  weekly:{standard:[35,38,22,5], supply:[24,39,28,9]}
};
// The drop grade describes this reward table. Rare and top rows use only DB rare/extremely rare items.
const RECURRING_REWARDS = {
  supply:{common:['matches','cloth','salt','rl_14_25'], useful:['food','coffee','water','ration'],
    rare:['necklace','rl_02_02','rl_02_08','watch'], jackpot:['tiger','gold','celadon','diamond']},
  medic:{common:['soap','rl_14_09','cloth','rl_14_07'], useful:['saline','medkit','splint','rl_11_04'],
    rare:['rl_12_03','rl_12_07','rl_12_10'], jackpot:['scanner','rl_01_09','gold']},
  quarter:{common:['rl_14_12','patch','rl_14_11','rl_14_15'], useful:['rl12_helmet','flash','rl10_vest','rl10_pack'],
    rare:['rl_13_27','rl_17_22','rl_16_24'], jackpot:['keycard','secret','secure']},
  repair:{common:['nut','tape','bolt','matches'], useful:['board','tool','battery','wrench'],
    rare:['meter','rl_04_14','rl_04_20','rl_06_04'], jackpot:['gpu','relay','secure']}
};

function recurringHash(text) {
  let hash = 2166136261;
  for (let i=0; i<text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function recurringOffersFor(cadence, periodKey, traderId) {
  if (!Object.hasOwn(RECURRING_REWARDS,traderId) || !Object.hasOwn(RECURRING_WEIGHTS,cadence) || !Number.isSafeInteger(periodKey)) return [];
  const period = cadence === 'weekly' ? Math.floor((periodKey - 4) / 7) : periodKey;
  return ['kill','delivery'].map(type => {
    const poolKey = [cadence,traderId,type].join('-');
    const pool = RECURRING_POOL[poolKey];
    // Offset each pool's fixed rotation so neighboring periods always issue different work.
    const offset = recurringHash(poolKey) % pool.length;
    const index = ((period + offset) % pool.length + pool.length) % pool.length;
    return pool[index];
  });
}

function recurringLootFor(cadence, traderId, seed) {
  if (!Object.hasOwn(RECURRING_REWARDS,traderId) || !Object.hasOwn(RECURRING_WEIGHTS,cadence)) return [];
  const grades = Object.keys(REC_LOOT_LABELS);
  const weights = RECURRING_WEIGHTS[cadence][traderId === 'supply' ? 'supply' : 'standard'];
  const pool = RECURRING_REWARDS[traderId];
  const drops = [];
  const count = cadence === 'weekly' ? 2 : 1;
  for (let slot=0; slot<count; slot++) {
    const prefix = JSON.stringify([cadence,traderId,String(seed),slot]);
    const roll = recurringHash(prefix + '/grade') / 0x100000000 * 100;
    let index = 0, ceiling = weights[0];
    while (index < grades.length - 1 && roll >= ceiling) ceiling += weights[++index];
    const tier = grades[index], items = pool[tier];
    const id = items[Math.floor(recurringHash(prefix + '/item') / 0x100000000 * items.length)];
    drops.push({id,tier,qty:1});
  }
  return drops;
}
