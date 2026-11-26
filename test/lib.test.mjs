// 실행: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  parseRss,
  extractPrice,
  parseKeywordLine,
  parseKeywords,
  evaluate,
  applyKeywordAction,
  sanitizeState,
  formatWon,
  LIMITS,
} from '../src/lib.mjs';
import { isValidTopic, resolveServer, truncateBytes } from '../src/ntfy.mjs';

test('엔티티 해석은 한 번만 한다', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &quot;e&quot;'), `a & b <c> 'd' "e"`);
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&constructor; &unknown; &#0; &#xD800;'), '&constructor; &unknown; &#0; &#xD800;');
});

test('뽐뿌 형식 RSS를 읽는다', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"><channel><title>뽐뿌게시판</title>
<link>http://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu</link>
<item>
<title>[G마켓] 샤오미 온풍기 Pro (74,850원/무료)</title>
<link>http://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=752120</link>
<description>본문</description>
</item>
<item><title>링크 없는 글</title></item>
<item><title>위험한 링크</title><link>javascript:alert(1)</link></item>
</channel></rss>`;
  assert.deepEqual(parseRss(xml), [
    {
      title: '[G마켓] 샤오미 온풍기 Pro (74,850원/무료)',
      link: 'http://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=752120',
    },
  ]);
});

test('루리웹 형식 RSS와 CDATA 제목을 읽는다', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version='2.0'><channel>
<title>루리웹</title><link>https://bbs.ruliweb.com/market/board/1020</link>
<item>
<title><![CDATA[[지마켓] 토레타 500ml x 24개 & 제로 17,240원]]></title>
<description><![CDATA[<img src="https://example.com/a.webp">]]></description>
<link>https://bbs.ruliweb.com/market/board/1020/read/109409</link>
</item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [
    {
      title: '[지마켓] 토레타 500ml x 24개 & 제로 17,240원',
      link: 'https://bbs.ruliweb.com/market/board/1020/read/109409',
    },
  ]);
});

test('글이 없거나 형식이 다른 본문은 빈 목록', () => {
  assert.deepEqual(parseRss('<html><body>차단됨</body></html>'), []);
  assert.throws(() => parseRss(null), TypeError);
});

test('글 수 상한을 지킨다', () => {
  const one = '<item><title>t</title><link>https://example.com/1</link></item>';
  assert.equal(parseRss(one.repeat(LIMITS.maxItemsPerFeed + 50)).length, LIMITS.maxItemsPerFeed);
});

// 2026-11-26에 실제 RSS에서 가져온 제목들.
const PRICE_CASES = [
  ['[톡딜] 2026 햇밤 칼집약단밤 1kg 외 공주 햇 밤/마카다미아 9,900원~', 9900],
  ['[지마켓] 삼성 비스포크 AI 스팀 울트라 VR90F01AAG 로봇청소기 (1,482,420원/무료)', 1482420],
  ['[지마켓]포항 과메기 10미 20쪽 +야채세트 (16900/0)', 16900],
  ['[옥션] 폴햄 사방스판 면바지 밴딩팬츠(16,490원/3만 무배)', 16490],
  ['[네이버] 퓨어잇 구르미팝 간식 6가지맛 (1,550원/15,500원이상무배)', 1550],
  ['[무신사] 엑스텐드 블랜더보틀 스트라다 인슐레이티드 710ml (블랙/화이트) (16,970원/무료)', 16970],
  ['[배스킨라빈스] 토스페이 결제시 쿼터 50% 할인 9900원(11/27~12/1)', 9900],
  ['젤다의전설 ~꿈꾸는섬 재판매 시작 67,800', 67800],
  ['[플레이샵] PS5 인왕 컬렉션 / 25,800원 / 무배', 25800],
  ['[다이렉트 게임즈] 로스트 저지먼트: 심판받지 않은 기억 스팀키 [7,700]', 7700],
  ['[소프라노] 스위치 캐슬베니아 벨몬트의 저주 (46,000원/3000원)', 46000],
  ['[컴퓨존] [PS5]듀얼센스GTA 6 블랙 한정판 사업자한정 112,900', 112900],
  ['[스팀] 헬다이버즈1 할인 / 일반판 4160원, 디럭스 8360원', 4160],
  ['[네이버페이] 라방 랜덤 5원+15원', 5],
  ['[하이마트] 앤커 20000mAh 87W C타입 일체형(43,610원)', 43610],
  ['[지마켓] 토레타 500ml x 24개 오리지널/제로 택1 17,240원', 17240],
  ['[닌텐도이숍] 모두의 골프 월드 50% 할인 24,480원', 24480],
  ['[스팀] Detroit: Become Human 할인 (4,550원)', 4550],
  ['[겜우리] NS2 닌텐도 스위치 2 본체 셀렉트 원 세트 / 798,000원', 798000],
];

test('실제 제목에서 가격을 읽는다', () => {
  for (const [title, expected] of PRICE_CASES) {
    assert.deepEqual(extractPrice(title), { price: expected, currency: 'KRW' }, title);
  }
});

test('판매가가 아닌 금액과 숫자는 가격으로 읽지 않는다', () => {
  const none = { price: null, currency: null };
  assert.deepEqual(extractPrice('[당근페이] 써브웨이 50% 할인(최대3000원)'), none);
  assert.deepEqual(extractPrice('[다렉] 블프기념 포인트 증정(최소2000p부터)'), none);
  assert.deepEqual(extractPrice('[아마존] 레이져 Kishi V3 Pro/XL (무배, 107.99/135.99)'), none);
  assert.deepEqual(extractPrice('[쿠팡] 물티슈 1,000매 20,000mAh 보조배터리 증정'), none);
  assert.deepEqual(extractPrice('[쿠팡] 오늘만 특가 (2026/11/27)'), none);
  assert.deepEqual(extractPrice('[마트] 배송비 3,000원'), none);
  assert.deepEqual(extractPrice('[마트] 9천원 쿠폰'), none);
  assert.deepEqual(extractPrice('[험블] 험블초이스 연간구독 $114.99'), { price: null, currency: 'FOREIGN' });
});

test('만원·천원 단위와 전각 문자, 할인액 섞인 제목', () => {
  assert.equal(extractPrice('[쿠팡] 갤럭시 버즈3 12만원').price, 120000);
  assert.equal(extractPrice('[쿠팡] 닌텐도 주변기기 3만9천원').price, 39000);
  assert.equal(extractPrice('[쿠팡] 키보드 1.5만원').price, 15000);
  assert.equal(extractPrice('[쿠팡] 양말 （１６，９００원／무료）').price, 16900);
  assert.equal(extractPrice('[11번가] 3000원 할인 쿠폰 적용 15,000원').price, 15000);
  assert.equal(extractPrice('[11번가] 본품 46,000원/3,000원').price, 46000);
});

test('키워드 줄 해석', () => {
  assert.equal(parseKeywordLine(''), null);
  assert.equal(parseKeywordLine('   # 주석'), null);

  const basic = parseKeywordLine('에어팟  프로 | 250,000원').keyword;
  assert.deepEqual(basic.include, ['에어팟', '프로']);
  assert.equal(basic.maxPrice, 250000);
  assert.equal(basic.text, '에어팟 프로 | 250000');
  assert.equal(basic.label, '에어팟 프로 (250,000원 이하)');

  const excluded = parseKeywordLine('AirPods -케이스').keyword;
  assert.deepEqual(excluded.include, ['airpods']);
  assert.deepEqual(excluded.exclude, ['케이스']);
  assert.equal(excluded.maxPrice, null);

  assert.equal(parseKeywordLine('에어팟 | 0').keyword.maxPrice, null);
  assert.equal(parseKeywordLine('에어팟 | 싸게').ok, false);
  assert.equal(parseKeywordLine('에어팟 | 1 | 2').ok, false);
  assert.equal(parseKeywordLine('-케이스').ok, false);
  assert.equal(parseKeywordLine('| 1000').ok, false);
  assert.equal(parseKeywordLine('에어팟 | 99999999999999').ok, false);
  assert.equal(parseKeywordLine('가'.repeat(LIMITS.maxKeywordLength + 1)).ok, false);
});

test('키워드 파일은 잘못된 줄을 건너뛴다', () => {
  const { keywords, errors } = parseKeywords('# 설명\r\n에어팟 프로 | 250000\r\n\r\n이상한 줄 | abc\r\n삼겹살\r\n');
  assert.deepEqual(keywords.map((k) => k.text), ['에어팟 프로 | 250000', '삼겹살']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^4번째 줄/);
});

test('키워드와 가격 조건으로 알림 여부를 정한다', () => {
  const kw = (line) => parseKeywordLine(line).keyword;
  const title = '[11번가] 애플 에어팟 프로 2세대 (249,000원/무료)';

  assert.equal(evaluate(title, [kw('에어팟프로 | 250000')]).hits.length, 1);
  assert.equal(evaluate(title, [kw('에어팟 프로 | 249000')]).hits.length, 1); // 경계값: 같으면 알림
  assert.equal(evaluate(title, [kw('에어팟 프로 | 248999')]).hits.length, 0);
  assert.equal(evaluate(title, [kw('에어팟 프로')]).hits.length, 1);
  assert.equal(evaluate(title, [kw('에어팟 -2세대')]).hits.length, 0);
  assert.equal(evaluate(title, [kw('갤럭시')]).hits.length, 0);
  assert.equal(evaluate('[11번가] APPLE AIRPODS PRO', [kw('airpods pro | 100')]).hits.length, 1); // 가격 미확인이면 알림
  assert.equal(evaluate(title, [kw('에어팟'), kw('애플 | 300000'), kw('갤럭시')]).hits.length, 2);
  assert.equal(evaluate(title, []).hits.length, 0);
});

test('키워드 추가·수정·삭제·목록', () => {
  const start = '# 설명\n\n';
  const added = applyKeywordAction(start, 'add', '에어팟 프로', '250000');
  assert.equal(added.ok, true);
  assert.equal(added.changed, true);
  assert.equal(added.text, '# 설명\n에어팟 프로 | 250000\n');

  const again = applyKeywordAction(added.text, 'add', '프로  에어팟', '250000'); // 단어 순서가 달라도 같은 키워드
  assert.equal(again.changed, false);
  assert.equal(again.ok, true);

  const repriced = applyKeywordAction(added.text, 'add', '에어팟 프로', '0');
  assert.equal(repriced.text, '# 설명\n에어팟 프로\n');

  const second = applyKeywordAction(added.text, 'add', '삼겹살', '');
  assert.equal(second.text, '# 설명\n에어팟 프로 | 250000\n삼겹살\n');
  assert.match(second.message, /현재 2개/);

  const listed = applyKeywordAction(second.text, 'list', '', '');
  assert.equal(listed.changed, false);
  assert.match(listed.message, /키워드 2개/);

  const removed = applyKeywordAction(second.text, 'remove', '에어팟 프로', '');
  assert.equal(removed.text, '# 설명\n삼겹살\n');

  const missing = applyKeywordAction(second.text, 'remove', '갤럭시', '');
  assert.equal(missing.ok, false);
  assert.equal(missing.changed, false);
});

test('잘못된 키워드 입력은 파일을 바꾸지 않는다', () => {
  const start = '삼겹살\n';
  for (const [action, keyword, price] of [
    ['add', '', ''],
    ['add', '   ', '1000'],
    ['add', '# 주석처럼 보이는 입력', ''],
    ['add', '에어팟', '싸게'],
    ['add', '-케이스', ''],
    ['delete', '삼겹살', ''],
    ['add', undefined, undefined],
  ]) {
    const result = applyKeywordAction(start, action, keyword, price);
    assert.equal(result.ok, false, `${action} ${keyword}`);
    assert.equal(result.changed, false);
    assert.equal(result.text, start);
  }
  // 줄바꿈과 구분 기호가 섞인 입력도 한 줄짜리 키워드로만 저장된다.
  const injected = applyKeywordAction(start, 'add', '에어팟\n갤럭시 | 1', '5000');
  assert.equal(injected.text, '삼겹살\n에어팟 갤럭시 1 | 5000\n');
});

test('키워드 개수 상한', () => {
  const full = Array.from({ length: LIMITS.maxKeywords }, (_, i) => `키워드${i}`).join('\n') + '\n';
  const result = applyKeywordAction(full, 'add', '하나더', '');
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
});

test('손상된 상태 파일은 안전한 기본값으로 바꾼다', () => {
  const ids = ['ppomppu', 'ruliweb'];
  const empty = { version: 1, seen: {}, fails: {}, stats: { day: '', runs: 0, checked: 0, alerted: 0, errors: 0, gaps: 0 } };
  for (const bad of [null, undefined, 'x', 42, [], {}]) assert.deepEqual(sanitizeState(bad, ids), empty);

  const raw = JSON.parse(
    '{"seen":{"ppomppu":["a",1,null,"b"],"ruliweb":"x","__proto__":["p"],"other":["o"]},' +
      '"fails":{"ppomppu":2,"ruliweb":-1},"stats":{"day":"2026-11-26","runs":3,"checked":"9","alerted":1.5}}',
  );
  const state = sanitizeState(raw, ids);
  assert.deepEqual(state.seen, { ppomppu: ['a', 'b'] });
  assert.deepEqual(state.fails, { ppomppu: 2 });
  assert.deepEqual(state.stats, { day: '2026-11-26', runs: 3, checked: 0, alerted: 0, errors: 0, gaps: 0 });
  assert.equal(Object.getPrototypeOf(state.seen), Object.prototype);

  const long = { seen: { ppomppu: Array.from({ length: LIMITS.seenPerSource + 10 }, (_, i) => `id${i}`) } };
  const trimmed = sanitizeState(long, ids).seen.ppomppu;
  assert.equal(trimmed.length, LIMITS.seenPerSource);
  assert.equal(trimmed.at(-1), `id${LIMITS.seenPerSource + 9}`);
});

test('ntfy 설정 검증과 메시지 자르기', () => {
  assert.equal(isValidTopic('hotdeal-0123456789abcdef'), true);
  assert.equal(isValidTopic('short'), false);
  assert.equal(isValidTopic('has space 0123456789abc'), false);
  assert.equal(isValidTopic(undefined), false);
  assert.equal(resolveServer(undefined), 'https://ntfy.sh/');
  assert.equal(resolveServer('https://example.com/path'), 'https://example.com/');
  assert.equal(resolveServer('http://example.com'), null);
  assert.equal(resolveServer('not a url'), null);

  assert.equal(truncateBytes('짧은 글', 100), '짧은 글');
  const cut = truncateBytes('가'.repeat(100), 50);
  assert.ok(Buffer.byteLength(cut, 'utf8') <= 50);
  assert.ok(cut.endsWith('…'));
  assert.equal(formatWon(1482420), '1,482,420원');
  assert.equal(formatWon(900), '900원');
});
