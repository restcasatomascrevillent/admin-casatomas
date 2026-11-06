#!/bin/bash
# Uso: q.sh "sql"  -> imprime filas como JSON por línea; reintenta si SASL
cd /c/Users/migue/Desktop/Oficiosos/codigo-restaurante/admin-casatomas
for i in 1 2 3 4; do
  out=$(supabase db query --linked "$1" -o json 2>&1)
  if echo "$out" | grep -q "28P01\|SASL"; then sleep 3; continue; fi
  break
done
echo "$out" | python -I -X utf8 -c "
import json,sys
s=sys.stdin.read()
i=s.find('{')
try:
  d=json.loads(s[i:])
  for r in d.get('rows',[]): print(json.dumps(r,ensure_ascii=False))
except Exception as e: print(s)
"
