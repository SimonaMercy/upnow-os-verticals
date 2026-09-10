#!/bin/bash
# dev-warm.sh — pre-compile the heavy routes after a dev-server (re)start, so
# the first human click never pays the webpack compile. Next.js dev compiles a
# route on first render; an unauthenticated hit gets bounced by the middleware
# before the page renders, so this signs in (dev OTP) and visits each route
# with a real session cookie.
#
# Usage: ./scripts/dev-warm.sh [frontend-url] [api-url]
set -u
FE="${1:-http://localhost:3000}"
API="${2:-http://localhost:3001/api}"

token_for() { # $1 = email → prints access_token (empty on failure)
  local otp tok
  otp=$(curl -s -m 10 -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\"}" | sed -n 's/.*"devOtp":"\([0-9]*\)".*/\1/p')
  [ -n "$otp" ] || return 0
  curl -s -m 10 -X POST "$API/auth/login/verify-otp" -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"$1\",\"code\":\"$otp\"}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

warm() { # $1 = token ('' for public), rest = paths
  local tok="$1"; shift
  for p in "$@"; do
    local t
    t=$(curl -s -o /dev/null -m 120 -w '%{time_total}' ${tok:+-H "Cookie: upnow_token=$tok"} "$FE$p")
    printf '  %7.2fs  %s\n' "$t" "$p"
  done
}

echo "warming $FE …"
warm '' /login /

RP_TOKEN=$(token_for "${WARM_RP:-kbaalfalasi@gmail.com}")
if [ -n "$RP_TOKEN" ]; then
  warm "$RP_TOKEN" \
    /rental-provider/dashboard \
    /rental-provider/dashboard/portfolio \
    /rental-provider/dashboard/units \
    /rental-provider/dashboard/tenants \
    /rental-provider/dashboard/payments \
    /rental-provider/dashboard/operations \
    /rental-provider/dashboard/orders \
    /rental-provider/dashboard/maintenance \
    /rental-provider/dashboard/maintenance/1 \
    /rental-provider/dashboard/maintenance-list \
    /rental-provider/dashboard/vendors \
    /rental-provider/dashboard/vendors/19 \
    /rental-provider/dashboard/leads \
    /rental-provider/dashboard/reports \
    /rental-provider/dashboard/team \
    /rental-provider/dashboard/settings
else
  echo "  (landlord login failed — landlord routes not warmed)"
fi

CU_TOKEN=$(token_for "${WARM_CUSTOMER:-ahmed_f_tantawy@hotmail.com}")
if [ -n "$CU_TOKEN" ]; then
  warm "$CU_TOKEN" /dashboard/customer/spaces /dashboard/customer/services
else
  echo "  (customer login failed — customer routes not warmed)"
fi

SP_TOKEN=$(token_for "${WARM_VENDOR:-vendor@staging.com}")
if [ -n "$SP_TOKEN" ]; then
  warm "$SP_TOKEN" /dashboard/service-provider/operations /dashboard/service-provider/jobs/1 /dashboard/service-provider/settings
else
  echo "  (vendor login failed — vendor routes not warmed)"
fi

echo "warm done."
