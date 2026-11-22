수영반 노선도 (팀 어니스)

[화면 보기]
app 폴더의 index.html 을 더블클릭하면 브라우저에서 열립니다. 설치·인터넷 연결이 필요 없습니다.

[데이터 다시 만들기]
1) 공공데이터포털 파일데이터를 받습니다(인증키 불필요)
   bash tools/dgk_dl.sh 15101610 raw   # 올림픽수영장 강좌정보
   bash tools/dgk_dl.sh 15118652 raw   # 분당스포츠센터 강좌정보
   bash tools/dgk_dl.sh 15114776 raw   # 일산스포츠센터 강좌정보
2) python3 -I tools/build_data.py raw app/data.js
