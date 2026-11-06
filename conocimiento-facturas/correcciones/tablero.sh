#!/bin/bash
cd /c/Users/migue/Desktop/Oficiosos/codigo-restaurante/admin-casatomas
for i in 1 2 3; do
  out=$(supabase db query --linked -f ../facturas-conocimiento/correcciones/verificar_tablero.sql -o json 2>&1)
  echo "$out" | grep -q "28P01\|SASL" && { sleep 3; continue; }; break
done
echo "$out" | grep -v Initialising | python -I -X utf8 -c "
import json,sys;s=sys.stdin.read();d=json.loads(s[s.find('{'):]);c=d['rows'][0]['cuadre']
ok=all(str(v[0])==str(v[1]) or (isinstance(v[0],(int,float)) and abs(float(v[0])-float(v[1]))<0.005) for v in c.values())
for k,v in c.items(): print(k, v)
print('CUADRA' if ok else 'NO CUADRA')"
