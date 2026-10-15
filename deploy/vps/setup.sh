#!/usr/bin/env bash
# Установка «Куда идём?» на чистый сервер Ubuntu 22.04/24.04 (под root). Повторный запуск безопасен.
#   bash setup.sh <домен API> [домен зеркала сайта]
# Например:  bash setup.sh api.kuda-idem.ru kuda-idem.ru
# Без своего домена (для теста):  bash setup.sh api.<IP-через-дефисы>.sslip.io   — например api.203-0-113-7.sslip.io
set -euo pipefail
API_DOMAIN="${1:?укажи домен API, например api.kuda-idem.ru или api.203-0-113-7.sslip.io}"
SITE_DOMAIN="${2:-}"
REPO="${REPO:-https://github.com/kirillpavlov-21/love.git}"
BRANCH="${BRANCH:-main}"
DIR=/opt/kuda
PAGES="${PAGES:-https://kirillpavlov-21.github.io}"     # сайт на GitHub Pages
PAGES_PATH="${PAGES_PATH:-/love/}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "запусти под root (sudo -i)"; exit 1; }

say "1/6 Docker и утилиты"
if ! command -v docker >/dev/null; then
  apt-get update -qq && apt-get install -y -qq ca-certificates curl git openssl >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null || apt-get install -y -qq git >/dev/null

say "2/6 Код из $REPO ($BRANCH)"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  for i in 1 2 3; do git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR" && break || { echo "GitHub не ответил, ещё раз через 10 с"; sleep 10; }; done
fi
cd "$DIR/deploy/vps"

say "3/6 Секреты (создаются один раз, лежат в $DIR/deploy/vps/.env)"
ORIGINS="$PAGES"; SITES="$PAGES$PAGES_PATH"
[ -n "$SITE_DOMAIN" ] && ORIGINS="$ORIGINS https://$SITE_DOMAIN" && SITES="$SITES https://$SITE_DOMAIN/"
if [ ! -f .env ]; then
  umask 077
  cat > .env <<ENV
ALLOWED_ORIGINS=$ORIGINS
SITE_ORIGINS=$SITES
ADMIN_TOKEN=$(openssl rand -hex 24)
HASH_SALT=$(openssl rand -hex 24)
ENV
  NEW_SECRETS=1
else
  # домены могли поменяться — обновляем только списки адресов, секреты не трогаем
  sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=$ORIGINS|; s|^SITE_ORIGINS=.*|SITE_ORIGINS=$SITES|" .env
fi

say "4/6 Caddyfile (HTTPS-сертификаты Caddy получит сам)"
{
  echo "$API_DOMAIN {"
  echo "  encode zstd gzip"
  echo "  reverse_proxy api:8787"
  echo "}"
  if [ -n "$SITE_DOMAIN" ]; then
    cat <<SITE
$SITE_DOMAIN {
  encode zstd gzip
  root * /srv/site
  @private path /.git* /.github/* /.claude/* /.pipeline-data/* /server/* /relay/* /deploy/* /pipeline/* /_import/* *.md
  respond @private 404
  header /assets/* Cache-Control "public, max-age=604800"
  header /sw.js Cache-Control "no-cache"
  file_server
  handle_errors {
    rewrite * /404.html
    file_server
  }
}
SITE
  fi
} > Caddyfile

say "5/6 Запуск"
docker compose up -d --build
for i in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:80" 2>/dev/null && break; sleep 2; done

say "6/6 Расписание: копия базы каждый день в 04:10, обновление сайта и API каждые 15 минут"
cat > /etc/cron.d/kuda <<CRON
10 4 * * * root $DIR/deploy/vps/backup.sh >> /var/log/kuda-backup.log 2>&1
*/15 * * * * root cd $DIR && git fetch -q origin $BRANCH && if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/$BRANCH)" ]; then git reset -q --hard origin/$BRANCH && cd deploy/vps && docker compose up -d --build >> /var/log/kuda-update.log 2>&1; fi
CRON
if command -v ufw >/dev/null; then ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null || true; fi

say "Готово"
echo "API:        https://$API_DOMAIN   (проверка: curl https://$API_DOMAIN/?ratings=1)"
echo "Модерация:  https://$API_DOMAIN/admin"
[ -n "$SITE_DOMAIN" ] && echo "Зеркало:    https://$SITE_DOMAIN/start.html"
if [ "${NEW_SECRETS:-}" = 1 ]; then
  echo
  echo "Пароль модерации (сохрани, больше не покажу):"
  grep '^ADMIN_TOKEN=' .env | cut -d= -f2
fi
echo
echo "Дальше: в config.js сайта → api: { url: 'https://$API_DOMAIN' }"
