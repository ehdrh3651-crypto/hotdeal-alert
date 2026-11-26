// 수집 출처 목록. 출처를 추가하기 전에 그 사이트의 robots.txt가 해당 경로를 허용하는지 확인한다.
//
// 2026-11-27 확인 결과
//   사용함: 뽐뿌(뽐뿌게시판·해외뽐뿌 RSS), 루리웹(핫딜 RSS), 어미새(기타정보 RSS),
//           클리앙(알뜰구매 목록 화면), 딜바다(국내·해외 핫딜 목록 화면)
//   제외함: 펨코 핫딜(robots.txt가 /hotdeal 금지), 쿨엔조이(robots.txt가 전체 금지),
//           퀘이사존(robots.txt와 게시판 모두 403으로 접근 거부), 어미새 패션정보(RSS가 비어 있음)
import { parseRss, parseHtmlList, htmlToText } from './lib.mjs';

const RSS_ACCEPT = 'application/rss+xml, application/xml, text/xml';
const HTML_ACCEPT = 'text/html';

function rss(id, name, url) {
  return { id, name, url, accept: RSS_ACCEPT, parse: parseRss };
}

// 클리앙 알뜰구매: 일반 글은 <span class="list_subject" ... title="제목"><a href="/service/board/jirum/번호...">.
// span에는 다른 속성이 섞여 있을 수 있다. 공지는 <a class="list_subject">로 모양이 달라 걸리지 않는다.
// 글 링크는 번호까지만 쓰고 물음표 뒤(검색 조건)는 버린다.
const CLIEN_ROW =
  /<span class="list_subject"[^>]*?\btitle="([^"]*)"[^>]*>\s*<a href="(\/service\/board\/jirum\/\d+)[^"]*"/g;

function clien(id, name) {
  return {
    id,
    name,
    url: 'https://www.clien.net/service/board/jirum',
    accept: HTML_ACCEPT,
    parse: (html) =>
      parseHtmlList(html, CLIEN_ROW, (m) => ({ title: htmlToText(m[1]), link: `https://www.clien.net${m[2]}` })),
  };
}

// 딜바다: <td class="td_subject"> 안의 첫 링크가 글 제목이다. 같은 칸을 벗어나지 않도록 </td> 전까지만 본다.
const DEALBADA_ROW =
  /<td class="td_subject">(?:(?!<\/td>)[\s\S])*?<a href="\/\/www\.dealbada\.com\/bbs\/board\.php\?bo_table=([a-z_]+)&amp;wr_id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

function dealbada(id, name, table) {
  return {
    id,
    name,
    url: `https://www.dealbada.com/bbs/board.php?bo_table=${table}`,
    accept: HTML_ACCEPT,
    parse: (html) =>
      parseHtmlList(html, DEALBADA_ROW, (m) => {
        if (m[1] !== table) return null;
        // 제목 뒤에 붙는 댓글 수 표시(<span>…</span>)는 제목이 아니므로 통째로 뺀다.
        const title = htmlToText(m[3].replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ' '));
        return { title, link: `https://www.dealbada.com/bbs/board.php?bo_table=${table}&wr_id=${m[2]}` };
      }),
  };
}

export const SOURCES = Object.freeze([
  rss('ppomppu', '뽐뿌', 'https://www.ppomppu.co.kr/rss.php?id=ppomppu'),
  rss('ppomppu4', '해외뽐뿌', 'https://www.ppomppu.co.kr/rss.php?id=ppomppu4'),
  rss('ruliweb', '루리웹', 'https://bbs.ruliweb.com/market/board/1020/rss'),
  rss('eomisae_rt', '어미새', 'https://eomisae.co.kr/rt/rss'),
  clien('clien', '클리앙'),
  dealbada('dealbada_domestic', '딜바다', 'deal_domestic'),
  dealbada('dealbada_oversea', '딜바다 해외', 'deal_oversea'),
]);
