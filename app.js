// 수영반 노선도 — 화면 배선. 클래식 script(file:// 에서 module 은 죽는다).
// 결정적: Math.random · 지금 날짜 · 네트워크 호출을 쓰지 않는다.
(function () {
  'use strict';
  var D = window.SWIM_DATA;
  if (!D) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px;color:#b4530a">data.js 가 로드되지 않았습니다.</p>');
    return;
  }
  // 기획서 그림용 보기(#fig): 글씨를 키우고 출발 기록을 최근 12개월로 줄인다. 계산은 같다.
  var FIG = /fig/.test(location.hash);
  if (FIG) document.documentElement.className += ' fig';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  var BANDS = [
    { key: 'dawn', label: '새벽 06~08시', hours: ['06', '07', '08'] },
    { key: 'morning', label: '오전 09~12시', hours: ['09', '10', '11', '12'] },
    { key: 'afternoon', label: '오후 13~15시', hours: ['13', '14', '15'] },
    { key: 'kids', label: '오후 16~18시', hours: ['16', '17', '18'] },
    { key: 'evening', label: '저녁 19~21시', hours: ['19', '20', '21'] },
    { key: 'all', label: '전체', hours: null }
  ];
  var DAYS = [
    { key: 'all', label: '전체' }, { key: 'wk', label: '월~금' }, { key: 'mwf', label: '월수금' }, { key: 'tt', label: '화목' }
  ];
  var SHUT = { '결원보충X': 1, '재등록만': 1, '신규불가': 1, '등록불가': 1, '폐강': 1 };
  var S = { center: 'bundang', who: '성인', band: 'evening', days: 'all', station: '초급', shown: false };

  function daysKey(d) {
    var s = d.replace(/\s/g, '');
    if (/월.*화.*수.*목.*금/.test(s) || /월~금/.test(s)) return 'wk';
    if (/^월,?수,?금$/.test(s)) return 'mwf';
    if (/^화,?목$/.test(s)) return 'tt';
    return 'etc';
  }
  function daysLabel(k) { return { wk: '월~금', mwf: '월수금', tt: '화목', etc: '기타' }[k]; }
  function C() { return D.centers[S.center]; }
  function ym(m) { return m.slice(0, 4) + '년 ' + Number(m.slice(5, 7)) + '월'; }

  // ---------- 정직성 배지 · 각주 ----------
  $('fixtureBadge').textContent = '공공데이터 파일을 정리한 값 · 실시간 아님 · 기록 마지막 달 기준';
  $('footNote').textContent = '원자료: 공공데이터포털 「한국체육산업개발주식회사_올림픽수영장·분당스포츠센터·일산스포츠센터 강좌정보」(파일데이터, 연간 갱신). ' +
    '문 표시는 강좌명에 적힌 글자를 그대로 읽은 것이고, 표시가 없다고 자리가 있다는 뜻은 아닙니다. 남은 자리 수는 공개되지 않습니다. 실제 진급은 강사가 정합니다.';

  // ---------- ① 고르기 ----------
  function chip(group, key, label, extra, pressed) {
    return '<button class="chip" data-demo="' + group + '-' + esc(key) + '" data-g="' + group + '" data-k="' + esc(key) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
      esc(label) + (extra ? '<span class="st">' + esc(extra) + '</span>' : '') + '</button>';
  }
  function renderPick() {
    $('chipsCenter').innerHTML = D.order.map(function (k) { return chip('center', k, D.centers[k].name, '', S.center === k); }).join('');
    $('chipsWho').innerHTML = ['성인', '아이'].map(function (k) { return chip('who', k, k === '아이' ? '아이(어린이·청소년)' : '성인', '', S.who === k); }).join('');
    $('chipsBand').innerHTML = BANDS.map(function (b) { return chip('band', b.key, b.label, '', S.band === b.key); }).join('');
    $('chipsDays').innerHTML = DAYS.map(function (d) { return chip('days', d.key, d.label, '', S.days === d.key); }).join('');
    var st = C().stations;
    if (!st.some(function (x) { return x.name === S.station; })) S.station = st[0].name;
    $('chipsStation').innerHTML = st.map(function (x, i) {
      var lab = i === 0 ? '처음이에요 · ' + x.name : x.name;
      return chip('st', x.name, lab, x.stroke ? '(' + x.stroke + ')' : '', S.station === x.name);
    }).join('');
    var basis = C().stroke_basis;
    $('stationHint').textContent = basis
      ? '역 옆 괄호의 영법은 ' + basis + '를 따랐습니다.'
      : '이 센터는 반 이름과 영법을 잇는 공개 자료를 찾지 못해 반 이름 순서대로만 역을 둡니다.';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (b) {
      var g = b.getAttribute('data-g'), k = b.getAttribute('data-k');
      if (g === 'center') S.center = k; else if (g === 'who') S.who = k; else if (g === 'band') S.band = k;
      else if (g === 'days') S.days = k; else if (g === 'st') S.station = k;
      renderPick(); renderDep(); if (S.shown) renderMap();
      return;
    }
    var t = e.target.closest('.train');
    if (t) { showTrain(t.getAttribute('data-id')); return; }
  });
  $('goBtn').addEventListener('click', function () { S.shown = true; renderMap(); });

  // ---------- ② 노선도 ----------
  function filtered() {
    var band = BANDS.filter(function (b) { return b.key === S.band; })[0];
    return C().classes.filter(function (x) {
      if (x.who !== S.who) return false;
      if (band.hours && band.hours.indexOf(x.hour) < 0) return false;
      if (S.days !== 'all' && daysKey(x.days) !== S.days) return false;
      return true;
    });
  }
  function tagsHtml(x) {
    if (S.center !== 'bundang') return '<span class="tag none">이 센터는 강좌명에 표시 안 함</span>';
    if (!x.doors.length) return '<span class="tag none">표시 없음</span>';
    return x.doors.map(function (d) {
      var cls = SHUT[d] ? 'shut' : (d === '신설' ? 'new' : 'redo');
      return '<span class="tag ' + cls + '">' + esc(d) + '</span>';
    }).join('');
  }
  function target() { return C().stations.filter(function (x) { return x.name === S.station; })[0]; }
  function monthsTo(x) {
    var t = target();
    if (S.center !== 'bundang' || !t.month_no || !x.month_no) return null;
    var n = t.month_no - x.month_no;
    return n > 0 ? n : null;
  }
  function shortName(n) { return n.replace(/\((보조풀|메인풀)[^)]*\)/g, '').replace(/\s+/g, ' ').trim(); }
  function trainHtml(x) {
    var n = monthsTo(x);
    return '<button class="train" data-demo="train-' + esc(x.id) + '" data-id="' + esc(x.id) + '"><span class="tn">' + esc(shortName(x.name)) + '</span>' +
      '<span class="meta"> · 정원 ' + esc(x.cap) + '</span><br>' + tagsHtml(x) +
      (n ? '<span class="arrow">진도표대로면 ' + n + '개월 뒤 「' + esc(S.station) + '」 역</span>' : '') + '</button>';
  }
  function renderMap() {
    var c = C(), rows = filtered(), st = c.stations;
    $('mapMonth').textContent = c.name + ' · 기록 마지막 달 ' + ym(c.last);
    $('frozenBanner').hidden = !c.frozen;
    if (c.frozen) $('frozenBanner').textContent = '이 센터의 수영 강좌 기록은 ' + ym(c.frozen.since) + '부터 ' + c.frozen.months +
      '개월 동안 반 ' + c.frozen.classes + '개의 이름·정원·금액이 한 글자도 바뀌지 않았습니다. 갱신이 멈춘 것인지 확인이 필요해 이동 경로를 그리지 않습니다.';
    $('mapEmpty').hidden = rows.length > 0;
    if (!rows.length) $('mapEmpty').textContent = '고른 조건에 맞는 반이 기록에 없습니다. 시간대나 요일을 넓혀 보세요.';
    $('mapWrap').hidden = !rows.length; $('legend').hidden = !rows.length; $('answer').hidden = !rows.length;
    if (!rows.length) { $('panel-map').setAttribute('data-state', 'idle'); return; }
    var lines = {};
    rows.forEach(function (x) { var k = x.hour + '|' + daysKey(x.days); (lines[k] = lines[k] || []).push(x); });
    var keys = Object.keys(lines).sort();
    var hasOff = rows.some(function (x) { return !x.station; });
    var h = '<thead><tr><th class="line">노선(시간·요일)</th>' + st.map(function (s) {
      return '<th class="' + (s.name === S.station ? 'target' : '') + '">' + esc(s.name) + (s.stroke ? '<span class="stk">' + esc(s.stroke) + '</span>' : '') + '</th>';
    }).join('') + (hasOff ? '<th>단계 밖</th>' : '') + '</tr></thead><tbody>';
    keys.forEach(function (k) {
      var p = k.split('|');
      h += '<tr><th class="line">' + p[0] + '시 · ' + daysLabel(p[1]) + '</th>' + st.map(function (s) {
        var here = lines[k].filter(function (x) { return x.station === s.name; });
        return '<td class="' + (s.name === S.station ? 'target' : '') + '">' + here.map(trainHtml).join('') + '</td>';
      }).join('') + (hasOff ? '<td>' + lines[k].filter(function (x) { return !x.station; }).map(trainHtml).join('') + '</td>' : '') + '</tr>';
    });
    $('mapTable').innerHTML = h + '</tbody>';
    $('legend').innerHTML = '칸 하나에 반 하나. 반은 대개 한 달에 한 단계씩 올라갑니다(같은 강좌번호가 달마다 이름을 바꾼 기록). ' +
      '<span class="tag shut">결원보충X</span><span class="tag shut">재등록만</span><span class="tag shut">신규불가</span> 같은 표시는 강좌명에 적힌 글자입니다.';
    // 답
    var at = rows.filter(function (x) { return x.station === S.station; });
    var soon = rows.map(function (x) { return { x: x, n: monthsTo(x) }; }).filter(function (o) { return o.n; })
      .sort(function (a, b) { return a.n - b.n; });
    var a = '<h3>「' + esc(S.station) + '」 역 — ' + ym(c.last) + ' 기록</h3><ul>';
    if (!at.length) a += '<li>이 조건에서 이 역에 선 반이 없습니다.</li>';
    at.forEach(function (x) {
      var shut = x.doors.filter(function (d) { return SHUT[d]; });
      a += '<li>' + esc(shortName(x.name)) + ' — ' + (S.center !== 'bundang' ? '문 표시는 이 센터 강좌명에 적지 않습니다'
        : (shut.length ? '강좌명에 「' + esc(shut.join('·')) + '」' : '강좌명에 표시 없음(자리 여부는 공개되지 않음)')) + '</li>';
    });
    a += '</ul>';
    if (S.center === 'bundang') {
      a += '<h3 style="margin-top:10px">진도표대로 이 역에 닿는 반</h3><ul>';
      if (!soon.length) a += '<li>이 조건에서는 없습니다.</li>';
      soon.slice(0, 6).forEach(function (o) {
        a += '<li>' + esc(shortName(o.x.name)) + ' — ' + o.n + '개월 뒤(분당 수준별 진도표: 한 단계에 한두 달). 그 무렵 반 변경·결원 보충을 노릴 수 있습니다.</li>';
      });
      a += '</ul>';
    } else {
      a += '<p class="small" style="margin:8px 0 0">이 센터는 진도표가 공개되지 않아 몇 달 뒤를 계산하지 않습니다. 반의 지난 경로는 반을 눌러 4번에서 봅니다.</p>';
    }
    if (S.station === st[0].name) a += '<p class="small" style="margin:8px 0 0">처음이라면 입문반이 언제 어느 시간에 열렸는지 3번 표를 보세요.</p>';
    $('answer').innerHTML = a;
    $('panel-map').setAttribute('data-state', 'revealed');
  }

  // ---------- ③ 출발 기록 ----------
  function renderDep() {
    var c = C(), d = c.departures, band = BANDS.filter(function (b) { return b.key === S.band; })[0];
    var hrs = Object.keys(d.rows).sort();
    var k0 = FIG ? d.months.length - 12 : 0;
    d = { months: d.months.slice(k0), present: d.present.slice(k0), rows: (function () { var o = {}; hrs.forEach(function (h) { o[h] = d.rows[h].slice(k0); }); return o; })() };
    $('depNote').textContent = c.name + ' · ' + ym(d.months[0]) + '~' + ym(d.months[d.months.length - 1]);
    var h = '<thead><tr><th>시간</th>' + d.months.map(function (m, i) {
      return '<th>' + (i === 0 || m.slice(5) === '01' ? m.slice(2, 4) + '.' : '') + m.slice(5) + '</th>';
    }).join('') + '<th>' + d.months.length + '개월 중</th></tr></thead><tbody>';
    hrs.forEach(function (hr) {
      var sel = band.hours && band.hours.indexOf(hr) >= 0;
      var cnt = 0, last = '';
      h += '<tr><th>' + hr + '시</th>' + d.rows[hr].map(function (v, i) {
        if (!d.present[i]) return '<td class="gap"></td>';
        if (v) { cnt++; last = d.months[i]; }
        return '<td class="' + (v ? 'hit' : '') + (sel ? ' sel' : '') + '">' + (v || '') + '</td>';
      }).join('') + '<td>' + cnt + '달' + (last ? ' · 최근 ' + last.slice(2).replace('-', '.') : '') + '</td></tr>';
    });
    $('depTable').innerHTML = h + '</tbody>';
  }

  // ---------- ④ 반 하나 ----------
  function showTrain(id) {
    var x = C().classes.filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    $('trainEmpty').hidden = true; $('trainBox').hidden = false;
    var h = '<p><b>' + esc(x.name) + '</b></p><p class="kv">강좌번호 ' + esc(x.id) + ' · ' + esc(x.time) + ' · ' + esc(x.days) +
      ' · 정원 ' + esc(x.cap) + ' · 월 ' + Number(x.fee).toLocaleString('ko-KR') + '원' + (x.birth ? ' · ' + esc(x.birth) : '') + '</p>' +
      '<p class="kv">원자료: ' + esc(C().file) + '</p>' +
      '<table class="hist"><thead><tr><th>달</th><th>그달 강좌명(원문 그대로)</th><th>읽은 역</th></tr></thead><tbody>' +
      x.hist.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2] || '-') + '</td></tr>'; }).join('') +
      '</tbody></table><p class="hint small">역은 강좌명 글자를 규칙으로 읽은 값입니다. 문 표시도 같은 글자에서 읽었습니다.</p>';
    $('trainBox').innerHTML = h;
  }

  // ---------- 데이터 메모 ----------
  (function () {
    var h = '<ul>';
    D.order.forEach(function (k) {
      var c = D.centers[k];
      h += '<li><b>' + esc(c.name) + '</b> — ' + esc(c.file) + ' · ' + c.rows.toLocaleString('ko-KR') + '행 · 기록 마지막 달 ' + ym(c.last) +
        ' · 갱신 「' + c.cycle + '」(차기 등록 예정 ' + c.next + ') · data.go.kr/data/' + c.pk + '/fileData.do · sha256 ' + c.sha256.slice(0, 12) + '…</li>';
    });
    h += '</ul><ul>' +
      '<li>올림픽수영장·일산 파일은 「시작일자」 칸에 「시작~종료」 범위가 들어 있어 열을 바로잡아 읽었습니다. 시작월 1990-01·4025-12 행은 뺐습니다.</li>' +
      '<li>자유수영·월자유·생존수영 학교 단체·지상훈련·효도반·실버반은 노선도에서 뺐습니다.</li>' +
      '<li>분당 영법은 분당올림픽스포츠센터 누리집 「수준별 진도표」(신기초 1개월차 자유형 → 기초1 배영 → 초급1~3 평영 → 중급1~3 접영 → 상급 12개월 이상)를 따랐습니다. 일산은 강좌명 괄호의 영법 표기, 올림픽수영장은 반 이름 순서만 씁니다.</li>' +
      '<li>문 표시(결원보충X·재등록만·신규불가·등록불가·한 달 더 복습·신설·폐강)는 분당 강좌명에만 있습니다.</li>' +
      '<li>이번 달 반 상태(남은 자리)는 파일·오픈API 어디에도 공개되어 있지 않습니다. 강좌 파일이 달마다 갱신되고 「신규 가능 여부·잔여 인원·단계 코드」 칸이 생기면 같은 화면이 이번 달을 보여 줄 수 있습니다.</li>' +
      '</ul>';
    $('memoBody').innerHTML = h;
  })();

  renderPick(); renderDep();
})();
