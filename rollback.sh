#!/bin/bash
# ROLLBACK: put a pre-deploy snapshot back as the live site. About ten seconds.
#
#   ./rollback.sh                       roll PRODUCTION back to its newest snapshot (asks first)
#   ./rollback.sh -y                    same, no question -- the emergency form
#   ./rollback.sh -b                    do it to BETA (tokeru.com/sculptxrbeta) instead
#   ./rollback.sh -l                    just list the snapshots
#   ./rollback.sh -s v3.52.1_2026...    a specific snapshot (a folder name from -l)
#   ./rollback.sh --kill-sw             also force the service-worker kill switch (below)
#
# Snapshots are made by deploy.sh before every deploy: a hardlink copy of the live folder in
# ~/rollbacks/<site>/ on the server (outside the web root, newest three kept).
#
# WHAT IT DOES
#   1. keeps the BROKEN state as ~/rollbacks/<site>/bad_<version>_<time> (for finding out why)
#   2. restores the snapshot over the live folder (server-side rsync --delete)
#   3. if the restored build has no sw.js (production before the service worker shipped), writes a
#      KILL-SWITCH sw.js: it clears the sxr-* caches and unregisters itself, so a browser that
#      installed the newer worker does not keep serving its cached, newer files under the older
#      index.html. The next normal deploy overwrites it.
#
# SAVES: files saved by the newer build (sparse keys, texture / media footers) may not open in the
# older one. Beta stays on the newer build, so they can be opened there.
USER=tokeruadmin
HOST=tokeru.com
SITE=sculptxr
SNAPNAME=""
YES=""
LIST=""
KILL=""

while [ $# -gt 0 ]; do
  case "$1" in
    -y) YES=1 ;;
    -b) SITE=sculptxrbeta ;;
    -l) LIST=1 ;;
    -s) SNAPNAME="$2"; shift ;;
    --kill-sw) KILL=1 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh_mux_%h_%p_%r -o ControlPersist=24h -o PasswordAuthentication=no"

echo "== snapshots for ${SITE} =="
ssh ${SSH_OPTS} ${USER}@${HOST} "ls -1dt \$HOME/rollbacks/${SITE}/*/ 2>/dev/null | sed 's|.*/rollbacks/||'"
[ -n "$LIST" ] && exit 0

# Pick the snapshot: a named one, else the newest that is not a bad_ one.
PICK=$(ssh ${SSH_OPTS} ${USER}@${HOST} "
  D=\$HOME/rollbacks/${SITE}
  if [ -n '${SNAPNAME}' ]; then [ -d \"\$D/${SNAPNAME}\" ] && echo \"\$D/${SNAPNAME}\"
  else ls -1dt \$D/v*/ 2>/dev/null | head -1 | sed 's|/\$||'; fi
")
if [ -z "$PICK" ]; then echo "No snapshot found for ${SITE}."; exit 1; fi

LIVE_V=$(ssh ${SSH_OPTS} ${USER}@${HOST} "grep -o 'v[0-9][0-9.]*' ~/tokeru.com/${SITE}/version.json | head -1")
SNAP_V=$(ssh ${SSH_OPTS} ${USER}@${HOST} "grep -o 'v[0-9][0-9.]*' ${PICK}/version.json | head -1")
echo
echo "LIVE now : ${LIVE_V}   (tokeru.com/${SITE})"
echo "RESTORE  : ${SNAP_V}   (${PICK##*/})"
if [ -z "$YES" ]; then
  read -r -p "Roll ${SITE} back to ${SNAP_V}? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Cancelled."; exit 1; }
fi

START=$(date +%s)
ssh ${SSH_OPTS} ${USER}@${HOST} "
  set -e
  LIVE=\$HOME/tokeru.com/${SITE}
  BAD=\$HOME/rollbacks/${SITE}/bad_${LIVE_V}_\$(date +%Y%m%d-%H%M%S)
  cp -al \"\$LIVE\" \"\$BAD\"
  rsync -a --delete '${PICK}/' \"\$LIVE/\"
  if [ ! -f '${PICK}/sw.js' ] || [ -n '${KILL}' ]; then
    cat > \"\$LIVE/sw.js\" <<'SWEOF'
// ROLLBACK KILL SWITCH (written by rollback.sh). Clears this site's caches, unregisters itself and
// reloads open pages, so no browser keeps serving files cached by a newer build. A normal deploy
// replaces this file.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('sxr-')) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
SWEOF
    echo 'kill-switch sw.js written'
  fi
  ls -1dt \$HOME/rollbacks/${SITE}/bad_*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
  echo \"kept broken state: \$BAD\"
"
echo "Rolled back in $(( $(date +%s) - START ))s."
echo "Live version.json now: $(curl -s https://tokeru.com/${SITE}/version.json)"
