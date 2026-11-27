// Each short key is permanent. Save files identify a completed commission by its full ID.
const TRADER_CONTRACTS = (() => {
  const outskirts = 0, checkpoint = 1, depot = 2;
  const delivery = (item, target) => ({type: 'delivery', target, item});
  const returns = target => ({type: 'returns', target});
  const normal = target => ({type: 'normal', target});
  const visits = (zone, target) => ({type: 'visits', target, zone});
  const regions = target => ({type: 'regions', target});
  const victories = target => ({type: 'victories', target});
  const searches = (target, zone, landmark) => {
    const goal = {type: 'searches', target};
    if (zone !== undefined) goal.zone = zone;
    if (landmark !== undefined) goal.landmark = landmark;
    return goal;
  };

  // Rows contain a stable key, title, the trader's request, CR, XP and the goals.
  function commissions(trader, tier, rows) {
    return rows.map(([key, title, brief, cr, xp, ...goals]) => ({
      id: trader + '-' + key, trader, tier, title, brief, cr, xp, goals,
      rep: tier === 1 ? 10 : 25
    }));
  }

  return [
    ...commissions('supply', 1, [
      ['first-shift', '첫 배식 당번', '첫 심부름은 쉬워요. 빈손이어도 좋으니 벙커 문이 닫히기 전에 돌아와요. 돌아온 사람 몫부터 밥을 퍼요.', 3000, 15, returns(1)],
      ['spare-flask', '주전자 옆 빈자리', '배식 줄 끝에 마실 물을 따로 두려고 해요. 물통 하나만 저한테 건네줘요.', 3500, 20, delivery('water', 1)],
      ['pantry', '배급소 찬장', '외곽 배급소 식당에 두고 온 게 많아요. 상자나 찬장 한 곳만 끝까지 보고 돌아와요.', 4200, 25, searches(1, outskirts, 3)],
      ['dishcloth', '식판 닦을 천', '마지막 행주가 해졌어요. 깨끗한 부분을 잘라 쓰게 천 조각 하나만 가져다줘요.', 1500, 15, delivery('cloth', 1)],
      ['bus-seat', '버스 막차의 짐', '막차에 못 탄 사람들이 정류장에 짐을 두고 갔대요. 그곳 수색 대상 한 곳만 확인해 줄래요?', 4200, 25, searches(1, outskirts, 1)],
      ['late-supper', '늦은 저녁 한 끼', '야간 근무자는 취사 시간이 지나서 와요. 열자마자 먹을 통조림 한 개를 빼둘게요.', 4500, 20, delivery('food', 1)]
    ]),
    ...commissions('supply', 2, [
      ['bus-rations', '유리창 너머의 도시락', '검문소 대기 차량에 식료품을 실었던 차가 있어요. 차량 행렬의 수색 대상 두 곳을 모두 확인해요.', 13500, 65, searches(2, checkpoint, 6)],
      ['thermos', '야간 배식차', '외곽하고 검문소 사이를 다시 오갈 수 있어야 배식차를 보내죠. 한 출격에서 두 권역을 잇고 차 음료 두 개를 준비해요.', 15000, 70, regions(2), delivery('tea', 2)],
      ['warm-pot', '죽 끓는 동안', '교대조 두 팀이 들어와요. 즉석 죽 두 개를 챙기고, 한 번은 정상 탈출로 돌아와 식사 인원을 알려줘요.', 17000, 75, delivery('rl_09_10', 2), normal(1)]
    ]),
    ...commissions('supply', 3, [
      ['bus-depots', '손님이 끊긴 두 정거장', '폐선 승강장과 검문소 대기 차량을 살펴봐요. 양쪽에 남은 짐을 알아야 장터 수레를 어디로 보낼지 정하죠.', 22000, 100, searches(2, outskirts, 8), searches(2, checkpoint, 6)],
      ['weekend-menu', '다음 교대의 식단표', '이번에는 물도 반찬도 같이 나가요. 물통 두 개와 참치 통조림 두 개를 한 번에 납품해요.', 19500, 95, delivery('water', 2), delivery('rl_09_01', 2)],
      ['warehouse-run', '창고 급식표', '군수 창고 교대원이 늘었어요. 창고의 수색 대상 세 곳을 확인하고 건빵 두 봉지를 갖춰요.', 23000, 105, searches(3, depot), delivery('biscuit', 2)],
      ['rations-circuit', '세 곳을 잇는 배식선', '세 권역을 한 바퀴 돌아올 배식 담당자를 찾고 있어요. 한 번의 출격으로 길을 이어 보고 과일 음료도 두 개 부탁해요.', 27000, 115, regions(3), delivery('juice', 2)]
    ]),
    ...commissions('supply', 4, [
      ['relay-kitchens', '배식소 세 곳의 밤', '배급소 식당, 대기 차량, 중앙 보급동에 남은 물자를 확인해요. 오늘부터 세 곳을 같은 배식 장부로 묶을 거예요.', 46000, 180, searches(2, outskirts, 3), searches(2, checkpoint, 6), searches(2, depot, 0)],
      ['cold-week', '한파 비축분', '배식이 끊기는 날을 대비해야 해요. 전투식량 두 개와 물통 세 개를 모으고 두 차례 정상 탈출을 마치면 비축고를 열게요.', 64000, 215, delivery('ration', 2), delivery('water', 3), normal(2)],
      ['market-bell', '다시 울리는 장터 종', '한 출격에 세 권역을 이을 길을 내줘요. 검문소 세관 검사대도 두 곳 확인하고 통조림 세 개를 보태면 첫 장이 설 거예요.', 57000, 205, regions(3), searches(2, checkpoint, 5), delivery('food', 3)]
    ]),

    ...commissions('medic', 1, [
      ['wash-basin', '손 씻는 자리', '의무실 입구에 세면대를 놨어요. 저한테 비누 한 장만 건네주시겠어요?', 2000, 15, delivery('soap', 1)],
      ['field-clinic', '진료대 아래', '외곽 임시 진료소에 왕진 가방을 놓고 왔어요. 진료소 수색 대상 한 곳을 끝까지 확인하고 돌아와요.', 4300, 25, searches(1, outskirts, 7)],
      ['one-roll', '비어 있는 붕대 걸이', '침상마다 구급 붕대를 걸어 두는데 하나가 비었어요. 한 롤만 납품해 주세요.', 3500, 20, delivery('bandage', 1)],
      ['ward-round', '돌아온 대원', '오늘은 귀환하는 대원 얼굴을 직접 보고 싶어요. 출격을 한 번 마치고 벙커로 돌아와 주세요.', 3000, 15, returns(1)],
      ['gauze-tin', '거즈 통의 바닥', '소독한 거즈를 따로 둘 빈 통을 마련했어요. 멸균 거즈 한 개면 충분해요.', 3200, 20, delivery('gauze', 1)],
      ['tent-survey', '검역소의 접수대', '검문소 검역 천막에 어떤 물자가 남았는지 궁금해요. 그 안의 수색 대상 한 곳을 확인해 주세요.', 5000, 30, searches(1, checkpoint, 1)]
    ]),
    ...commissions('medic', 2, [
      ['clean-tray', '처치대 다시 차리기', '먼지 덮인 기구부터 닦아야 해요. 비누 두 장과 멸균 거즈 두 개를 의무실에 납품해 주세요.', 11000, 60, delivery('soap', 2), delivery('gauze', 2)],
      ['patient-route', '환자 이송로 답사', '환자를 옮길 길을 확인해요. 한 번에 두 권역을 방문해 돌아오고, 외곽 임시 진료소의 수색 대상 두 곳도 살펴주세요.', 16000, 75, regions(2), searches(2, outskirts, 7)],
      ['fracture', '부목 보관함', '부목이 필요하다는 연락이 왔어요. 부목 한 개를 챙겨서 정상 탈출한 뒤 저한테 건네주세요.', 15000, 70, normal(1), delivery('splint', 1)]
    ]),
    ...commissions('medic', 3, [
      ['night-cart', '야간 회진 카트', '두 번의 야간 회진 분량이에요. 정상 탈출 두 번을 기록하고, 카트에 넣을 구급 붕대와 물티슈를 두 개씩 챙겨요.', 29500, 110, normal(2), delivery('bandage', 2), delivery('rl_14_07', 2)],
      ['clean-water', '세척용 식염수', '외곽 빗물 펌프장의 상자를 확인해 수원 상태를 알아봐요. 진료실에서 따로 쓸 생리식염수도 두 개 필요해요.', 31000, 110, searches(2, outskirts, 6), delivery('saline', 2)],
      ['transfer-logs', '빠진 이송 기록', '검역 천막에서 출발한 차량이 배차 사무동에 들렀대요. 두 곳에 남은 수색 대상을 확인해 기록의 빈칸을 채워요.', 23500, 100, searches(2, checkpoint, 1), searches(2, depot, 3)],
      ['rescue-bag', '교대 구조 가방', '다음 구조조 몫으로 정찰 배낭 하나와 압박 붕대 두 개를 모아 주세요. 메고 있는 배낭이면 벗은 뒤 제게 건네주세요.', 27000, 95, delivery('rl10_pack', 1), delivery('rl_11_04', 2)]
    ]),
    ...commissions('medic', 4, [
      ['handover', '세 권역 당직 인계', '한 출격에서 세 권역을 확인할 담당자가 필요해요. 임시 진료소와 검역 천막의 물자도 끝까지 확인해 인계를 마쳐 주세요.', 45500, 185, regions(3), searches(2, outskirts, 7), searches(2, checkpoint, 1)],
      ['ward-open', '두 번째 병상', '병상을 하나 더 펴려면 치료 키트 두 개와 멸균 거즈 세 개가 필요해요. 정상 탈출 두 번을 마치고 의무실로 들러 주세요.', 79000, 220, normal(2), delivery('medkit', 2), delivery('gauze', 3)],
      ['evac-roster', '후송조 편성표', '창고 하역 도크의 두 보관처를 확인해 주세요. 세 번의 정상 귀환과 부목 세 개가 확보되면 정식 후송조를 편성할게요.', 66000, 210, searches(2, depot, 1), normal(3), delivery('splint', 3)]
    ]),

    ...commissions('quarter', 1, [
      ['rollcall', '귀대 점호', '오늘 점호표 첫 칸은 당신 겁니다. 어디든 한 번 출격해서 살아 돌아오면 도장 찍어 드리죠.', 3000, 15, returns(1)],
      ['glove-hook', '작업대 옆 장갑', '운반조가 맨손으로 상자를 나르고 있어요. 제게 작업 장갑 하나를 건네주시면 운반조에 전하겠습니다.', 3000, 20, delivery('rl_14_12', 1)],
      ['first-stock', '외곽 보급소 실사', '장부에만 남은 상자는 필요 없어요. 외곽 보급소에 가서 실제 수색 대상 하나를 열어 끝까지 확인하세요.', 4200, 25, searches(1, outskirts, 0)],
      ['unit-patch', '주인 없는 표식', '보급복에 달 군용 표식이 하나 모자랍니다. 하나 구하면 제게 직접 건네주십시오.', 3800, 20, delivery('patch', 1)],
      ['gate-book', '초소의 인수 장부', '인수 서명이 경비 초소에서 끊겼어요. 초소의 수색 대상 하나를 확인하고 보고해 주세요.', 5000, 30, searches(1, checkpoint, 0)],
      ['dry-socks', '갈아 신을 양말', '물자 하역조의 양말이 몽땅 젖었답니다. 면 양말 한 켤레를 부탁합니다.', 3000, 20, delivery('rl_14_11', 1)]
    ]),
    ...commissions('quarter', 2, [
      ['cargo-bay', '하역 도크 봉인 확인', '군수 창고 하역 도크에서 봉인 대장을 맞춰 봅시다. 도크의 수색 대상 두 곳을 확인한 뒤 돌아오세요.', 15000, 70, searches(2, depot, 1)],
      ['patrol-route', '교대 순찰로', '두 권역을 한 번에 잇는 순찰을 부탁합니다. 검문소에 들렀다 돌아오는 출격도 한 번 기록해 주세요.', 12500, 65, regions(2), visits(checkpoint, 1)],
      ['spare-kit', '예비 운반조', '정찰 배낭과 작업 장갑 한 개씩이면 운반 인원 한 명을 더 세울 수 있어요. 준비되면 제게 건네주세요.', 14500, 65, delivery('rl10_pack', 1), delivery('rl_14_12', 1)]
    ]),
    ...commissions('quarter', 3, [
      ['factory-watch', '화물 구역 경계 근무', '운반조가 나가기 전에 경비 기체 하나를 무력화하고 살아 돌아오세요. 군수 창고 안의 수색 대상 세 곳도 확인합시다.', 29000, 120, victories(1), searches(3, depot)],
      ['return-lot', '반송표 대조', '세관 검사대에서 반송 화물실까지 장부가 맞질 않아요. 두 장소의 수색 대상을 확인해 반송 목록을 맞춰 주세요.', 24500, 105, searches(2, checkpoint, 5), searches(2, depot, 4)],
      ['faceshields', '장비 인수증', '검문소에 두 번 다녀와 현장 인원을 점검한 뒤 B-04 방호 헬멧 두 개를 제게 인계해 주세요.', 31500, 110, visits(checkpoint, 2), delivery('rl12_helmet', 2)],
      ['route-map', '순찰표의 빈 구간', '세 권역을 한 출격에 잇는 순찰표를 새로 짭니다. 외곽 경계 울타리의 수색 대상도 두 곳 확인해 주세요.', 25500, 110, regions(3), searches(2, outskirts, 9)]
    ]),
    ...commissions('quarter', 4, [
      ['convoy', '첫 정기 수송대', '세 권역을 한 번에 돌 길과 호위가 필요합니다. 귀환한 레이드에서 기체를 합계 세 대 무력화하고 정찰 배낭 두 개를 내주세요.', 71000, 220, regions(3), victories(3), delivery('rl10_pack', 2)],
      ['locker-keys', '지하 재고 감사', '지하 적재실과 도로통제 창고 양쪽의 실사를 끝냅시다. 정비실 열쇠 한 개까지 제게 인계하면 감사 장부를 닫겠습니다.', 60500, 195, searches(2, depot, 2), searches(2, checkpoint, 7), delivery('key', 1)],
      ['dock-chain', '봉인 인수함의 두 번째 영수증', '수락한 뒤 방호 조끼·손전등·무전기 중 장비 하나를 하역 도크 인수함에 맡기고 화물 리프트로 생환하십시오. 다음 출격에서 바로 그 장비를 찾아 가방에 넣고 다시 생환하면 인수 시험을 마칩니다. 조기 탈출도 인정합니다. 회수하지 못하거나 두 번째 출격에 실패하면 처음부터 다시 시험해야 합니다. 장비는 대원에게 돌려드립니다. 리프트 배정은 수색 수첩의 도크 관련 세 상자 기록으로 열립니다.', 30000, 120, {type:'dock-cycle',target:2,zone:depot,landmark:1}],
      ['guard-pair', '두 명분의 방호 장비', '교대원 두 명분을 맞춥시다. 방호 조끼 둘과 헬멧 둘을 챙겨서, 정상 탈출 두 차례를 마친 뒤 인계해 주세요.', 75500, 215, normal(2), delivery('rl10_vest', 2), delivery('rl12_helmet', 2)]
    ]),

    ...commissions('repair', 1, [
      ['loose-bolt', '라디오 선반의 흔들림', '선반 다리 하나가 덜컹거려요. 볼트 묶음 하나만 건네주면 오늘 바로 잡을 수 있죠.', 3500, 20, delivery('bolt', 1)],
      ['power-post', '송전탑 점검표', '외곽 송전탑 점검소에서 수색 대상 하나만 끝까지 봐 줘요. 전력반이 뭘 놓고 갔는지 알아야겠어요.', 4300, 25, searches(1, outskirts, 5)],
      ['insulation', '벗겨진 손잡이', '작업등 손잡이를 감을 접착 테이프가 떨어졌네요. 한 롤만 제게 건네줘요.', 2700, 20, delivery('tape', 1)],
      ['first-call', '첫 귀환 신호', '출격을 한 번 마치고 돌아와요. 대원이 귀환하면 울리는 수신기를 처음부터 끝까지 시험해 보게.', 3000, 15, returns(1)],
      ['wire-spool', '빈 전선 실패', '가게 문에 달 호출 벨을 옮겨야 해요. 전선 묶음 하나면 충분해요.', 3900, 20, delivery('wire', 1)],
      ['workshop', '정비막사의 서랍', '외곽 차량 정비막사에 쓰던 물건을 남겨뒀어요. 수색 대상 한 곳만 확인하고 돌아와요.', 4200, 25, searches(1, outskirts, 2)]
    ]),
    ...commissions('repair', 2, [
      ['fuse-board', '두 군데가 끊긴 배선', '송전탑 점검소 안의 두 수색 대상을 확인해 봐요. 돌아올 때 전선 묶음 한 개도 납품해 주세요.', 16500, 70, searches(2, outskirts, 5), delivery('wire', 1)],
      ['fan-mount', '냉각팬 받침대', '팬 날개가 덮개에 긁혀요. 교체용 냉각팬 한 개와 받침에 조일 너트 두 묶음을 부탁해요.', 12500, 65, delivery('fan', 1), delivery('nut', 2)],
      ['control-room', '꺼진 감시 화면', '검문소 감시 통제실에 가 봐요. 거기 있는 수색 대상 두 곳을 열어 보면 어떤 장비가 살아 있는지 알 수 있어요.', 15000, 70, searches(2, checkpoint, 3)]
    ]),
    ...commissions('repair', 3, [
      ['rain-seal', '빗물에 잠긴 단자함', '빗물 펌프장과 도로통제 창고에서 한 곳씩 살펴봐요. 단자함 덮개에 쓸 방수 밀봉재 두 개도 필요해요.', 26500, 105, searches(1, outskirts, 6), searches(1, checkpoint, 7), delivery('seal', 2)],
      ['mains-backup', '정전 대비 배터리함', '배터리 세 개로 비상 전원을 묶으려 해요. 두 권역을 잇는 동선도 한 번 확인해요. 전원 떨어질 때 찾으러 가게요.', 37500, 115, delivery('battery', 3), regions(2)],
      ['relay-board', '중계기 기판 교체', '배차 사무동 장비들이 같은 증상이에요. 현장의 수색 대상 두 곳을 끝까지 살피고 교체용 회로 기판 하나를 가져와요.', 38500, 115, searches(2, depot, 3), delivery('board', 1)],
      ['junction', '분기함 번호표', '세 권역을 한 번에 돌아 선로가 어디서 갈라지는지 확인해요. 감시 통제실에서 수색 대상 하나를 열고 케이블도 하나 마련해요.', 29500, 110, regions(3), searches(1, checkpoint, 3), delivery('cable', 1)]
    ]),
    ...commissions('repair', 4, [
      ['bunker-net', 'B-04 무전망 재개통', '송전탑과 감시 통제실을 두 곳씩 점검해요. 작동하는 무전기 하나까지 제게 넘겨주면 밤 교신을 다시 열죠.', 62000, 205, searches(2, outskirts, 5), searches(2, checkpoint, 3), delivery('radio', 1)],
      ['generator', '발전기 예비 전원', '세 번 정상 귀환할 동안 교대조를 준비할게요. 마지막에 연료통 한 개와 배터리 세 개를 받으면 예비 전원을 올릴 수 있어요.', 87500, 225, normal(3), delivery('fuel', 1), delivery('battery', 3)],
      ['clear-channel', '마지막 무응답 구간', '한 출격 안에 세 권역을 돌고, 군수 창고 수색 대상 다섯 곳을 점검해요. 회로 기판 두 개가 들어오면 마지막 중계소를 깨울 수 있어요.', 82000, 220, regions(3), searches(5, depot), delivery('board', 2)]
    ])
  ];
})();
