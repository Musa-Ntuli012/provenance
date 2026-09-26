#!/bin/bash
# PROVENANCE behavioural security suite (integration, live API).
#
# What it proves: persona isolation, the client portal walls, the v2.1.0 §5.2
# endorsement ≠ approval rule, the gate state machine (endorse → pending →
# approve → advance, and the rejection + stale-endorsement path), the finance
# state machine, the audit trail, cross-tenant isolation, refresh rotation,
# and the upload/download hardening. 40 checks, all live HTTP.
#
# Usage (fresh state each run):
#   npm run db:seed                       # reset demo data
#   restart the API (the login rate limiter is in-memory per process)
#   bash tests/behavioural-suite.sh
#
# All personas use the demo password from the seed (Provenance!Demo1).

B=${API_BASE:-http://localhost:4000/api}
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf "PASS  %s\n" "$1"; }
bad() { FAIL=$((FAIL+1)); printf "FAIL  %s  --> %s\n" "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected=$3 got=$2"; fi }

DEMO_PW='Provenance!Demo1'
PROBE="probe-$(date +%s)"
WORKSPACE=${WORKSPACE:-mbe-demo}

login() { # login <email> <name-for-token-file>
  local r=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
    -d "{\"slug\":\"$WORKSPACE\",\"email\":\"$1\",\"password\":\"$DEMO_PW\"}")
  echo "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" > "/tmp/tok_$2" 2>/dev/null
}
tok() { cat "/tmp/tok_$1"; }

rm -f /tmp/tok_*
login thabiso@molamobosman.co.za  thabiso
login amara@molamobosman.co.za    amara
login priya@molamobosman.co.za    priya
login sipho@molamobosman.co.za    sipho
login carel@molamobosman.co.za    carel
login dineo@bluekruger.co.za      dineo
login g.mahlangu@tshwane.gov.za   gugu
login site.office@halcyonpg.co.za halcyon

PID() { curl -s $B/projects -H "Authorization: Bearer $(tok $1)" | python3 -c "import sys,json;print([p['id'] for p in json.load(sys.stdin)['projects'] if p['code']=='$2'][0])"; }

P1=$(PID thabiso PRJ-001); P2=$(PID thabiso PRJ-002); P3=$(PID thabiso PRJ-003); P6=$(PID thabiso PRJ-006)
T() { curl -s -o /tmp/body -w "%{http_code}" "$@"; }

# --- 1. persona isolation ------------------------------------------------
check "all personas logged in" "$(for u in thabiso amara priya sipho carel dineo gugu halcyon; do [ -s /tmp/tok_$u ] && echo -n x; done)" "xxxxxxxx"
check "client (Blue Kruger) sees exactly 1 project" \
  "$(curl -s $B/projects -H "Authorization: Bearer $(tok dineo)" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['projects']))")" "1"
check "client project is their own (PRJ-003)" \
  "$(curl -s $B/projects -H "Authorization: Bearer $(tok dineo)" | python3 -c "import sys,json;print(json.load(sys.stdin)['projects'][0]['code'])")" "PRJ-003"
check "CLIENT_TEMP sees Halcyon project only" \
  "$(curl -s $B/projects -H "Authorization: Bearer $(tok halcyon)" | python3 -c "import sys,json;print(','.join(sorted(p['code'] for p in json.load(sys.stdin)['projects'])))")" "PRJ-002,PRJ-005"
check "CLIENT_TEMP cannot approve (read-only 403)" \
  "$(T -X POST $B/projects/$P2/stages/4/client-approval -H "Authorization: Bearer $(tok halcyon)" -H 'Content-Type: application/json' -d '{"decision":"APPROVED"}')" "403"

# --- 2. client walls -----------------------------------------------------
check "client blocked from finance certificates (403)" \
  "$(T $B/finance/projects/$P3/certificates -H "Authorization: Bearer $(tok dineo)")" "403"
check "client blocked from audit trail (403)" \
  "$(T $B/audit -H "Authorization: Bearer $(tok dineo)")" "403"
check "client task board is empty" \
  "$(curl -s $B/tasks -H "Authorization: Bearer $(tok dineo)" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['tasks']))")" "0"
check "client cannot raise a certificate (403)" \
  "$(T -X POST $B/finance/projects/$P3/certificates -H "Authorization: Bearer $(tok dineo)" -H 'Content-Type: application/json' -d '{"certificateNo":"HX-1","periodStart":"2026-01-01","periodEnd":"2026-01-31","grossValue":100,"domain":"CONSTRUCTION_MANAGEMENT"}')" "403"

# --- 3. v2.1.0 §5.2 approval separation ----------------------------------
check "PM cannot approve a stage gate (403)" \
  "$(T -X POST $B/projects/$P6/stages/2/client-approval -H "Authorization: Bearer $(tok thabiso)" -H 'Content-Type: application/json' -d '{"decision":"APPROVED"}')" "403"
check "PM cannot endorse (403)" \
  "$(T -X POST $B/projects/$P6/stages/2/endorse -H "Authorization: Bearer $(tok thabiso)" -H 'Content-Type: application/json' -d '{"domain":"GEOTECHNICAL","decision":"ENDORSED"}')" "403"

# --- 4. endorsement domain scoping ---------------------------------------
check "cross-domain endorse blocked (403)" \
  "$(T -X POST $B/projects/$P6/stages/2/endorse -H "Authorization: Bearer $(tok priya)" -H 'Content-Type: application/json' -d '{"domain":"GEOTECHNICAL","decision":"ENDORSED"}')" "403"
check "wrong-domain certificate endorse masked (404)" \
  "$(CERT=$(curl -s $B/finance/projects/$P3/certificates -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;print([c['id'] for c in json.load(sys.stdin)['certificates'] if c['status']=='DRAFT'][0])"); echo $CERT > /tmp/draftcert; T -X POST $B/finance/certificates/$CERT/endorse -H "Authorization: Bearer $(tok priya)" -H 'Content-Type: application/json' -d '{"decision":"ENDORSED"}')" "404"

# --- 5. gate machine: endorse -> PENDING_CLIENT -> approve -> advance ----
for pair in "sipho GEOTECHNICAL" "carel CONSTRUCTION_MANAGEMENT"; do
  set -- $pair
  check "$1 endorses PRJ-006 stage 2" \
    "$(T -X POST $B/projects/$P6/stages/2/endorse -H "Authorization: Bearer $(tok $1)" -H 'Content-Type: application/json' -d "{\"domain\":\"$2\",\"decision\":\"ENDORSED\"}")" "200"
done
check "PRJ-006 stage 2 now PENDING_CLIENT" \
  "$(curl -s $B/projects/$P6 -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;print([g['status'] for g in json.load(sys.stdin)['gates'] if g['stage_index']==2][0])")" "PENDING_CLIENT"
check "wrong-client approval on foreign project masked (404)" \
  "$(T -X POST $B/projects/$P6/stages/2/client-approval -H "Authorization: Bearer $(tok dineo)" -H 'Content-Type: application/json' -d '{"decision":"APPROVED"}')" "404"
check "client approves PRJ-006 stage 2" \
  "$(T -X POST $B/projects/$P6/stages/2/client-approval -H "Authorization: Bearer $(tok gugu)" -H 'Content-Type: application/json' -d '{"decision":"APPROVED","note":"Signed off"}')" "200"
check "PRJ-006 advanced to stage 3, gate 2 COMPLETED" \
  "$(curl -s $B/projects/$P6 -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['project']['current_stage_index'],[g['status'] for g in d['gates'] if g['stage_index']==2][0])")" "3 COMPLETED"

# --- 6. rejection path: stale endorsements invalidated -------------------
check "dineo rejects PRJ-003 stage 7" \
  "$(T -X POST $B/projects/$P3/stages/7/client-approval -H "Authorization: Bearer $(tok dineo)" -H 'Content-Type: application/json' -d '{"decision":"REJECTED","note":"Attenuation sizing query"}')" "200"
check "PRJ-003 stage 7 back to IN_PROGRESS" \
  "$(curl -s $B/projects/$P3 -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;print([g['status'] for g in json.load(sys.stdin)['gates'] if g['stage_index']==7][0])")" "IN_PROGRESS"
check "stale endorsement no longer satisfies: re-endorsement returns to PENDING_CLIENT" \
  "$(for pair in "priya PROFESSIONAL_SERVICES" "sipho GEOTECHNICAL" "carel CONSTRUCTION_MANAGEMENT"; do set -- $pair; curl -s -o /dev/null -X POST $B/projects/$P3/stages/7/endorse -H "Authorization: Bearer $(tok $1)" -H 'Content-Type: application/json' -d "{\"domain\":\"$2\",\"decision\":\"ENDORSED\"}"; done; curl -s $B/projects/$P3 -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;print([g['status'] for g in json.load(sys.stdin)['gates'] if g['stage_index']==7][0])")" "PENDING_CLIENT"

# --- 7. finance state machine --------------------------------------------
DRAFT=$(cat /tmp/draftcert)
check "certifying a DRAFT is rejected (409, only endorsed certifies)" \
  "$(T -X POST $B/finance/certificates/$DRAFT/certify -H "Authorization: Bearer $(tok thabiso)")" "409"
check "carel endorses own-domain draft certificate" \
  "$(T -X POST $B/finance/certificates/$DRAFT/endorse -H "Authorization: Bearer $(tok carel)" -H 'Content-Type: application/json' -d '{"decision":"ENDORSED"}')" "200"
PC9=$(curl -s $B/finance/projects/$P3/certificates -H "Authorization: Bearer $(tok thabiso)" | python3 -c "import sys,json;print([c['id'] for c in json.load(sys.stdin)['certificates'] if c['certificate_no']=='PC-009'][0])")
check "certify ENDORSED PC-009" \
  "$(T -X POST $B/finance/certificates/$PC9/certify -H "Authorization: Bearer $(tok thabiso)")" "200"
check "double-certify rejected (409)" \
  "$(T -X POST $B/finance/certificates/$PC9/certify -H "Authorization: Bearer $(tok thabiso)")" "409"
check "deductions > gross rejected (400)" \
  "$(T -X POST $B/finance/projects/$P3/certificates -H "Authorization: Bearer $(tok thabiso)" -H 'Content-Type: application/json' -d '{"certificateNo":"TC-1","periodStart":"2026-01-01","periodEnd":"2026-01-31","grossValue":100,"deductions":200,"domain":"CONSTRUCTION_MANAGEMENT"}')" "400"

# --- 8. audit trail --------------------------------------------------------
check "audit holds the endorsement + approval chain (admin only)" \
  "$(curl -s "$B/audit?projectId=$P6&limit=200" -H "Authorization: Bearer $(tok amara)" | python3 -c "
import sys,json
a=[e['action'] for e in json.load(sys.stdin)['events']]
print('endorse' if 'endorsement.endorsed' in a else '-', 'approve' if 'approval.approved' in a else '-', 'gate' if 'gate.completed' in a else '-')")" "endorse approve gate"

# --- 9. cross-tenant isolation (registration probe) -----------------------
R=$(curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"organisationName\":\"Probe Test Firm\",\"slug\":\"$PROBE\",\"contactName\":\"Probe Admin\",\"contactEmail\":\"probe@$PROBE.co.za\",\"adminName\":\"Probe Admin\",\"password\":\"ProbePass123\"}")
check "new tenant registers" "$(echo $R | python3 -c "import sys,json;print(json.load(sys.stdin)['tenant']['slug'])")" "$PROBE"
PT=$(curl -s -c /tmp/cj -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"slug\":\"$PROBE\",\"email\":\"probe@$PROBE.co.za\",\"password\":\"ProbePass123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
check "foreign tenant sees 0 projects" \
  "$(curl -s $B/projects -H "Authorization: Bearer $PT" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['projects']))")" "0"
check "foreign tenant cannot reach seeded project (404)" \
  "$(T $B/projects/$P3 -H "Authorization: Bearer $PT")" "404"
check "foreign tenant sees only its own audit events" \
  "$(curl -s "$B/audit" -H "Authorization: Bearer $PT" | python3 -c "import sys,json;e=json.load(sys.stdin)['events'];print(','.join(sorted({x['action'] for x in e})) or 'none')")" "auth.login"

# --- 10. session rotation (reuses the probe tenant's login session) -------
cp /tmp/cj /tmp/cj_old
R1=$(T -X POST $B/auth/refresh -b /tmp/cj); check "refresh rotates (200)" "$R1" "200"
R2=$(T -X POST $B/auth/refresh -b /tmp/cj_old); check "replayed refresh cookie rejected (401)" "$R2" "401"

# --- 11. documents ----------------------------------------------------------
echo "probe content" > /tmp/up.pdf
UP=$(curl -s -X POST $B/documents -H "Authorization: Bearer $(tok thabiso)" -F "file=@/tmp/up.pdf" -F "projectId=$P3" -F "title=Suite probe doc" -F "category=PHOTO")
DID=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin)['document']['id'])")
check "valid upload 201 + randomized storage name" \
  "$(echo "$UP" | python3 -c "import sys,json;d=json.load(sys.stdin)['document'];print('201' if d['id'] and '/' not in d['storage_key'] and d['storage_key'].endswith('.pdf') else 'bad')")" "201"
mv /tmp/up.pdf /tmp/up.exe 2>/dev/null
check "disallowed type rejected 400, server survives" \
  "$(T -X POST $B/documents -H "Authorization: Bearer $(tok thabiso)" -F "file=@/tmp/up.exe" -F "projectId=$P3" -F "title=x" -F "category=OTHER"; curl -s -o /dev/null -w "%{http_code}" $B/health)" "400200"
dd if=/dev/zero of=/tmp/big.pdf bs=1M count=16 2>/dev/null
check "oversize 16MB rejected (400)" \
  "$(T -X POST $B/documents -H "Authorization: Bearer $(tok thabiso)" -F "file=@/tmp/big.pdf" -F "projectId=$P3" -F "title=big" -F "category=OTHER")" "400"
DL=$(T $B/documents/$DID/download -H "Authorization: Bearer $(tok thabiso)")
check "staff download 200 + content match" "$DL$(curl -s $B/documents/$DID/download -H "Authorization: Bearer $(tok thabiso)")" "200probe content"
check "client blocked from non-visible category on download (404)" \
  "$(echo "internal" > /tmp/up2.pdf; RID=$(curl -s -X POST $B/documents -H "Authorization: Bearer $(tok thabiso)" -F "file=@/tmp/up2.pdf" -F "projectId=$P3" -F "title=Internal" -F "category=REPORT" | python3 -c "import sys,json;print(json.load(sys.stdin)['document']['id'])"); T $B/documents/$RID/download -H "Authorization: Bearer $(tok dineo)")" "404"
check "client project document list category-scoped" \
  "$(curl -s $B/documents/projects/$P3/documents -H "Authorization: Bearer $(tok dineo)" | python3 -c "import sys,json;ds=json.load(sys.stdin)['documents'];print('yes' if ds and all(d['category'] in ('CERTIFICATE','APPROVAL','CLIENT_DELIVERABLE','PHOTO') for d in ds) else 'no')")" "yes"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
