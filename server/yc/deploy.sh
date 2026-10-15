#!/usr/bin/env bash
# Развёртывание API «Куда идём?» в Yandex Cloud: YDB Serverless (Document API) + Cloud Functions + ежесуточная очистка.
# Повторный запуск безопасен: существующие ресурсы переиспользуются, выкатывается новая версия функции.
#
# Нужно на компьютере: yc (и выполненный `yc init`), jq, zip, openssl, curl, node 22 + npm.
# Запуск (из любой папки):
#   ALLOWED_ORIGINS="https://user.github.io" SITE_ORIGINS="https://user.github.io/date-invite/" bash server/yc/deploy.sh
#
# Переменные (все необязательные, кроме ALLOWED_ORIGINS):
#   ALLOWED_ORIGINS — сайты, которым можно обращаться к API (через пробел или запятую)
#   SITE_ORIGINS    — адреса сайта для коротких ссылок (по умолчанию = ALLOWED_ORIGINS)
#   FOLDER_ID       — каталог облака (по умолчанию из `yc config get folder-id`)
#   NAME=kuda-api  SA_NAME=kuda-api-sa  DB_NAME=kuda-db  SECRET_NAME=kuda-api-secrets
#   RUNTIME=nodejs22  MEMORY=256m  TIMEOUT=10s
#   ADMIN_TOKEN     — пароль страницы модерации (не короче 16 символов); если не задан, создаётся случайный
#                     (печатается один раз). Применяется при первом запуске или вместе с ROTATE_SECRETS=1
#   ROTATE_SECRETS=1 — выпустить новый статический ключ, ADMIN_TOKEN и соль; старые ключи сервисного
#                     аккаунта удаляются после выкатки новой версии
set -euo pipefail

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\nОшибка: %s\n' "$*" >&2; exit 1; }

for bin in yc jq zip openssl node npm curl; do
  command -v "$bin" >/dev/null 2>&1 || die "не найдена программа «$bin» — установи её (см. server/README.md)"
done

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${NAME:-kuda-api}"
SA_NAME="${SA_NAME:-kuda-api-sa}"
DB_NAME="${DB_NAME:-kuda-db}"
SECRET_NAME="${SECRET_NAME:-kuda-api-secrets}"
RUNTIME="${RUNTIME:-nodejs22}"
MEMORY="${MEMORY:-256m}"
TIMEOUT="${TIMEOUT:-10s}"
FOLDER_ID="${FOLDER_ID:-$(yc config get folder-id 2>/dev/null || true)}"
[ -n "$FOLDER_ID" ] || die "не задан каталог: выполни \`yc init\` или передай FOLDER_ID=…"
[ -n "${ALLOWED_ORIGINS:-}" ] || die "укажи ALLOWED_ORIGINS — адрес сайта, например ALLOWED_ORIGINS=https://user.github.io"
if [ -n "${ADMIN_TOKEN:-}" ] && [ "${#ADMIN_TOKEN}" -lt 16 ]; then die "ADMIN_TOKEN короче 16 символов — страница модерации с ним не включится"; fi
# в yc --environment запятая — разделитель, поэтому списки передаём через пробел
norm() { echo "$1" | tr ',;' '  ' | xargs; }
ALLOWED="$(norm "$ALLOWED_ORIGINS")"
SITES="$(norm "${SITE_ORIGINS:-$ALLOWED_ORIGINS}")"
F=(--folder-id "$FOLDER_ID")

say "1/7 Сервисный аккаунт $SA_NAME"
SA_ID="$(yc iam service-account get --name "$SA_NAME" "${F[@]}" --format json 2>/dev/null | jq -r '.id // empty' || true)"
if [ -z "$SA_ID" ]; then
  SA_ID="$(yc iam service-account create --name "$SA_NAME" "${F[@]}" --description 'API «Куда идём?»: YDB и вызов по таймеру' --format json | jq -r .id)"
fi
for role in ydb.editor functions.functionInvoker; do
  yc resource-manager folder add-access-binding "$FOLDER_ID" --role "$role" --subject "serviceAccount:$SA_ID" >/dev/null 2>&1 || true
done
echo "id: $SA_ID"

say "2/7 База YDB Serverless $DB_NAME (регион ru-central1)"
DB_JSON="$(yc ydb database get --name "$DB_NAME" "${F[@]}" --format json 2>/dev/null || true)"
if [ -z "$DB_JSON" ]; then
  DB_JSON="$(yc ydb database create --name "$DB_NAME" --serverless "${F[@]}" --description 'Голоса, приглашения, отзывы' --format json)"
fi
DB_ID="$(echo "$DB_JSON" | jq -r .id)"
for _ in $(seq 1 60); do
  DB_JSON="$(yc ydb database get --id "$DB_ID" --format json)"
  [ "$(echo "$DB_JSON" | jq -r .status)" = "RUNNING" ] && break
  sleep 5
done
[ "$(echo "$DB_JSON" | jq -r .status)" = "RUNNING" ] || die "база не запустилась за 5 минут — проверь её в консоли"
ENDPOINT="$(echo "$DB_JSON" | jq -r '.document_api_endpoint // empty')"
[ -n "$ENDPOINT" ] || die "у базы нет Document API endpoint — нужна именно Serverless-база"
echo "Document API: $ENDPOINT"

say "3/7 Секреты в Lockbox: $SECRET_NAME"
SECRET_JSON="$(yc lockbox secret get --name "$SECRET_NAME" "${F[@]}" --format json 2>/dev/null || true)"
NEW_ADMIN=""
NEW_AK=""
if [ -n "$SECRET_JSON" ] && [ "${ROTATE_SECRETS:-0}" != "1" ] && [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "ADMIN_TOKEN из окружения не применён: секрет уже есть. Чтобы сменить пароль, ключ и соль — ROTATE_SECRETS=1"
fi
if [ -z "$SECRET_JSON" ] || [ "${ROTATE_SECRETS:-0}" = "1" ]; then
  KEY_JSON="$(yc iam access-key create --service-account-id "$SA_ID" --description 'YDB Document API для kuda-api' --format json)"
  AK="$(echo "$KEY_JSON" | jq -r .access_key.key_id)"
  NEW_AK="$AK"
  SK="$(echo "$KEY_JSON" | jq -r .secret)"
  NEW_ADMIN="${ADMIN_TOKEN:-$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | cut -c1-32)}"
  SALT="$(openssl rand -hex 24)"
  PAYLOAD="$(jq -cn --arg ak "$AK" --arg sk "$SK" --arg at "$NEW_ADMIN" --arg salt "$SALT" \
    '[{key:"AWS_ACCESS_KEY_ID",text_value:$ak},{key:"AWS_SECRET_ACCESS_KEY",text_value:$sk},{key:"ADMIN_TOKEN",text_value:$at},{key:"HASH_SALT",text_value:$salt}]')"
  if [ -z "$SECRET_JSON" ]; then
    SECRET_JSON="$(yc lockbox secret create --name "$SECRET_NAME" "${F[@]}" --description 'kuda-api: ключ YDB, пароль модерации, соль' --payload "$PAYLOAD" --format json)"
  else
    yc lockbox secret add-version --id "$(echo "$SECRET_JSON" | jq -r .id)" --payload "$PAYLOAD" >/dev/null
    SECRET_JSON="$(yc lockbox secret get --name "$SECRET_NAME" "${F[@]}" --format json)"
  fi
  unset SK PAYLOAD KEY_JSON
fi
SECRET_ID="$(echo "$SECRET_JSON" | jq -r .id)"
VERSION_ID="$(echo "$SECRET_JSON" | jq -r .current_version.id)"
yc lockbox secret add-access-binding --id "$SECRET_ID" --role lockbox.payloadViewer --service-account-id "$SA_ID" >/dev/null 2>&1 || true
echo "secret: $SECRET_ID (версия $VERSION_ID)"

say "4/7 Таблицы в YDB"
PAYLOAD_JSON="$(yc lockbox payload get --id "$SECRET_ID" --format json)"
val() { echo "$PAYLOAD_JSON" | jq -r --arg k "$1" '.entries[] | select(.key == $k) | .text_value'; }
( cd "$SERVER_DIR" && npm ci --omit=dev --no-audit --no-fund --silent )
( cd "$SERVER_DIR" && STORE=ydb YDB_DOCAPI_ENDPOINT="$ENDPOINT" AWS_ACCESS_KEY_ID="$(val AWS_ACCESS_KEY_ID)" AWS_SECRET_ACCESS_KEY="$(val AWS_SECRET_ACCESS_KEY)" \
  node --input-type=module -e "import { createStore } from './store/index.mjs'; const s = await createStore(process.env); await s.close(); console.log('таблицы готовы'); if (s.ttlWarning) console.log('TTL пока не включён (' + s.ttlWarning + ') — запусти скрипт ещё раз через час; до тех пор счётчики удаляет суточная очистка');" )
unset PAYLOAD_JSON

say "5/7 Функция $NAME"
FN_ID="$(yc serverless function get --name "$NAME" "${F[@]}" --format json 2>/dev/null | jq -r '.id // empty' || true)"
if [ -z "$FN_ID" ]; then
  FN_ID="$(yc serverless function create --name "$NAME" "${F[@]}" --description 'API «Куда идём?»' --format json | jq -r .id)"
fi
yc serverless function allow-unauthenticated-invoke --id "$FN_ID" >/dev/null
ZIP="$(mktemp -d)/kuda-api.zip"
( cd "$SERVER_DIR" && zip -qr "$ZIP" package.json package-lock.json handler.mjs lib store yc/index.js yc/main.mjs )
yc serverless function version create \
  --function-id "$FN_ID" \
  --runtime "$RUNTIME" \
  --entrypoint yc/index.handler \
  --memory "$MEMORY" \
  --execution-timeout "$TIMEOUT" \
  --service-account-id "$SA_ID" \
  --source-path "$ZIP" \
  --environment STORE=ydb \
  --environment "YDB_DOCAPI_ENDPOINT=$ENDPOINT" \
  --environment "ALLOWED_ORIGINS=$ALLOWED" \
  --environment "SITE_ORIGINS=$SITES" \
  --environment LOG_REQUESTS=0 \
  --environment STORE_SKIP_INIT=1 \
  --secret "environment-variable=AWS_ACCESS_KEY_ID,id=$SECRET_ID,version-id=$VERSION_ID,key=AWS_ACCESS_KEY_ID" \
  --secret "environment-variable=AWS_SECRET_ACCESS_KEY,id=$SECRET_ID,version-id=$VERSION_ID,key=AWS_SECRET_ACCESS_KEY" \
  --secret "environment-variable=ADMIN_TOKEN,id=$SECRET_ID,version-id=$VERSION_ID,key=ADMIN_TOKEN" \
  --secret "environment-variable=HASH_SALT,id=$SECRET_ID,version-id=$VERSION_ID,key=HASH_SALT" \
  >/dev/null
rm -f "$ZIP"
if [ -n "$NEW_AK" ] && [ "${ROTATE_SECRETS:-0}" = "1" ]; then
  # новая версия функции уже ходит с новым ключом — старые ключи этого сервисного аккаунта больше не нужны
  for old in $(yc iam access-key list --service-account-id "$SA_ID" --format json | jq -r --arg k "$NEW_AK" '.[] | select(.key_id != $k) | .id'); do
    yc iam access-key delete --id "$old" >/dev/null && echo "старый статический ключ $old удалён"
  done
fi

say "6/7 Таймер очистки (раз в сутки, 03:00 по Москве)"
if ! yc serverless trigger get --name "$NAME-cleanup" "${F[@]}" >/dev/null 2>&1; then
  yc serverless trigger create timer --name "$NAME-cleanup" "${F[@]}" \
    --cron-expression '0 0 ? * * *' \
    --invoke-function-id "$FN_ID" \
    --invoke-function-service-account-id "$SA_ID" >/dev/null
fi

URL="https://functions.yandexcloud.net/$FN_ID"
say "7/7 Проверка"
if curl -fsS --max-time 20 "$URL" | grep -q '"ok":true'; then echo "API отвечает: $URL"; else echo "API пока не ответил — подожди минуту и открой $URL"; fi

cat <<EOF

Готово.
  Адрес API (впиши в config.js → api.url):  $URL
  Модерация:                                 $URL?admin=1   (пароль — ADMIN_TOKEN)
EOF
if [ -n "$NEW_ADMIN" ]; then
  echo "  ADMIN_TOKEN (показывается один раз, сохрани в менеджер паролей): $NEW_ADMIN"
else
  echo "  ADMIN_TOKEN лежит в Lockbox: yc lockbox payload get --id $SECRET_ID --format json | jq -r '.entries[] | select(.key==\"ADMIN_TOKEN\") | .text_value'"
fi
