#!/bin/bash
# usage: dgk_dl.sh <publicDataPk> <outdir>
pk=$1; out=$2; mkdir -p "$out"
J=$(mktemp -d); cj="$J/cj"
page=$(curl -s -c "$cj" -b "$cj" -L -A "Mozilla/5.0" "https://www.data.go.kr/data/$pk/fileData.do")
args=$(echo "$page" | grep -o "fn_fileDataDown('$pk', *'[^']*'" | head -1)
uddi=$(echo "$args" | grep -o "uddi:[^']*")
res=$(curl -s -c "$cj" -b "$cj" -A "Mozilla/5.0" -X POST "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do" \
  --data-urlencode "publicDataDetailPk=$uddi" --data-urlencode "publicDataPk=$pk" --data-urlencode "atchFileId=" --data-urlencode "fileDetailSn=1" --data-urlencode "publicDataTyCode=PR0051" -H "X-Requested-With: XMLHttpRequest" -H "Referer: https://www.data.go.kr/data/$pk/fileData.do")
atch=$(echo "$res" | python3 -I -c "import json,sys; d=json.load(sys.stdin); print(d.get('atchFileId',''), d.get('fileDetailSn',''), (d.get('dataSetFileDetailInfo') or {}).get('dataNm',''), sep='\t')")
IFS=$'\t' read a s n <<< "$atch"
echo "pk=$pk uddi=$uddi atch=$a sn=$s name=$n"
lim=$(curl -s -c "$cj" -b "$cj" -A "Mozilla/5.0" -X POST "https://www.data.go.kr/cmm/cmm/check-limit.json" --data-urlencode "atchFileId=$a" --data-urlencode "fileDetailSn=$s" -H "X-Requested-With: XMLHttpRequest")
echo "limit: $lim"
curl -s -c "$cj" -b "$cj" -L -A "Mozilla/5.0" -D "$out/$pk.headers" -o "$out/$pk.bin" "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$a&fileDetailSn=$s&dataNm=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$n")"
ls -la "$out/$pk.bin"; grep -i "content-disposition\|content-type" "$out/$pk.headers"
rm -rf "$J"
