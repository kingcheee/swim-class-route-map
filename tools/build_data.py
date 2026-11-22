#!/usr/bin/env python3
"""수영반 노선도 — 공공데이터 파일(CP949 CSV) → app/data.js

사용법:
  python3 -I tools/build_data.py <raw 폴더> <app/data.js>

raw 폴더에는 tools/dgk_dl.sh 로 받은 <번호>.bin / <번호>.headers 가 있어야 한다.
  15101610 한국체육산업개발주식회사_올림픽수영장 강좌정보
  15118652 한국체육산업개발주식회사_분당스포츠센터 강좌정보
  15114776 한국체육산업개발주식회사_일산스포츠센터 강좌정보

하는 일
  - 열 이름 어긋남 보정(올림픽·일산 「시작일자/시작일」 칸에 「시작~종료」 범위가 들어 있음)
  - 이상값 제외(시작월 1990-01 · 4025-12)
  - 수영 강습만 남김(자유수영 · 월자유 · 생존수영 학교 단체 · 지상훈련 · 효도반 · 실버반 제외)
  - 강좌명 글자 → 단계(센터별 사전) · 문 표시(분당) · 출생연도 범위
  - 강좌번호로 달별 이력 → 반의 이동 경로 · 신기초 출발 기록
"""
import csv, io, sys, re, json, hashlib, collections, os

RAW, OUT = sys.argv[1], sys.argv[2]

CENTERS = [
    # key, 이름, 번호, 종목열, 월열, 이름열, 시간열, 정원열, 요일열, 대상열, 금액열, 번호열, 갱신 메타
    dict(key='bundang', name='분당올림픽스포츠센터', pk='15118652', sp='종목', mon='수강월', nm='강좌명',
         tm='시작종료시간', cap='정원', dy='수강요일', tg='수강대상', fee='수강료', idk='강좌번호',
         cycle='연간', next='2027-07-20'),
    dict(key='olympic', name='올림픽수영장', pk='15101610', sp='강좌코드명', mon='시작월', nm='강좌명',
         tm='시작종료시간', cap='정원', dy='요일', tg='강습반', fee='강좌금액', idk='강좌번호',
         cycle='연간', next='2027-05-11'),
    dict(key='ilsan', name='일산올림픽스포츠센터', pk='15114776', sp='종목', mon='시작월', nm='강좌명',
         tm='시작종료시간', cap='정원', dy='요일', tg='강습반', fee='금액', idk='강좌번호',
         cycle='연간', next='2027-08-03'),
]

# 단계 역. stroke 는 1차 근거가 있을 때만 적는다.
#  분당: 누리집 「수준별 진도표」(신기초=자유형 1개월차, 기초1=배영 2개월차, 초급=평영 3~5개월차,
#        중급=접영 6~12개월차, 상급=12개월 이상 숙달)
#  일산: 강좌명 괄호의 영법 표기(「기초1(자유형.배영발차기)」「중급1(접영발차기)」…)
#  올림픽: 영법 대응 근거 없음 → 이름 순서만
STATIONS = {
    'bundang': [('신기초', '자유형', 1), ('기초', '배영', 2), ('초급', '평영', 3), ('중급', '접영', 6),
                ('상급', '숙달', 12), ('연수', '', None)],
    'olympic': [('신기초', '', None), ('기초', '', None), ('초급', '', None), ('중급', '', None),
                ('상급', '', None), ('고급', '', None), ('연수', '', None)],
    'ilsan':   [('신기초', '', None), ('기초', '자유형·배영', None), ('초급', '평영', None), ('중급', '접영', None),
                ('교정', '', None), ('연수', '', None), ('마스터', '', None)],
}
# 분당 진도표의 세부 단계 개월차(진도표 원문: 신기초 1, 기초1 2, 초급1 3, 초급2 4, 초급3 5, 중급1 6, 중급2 7, 중급3 8~12, 상급 12+)
BUNDANG_MONTH = {'신기초': 1, '기초1': 2, '기초2': 2, '기초': 2, '초급1': 3, '초급2': 4, '초급3': 5, '초급': 3,
                 '중급1': 6, '중급2': 7, '중급3': 8, '중급': 6, '상급': 12, '상급1': 12, '상급2': 12}

EXCLUDE = re.compile(r'자유수영|월자유|생존수영|지상훈련|효도반|실버반|자유\s*\(|일일')
KID = re.compile(r'어린이|초등|유아|\d{2}\s*년?생?\s*[~～-]\s*\d{2}\s*년생')  # 「13년생이상」은 성인반(13세 이상)이라 아이로 보지 않는다


def sub_stage(n):
    """강좌명 → (역 이름, 세부 단계 표기) — 못 읽으면 (None, None)"""
    s = n.replace(' ', '')
    if '신기초' in s:
        return '신기초', '신기초'
    m = re.search(r'(기초|초급|중급|상급|교정)([1-4A-C])?', s)
    if m:
        return m.group(1), m.group(0)
    for k in ('고급', '연수', '마스터'):
        if k in s:
            return k, k
    return None, None


def doors(n):
    s = n.replace(' ', '')
    out = []
    if re.search(r'결원보충[Xx]', s): out.append('결원보충X')
    if '재등록만' in s: out.append('재등록만')
    if '신규불가' in s or '신규X' in s: out.append('신규불가')
    if '등록불가' in s: out.append('등록불가')
    if '복습' in s: out.append('한 달 더 복습')
    if '신설' in s: out.append('신설')
    if '폐강' in s: out.append('폐강')
    return out


def birth_range(n):
    m = re.search(r'(\d{2})\s*년?생?\s*[~～-]\s*(\d{2})\s*년생', n)
    if m: return f'{m.group(1)}~{m.group(2)}년생'
    m = re.search(r'(\d{2})년생\s*이상', n)
    if m: return f'{m.group(1)}년생 이상'
    return ''


def month_add(ym, k):
    y, m = int(ym[:4]), int(ym[5:7])
    m += k
    while m <= 0: m += 12; y -= 1
    while m > 12: m -= 12; y += 1
    return f'{y:04d}-{m:02d}'


def load(pk):
    b = open(os.path.join(RAW, pk + '.bin'), 'rb').read()
    h = open(os.path.join(RAW, pk + '.headers'), encoding='latin-1').read()
    fm = re.search(r'filename="([^"]+)"', h)
    fname = fm.group(1).encode('latin-1').decode('utf-8', 'ignore') if fm else pk
    return list(csv.DictReader(io.StringIO(b.decode('cp949')))), fname, hashlib.sha256(b).hexdigest()


data = dict(centers={}, built_from=[], order=[c['key'] for c in CENTERS])
for C in CENTERS:
    rows, fname, sha = load(C['pk'])
    base = re.search(r'_(\d{8})\.csv$', fname)
    swim = []
    for r in rows:
        if r[C['sp']].strip() != '수영': continue
        mon = r[C['mon']][:7]
        if not re.match(r'20[12]\d-\d\d', mon): continue  # 1990-01 · 4025-12 제외
        n = r[C['nm']].strip()
        if EXCLUDE.search(n): continue
        swim.append((mon, r))
    months = sorted(set(m for m, _ in swim))
    last = max(months)
    by = collections.defaultdict(dict)
    for mon, r in swim:
        by[r[C['idk']]][mon] = r
    # 기록 마지막 달의 반
    classes = []
    for k, v in by.items():
        if last not in v: continue
        r = v[last]
        n = r[C['nm']].strip()
        st, sub = sub_stage(n)
        tm = r[C['tm']].strip()
        hour = tm[:2]
        hist = []
        for i in range(-11, 1):
            mm = month_add(last, i)
            if mm in v:
                nn = v[mm][C['nm']].strip()
                hist.append([mm, nn, sub_stage(nn)[0]])
        who = '아이' if (KID.search(n) or r[C['tg']].strip() in ('어린이', '청소년', '유아')) else '성인'
        item = dict(id=k, name=n, station=st, sub=sub, hour=hour, time=tm, days=r[C['dy']].strip(),
                    cap=r[C['cap']].strip(), fee=r[C['fee']].strip(), who=who,
                    doors=doors(n) if C['key'] == 'bundang' else [], birth=birth_range(n), hist=hist)
        if C['key'] == 'bundang' and sub in BUNDANG_MONTH:
            item['month_no'] = BUNDANG_MONTH[sub]
        classes.append(item)
    classes.sort(key=lambda x: (x['hour'], x['days'], x['name']))
    # 신기초 출발 기록(번호 재사용 포함: 직전 기록이 신기초가 아닌데 이번 달 신기초)
    dep = collections.defaultdict(lambda: collections.defaultdict(int))
    present = set(months)
    for k, v in by.items():
        prev = None
        for mm in sorted(v):
            st = sub_stage(v[mm][C['nm']])[0]
            if st == '신기초' and prev != '신기초':
                dep[v[mm][C['tm']].strip()[:2]][mm] += 1
            prev = st
    win = [month_add(last, i) for i in range(-23, 1)]
    departures = dict(months=win, present=[m in present for m in win],
                      rows={h: [dep[h].get(m, 0) for m in win] for h in sorted(dep)})
    # 18개월 동일 여부(일산 점검)
    frozen = None
    sigs = {}
    for mm in months:
        sigs[mm] = tuple(sorted((r[C['idk']], r[C['nm']].strip(), r[C['cap']], r[C['fee']]) for m2, r in swim if m2 == mm))
    run = 1; mm = last
    while month_add(mm, -1) in sigs and sigs[month_add(mm, -1)] == sigs[last]:
        run += 1; mm = month_add(mm, -1)
    if run >= 6:
        frozen = dict(since=mm, months=run, classes=len(sigs[last]))
    data['centers'][C['key']] = dict(
        name=C['name'], pk=C['pk'], file=fname, file_date=(base.group(1)[:4] + '-' + base.group(1)[4:6] + '-' + base.group(1)[6:]) if base else '',
        sha256=sha, rows=len(rows), last=last, cycle=C['cycle'], next=C['next'],
        stations=[dict(name=a, stroke=b, month_no=c) for a, b, c in STATIONS[C['key']]],
        classes=classes, departures=departures, frozen=frozen,
        stroke_basis={'bundang': '분당 누리집 「수준별 진도표」', 'ilsan': '강좌명 괄호의 영법 표기',
                      'olympic': ''}[C['key']])
    data['built_from'].append(dict(pk=C['pk'], file=fname, sha256=sha))

js = ('// 자동 생성 — tools/build_data.py. 손으로 고치지 않는다.\n'
      '// 공공데이터포털 파일데이터(한국체육산업개발) 강좌정보 3종을 정리한 값이다.\n'
      'window.SWIM_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(OUT, 'w', encoding='utf-8').write(js)
for k, c in data['centers'].items():
    print(k, c['last'], 'classes', len(c['classes']), 'unparsed', sum(1 for x in c['classes'] if not x['station']),
          'frozen', c['frozen'])
print('bytes', len(js.encode()))
