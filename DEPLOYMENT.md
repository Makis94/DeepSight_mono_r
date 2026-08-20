# Деплой HyperTracker в продакшн

Итоговая топология:

| Компонент                                             | Где живёт                                                                    | Стоимость                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| Postgres, apps/api, apps/bot, 6 процессов apps/worker | AWS Lightsail VM, план $12/мес (2 vCPU / 2GB RAM / 60GB SSD, docker compose) | $0 первые 3 месяца, далее $12/мес |
| apps/web (клиент + Mini App)                          | Vercel Hobby                                                                 | $0                                |
| apps/admin                                            | Vercel Hobby                                                                 | $0                                |
| Домен                                                 | Cloudflare Registrar (или Namecheap/Porkbun)                                 | ~$10/год                          |

Файлы, которые уже подготовлены в репозитории: `apps/api/Dockerfile`, `apps/bot/Dockerfile`,
`apps/worker/Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`,
`scripts/deploy.sh`, `.github/workflows/deploy.yml`.

**Важно про cookie админки:** `apps/admin` использует `SameSite=Strict` cookie, поэтому
`apps/admin` и `apps/api` обязаны быть на поддоменах одного корневого домена (например
`admin.hyper-deep-sight.com` и `api.hyper-deep-sight.com`). Не используйте для них домены с разных
регистраций/зон.

---

## 0. Что нужно завести заранее

- [ ] Домен (Cloudflare Registrar / Namecheap / Porkbun)
- [ ] Аккаунт AWS (для Lightsail free trial — 3 месяца бесплатно на плане $12/мес, отсчёт с
      момента запуска первого инстанса; если аккаунт состоит в AWS Organization, free trial
      доступен только на одном аккаунте организации)
- [ ] Аккаунт Vercel, репозиторий подключён к GitHub
- [ ] Аккаунт NowPayments переведён из sandbox в **live**, получены боевые `API key` и
      `IPN secret` (Settings → API keys в их дашборде)
- [ ] Токен `@Deep_sight_bot` уже есть — **перевыпустите его через @BotFather (`/revoke`)**,
      так как исходный токен был вставлен в чат в открытом виде

---

## 1. Домен и DNS

1. Купите домен, например `hyper-deep-sight.com`.
2. В DNS панели (если через Cloudflare — сразу там же) создайте:
   - `A`-запись `api.hyper-deep-sight.com` → статический IP Lightsail VM (получите его на шаге
     2.3, эту запись добавите после создания VM и привязки статического IP).
   - Домены для `apps/web` (`hyper-deep-sight.com` / `www.hyper-deep-sight.com`) и `apps/admin`
     (`admin.hyper-deep-sight.com`) добавите как Custom Domains прямо в Vercel на шаге 4 — Vercel сам
     подскажет, какие DNS-записи (`CNAME`/`A`) на них завести.
3. Если используете Cloudflare DNS для `api.hyper-deep-sight.com` — поставьте прокси **выключенным
   (серое облако, "DNS only")** на первое время, пока Caddy не выпустит сертификат через
   Let's Encrypt (HTTP-01 challenge требует прямого доступа, не через прокси). Включить
   оранжевое облако можно после первого успешного `docker compose up`.

---

## 2. AWS Lightsail: VM

1. Зарегистрируйтесь / зайдите на [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com).
2. Создайте инстанс (Create instance):
   - Instance location: регион ближе к пользователям.
   - Platform: **Linux/Unix**, Blueprint: **OS Only → Ubuntu 24.04 LTS**.
   - SSH key pair: используйте default Lightsail-ключ (скачайте `.pem` при первом создании
     инстанса в этом регионе) либо загрузите свой публичный ключ в Account → SSH keys заранее.
   - Instance plan: **$12/мес — 2 vCPU / 2GB RAM / 60GB SSD / 3TB трафика** (входит в 3-месячный
     free trial).
   - Запустите инстанс.
3. Привяжите статический IP (обязательно — иначе публичный IP инстанса меняется при
   остановке/перезапуске): вкладка **Networking** инстанса → **Create static IP** → привяжите к
   этому инстансу. Пока IP привязан к запущенному инстансу, это бесплатно.
   - Запишите этот статический IP — вернитесь на шаг 1.2 и создайте `A`-запись
     `api.hyper-deep-sight.com` → этот IP.
4. Откройте порты 80/443: вкладка **Networking** инстанса → **IPv4 Firewall** → **Add rule** →
   добавьте `HTTP` (80/tcp) и `HTTPS` (443/tcp) из `0.0.0.0/0`. Порт 22/tcp (SSH) открыт по
   умолчанию.
5. Подключитесь по SSH (пользователь по умолчанию на Ubuntu-образах Lightsail — `ubuntu`):
   ```bash
   chmod 400 LightsailDefaultKey-<регион>.pem
   ssh -i LightsailDefaultKey-<регион>.pem ubuntu@<STATIC_IP>
   ```
6. Установите Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   # перелогиньтесь (exit + ssh снова), чтобы группа docker применилась
   ```
7. Установите git и клонируйте репозиторий:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   sudo mkdir -p /opt/hypertracker && sudo chown $USER:$USER /opt/hypertracker
   git clone <URL_ВАШЕГО_РЕПО> /opt/hypertracker
   cd /opt/hypertracker
   ```

---

## 3. Продакшн-секреты на VM

```bash
cd /opt/hypertracker
cp .env.production.example .env
nano .env
```

Заполните **все** поля — комментарии в файле объясняют каждое. Ключевое:

- `POSTGRES_PASSWORD` — сгенерируйте: `openssl rand -base64 32`
- `API_DOMAIN=api.hyper-deep-sight.com`, `ACME_EMAIL=<ваш email>`
- `BOT_TOKEN=` — новый (перевыпущенный) токен `@Deep_sight_bot`
- `PUBLIC_API_URL=https://api.hyper-deep-sight.com`
- `JWT_SECRET` / `ADMIN_JWT_SECRET` — два **разных** `openssl rand -base64 32`
- `ADMIN_ORIGIN=https://admin.hyper-deep-sight.com`
- `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` — боевые, из live-аккаунта NowPayments
  (не sandbox!)
- `ARBITRUM_RPC_URL` — боевой RPC-ключ (Alchemy/Infura/QuickNode free tier достаточно)
- `CMC_API_KEY` — ваш CoinMarketCap ключ

`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` заполните **после** первого поднятия стека — хэш
генерируется контейнером `api` (см. шаг 4.3).

`.env` уже в `.gitignore` (правило `.env` / `.env.*`) — эта директория на VM живёт вне
контроля git, ничего дополнительно делать не нужно, просто никогда не коммитьте его руками.

---

## 4. Первый деплой

1. Поднимите Postgres и накатите миграции:
   ```bash
   docker compose -f docker-compose.prod.yml up -d postgres
   docker compose -f docker-compose.prod.yml build api
   docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @hypertracker/db db:migrate
   ```
2. Сгенерируйте bcrypt-хэш пароля админки и допишите его в `.env` (`ADMIN_PASSWORD_HASH`),
   а `ADMIN_USERNAME` — любой логин на ваш выбор:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm api \
     pnpm --filter @hypertracker/api hash-admin-password '<ваш-пароль>'
   nano .env   # вписать оба значения
   ```
3. Поднимите весь стек:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml ps
   ```
   Caddy сам выпустит HTTPS-сертификат для `API_DOMAIN` при первом старте (нужен уже
   настроенный DNS из шага 1).
4. Проверка:
   ```bash
   curl https://api.hyper-deep-sight.com/health
   # {"status":"ok","uptime":...}
   ```
5. Проверьте, что все 6 воркеров реально живые (не просто "Up", а health passing):
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```
   Статус `healthy` у `wallet-watcher`/`market-watcher`/`deposit-watcher`/
   `coin-registry-sync`/`common-wallet-tracker`/`subscription-watcher` подтверждает, что их
   `/healthz` отвечает 200 (см. `apps/worker/src/shared/heartbeat.ts`).

---

## 5. Vercel: apps/web и apps/admin

Два **отдельных** проекта Vercel из одного репозитория.

### apps/web

1. New Project → импортируйте репозиторий.
2. Root Directory: `apps/web`.
3. Framework Preset: Vite (определится автоматически).
4. Environment Variables:
   - `VITE_API_URL=https://api.hyper-deep-sight.com`
   - `VITE_BOT_USERNAME=Deep_sight_bot`
5. Deploy. После первого деплоя: Settings → Domains → добавьте `hyper-deep-sight.com` /
   `www.hyper-deep-sight.com`, следуйте инструкции Vercel по DNS.

### apps/admin

1. New Project → тот же репозиторий, ещё раз.
2. Root Directory: `apps/admin`.
3. Environment Variables:
   - `VITE_API_URL=https://api.hyper-deep-sight.com`
4. Deploy. Settings → Domains → добавьте `admin.hyper-deep-sight.com`.

---

## 6. Telegram: @BotFather

Для `@Deep_sight_bot`:

1. `/setdomain` — укажите `hyper-deep-sight.com` (домен `apps/web`, для Login Widget standalone-сайта).
2. `/newapp` или `/mybots` → Bot Settings → Menu Button / Mini App — укажите
   `https://hyper-deep-sight.com` как URL Mini App.
3. `/setmenubutton` (опционально) — кнопка меню, ведущая в Mini App.
4. Если ранее токен `@Deep_sight_bot` вставлялся куда-либо в открытом виде (как в этом
   чате) — обязательно `/revoke` и обновите `BOT_TOKEN` в `.env` на VM, затем
   `docker compose -f docker-compose.prod.yml up -d --build bot`.

---

## 7. NowPayments: live-режим

1. В дашборде NowPayments переключитесь с Sandbox на боевой аккаунт (или создайте новый,
   если Sandbox был отдельным тестовым аккаунтом).
2. Settings → API keys → создайте live `API key`, включите IPN и получите `IPN secret`.
3. Впишите оба значения в `.env` на VM (шаг 3), пересоберите зависящие сервисы:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build api bot subscription-watcher
   ```
4. Тестовый прогон: инициируйте оплату через бота, убедитесь, что IPN-колбэк доходит на
   `https://api.hyper-deep-sight.com/webhooks/nowpayments` (смотрите логи: `docker compose -f
docker-compose.prod.yml logs -f api`).

---

## 8. CI/CD (автодеплой при пуше в main)

`.github/workflows/deploy.yml` уже добавлен — он запускается после успешного прохождения
`CI` (lint/typecheck/build) на `main` и по SSH выполняет `scripts/deploy.sh` на VM.

В GitHub репозитории: Settings → Secrets and variables → Actions → добавьте:

- `DEPLOY_HOST` — публичный IP VM
- `DEPLOY_USER` — `ubuntu`
- `DEPLOY_SSH_KEY` — **приватный** SSH-ключ (тот, чей публичный добавлен на VM), целиком,
  включая `-----BEGIN...-----`/`-----END...-----`
- `DEPLOY_PATH` — `/opt/hypertracker`

После этого `git push` в `main` (после прохождения CI) автоматически задеплоит новую версию.

---

## 9. Резервное копирование Postgres

Простой ежедневный дамп на VM (добавьте в `crontab -e`):

```bash
0 3 * * * docker exec $(docker ps -qf name=hypertracker-postgres-1) pg_dump -U hypertracker hypertracker | gzip > /opt/backups/hypertracker-$(date +\%F).sql.gz
```

Создайте `/opt/backups` заранее (`mkdir -p /opt/backups`) и периодически скачивайте дампы
с VM или настройте выгрузку в S3-совместимое хранилище (Cloudflare R2 free tier — 10GB).

---

## 10. Чек-лист "точно всё готово"

- [ ] `curl https://api.hyper-deep-sight.com/health` → 200
- [ ] `https://hyper-deep-sight.com` открывается, авторизация через Login Widget работает
- [ ] `https://admin.hyper-deep-sight.com` — логин админки работает (проверяет SameSite-cookie
      между поддоменами)
- [ ] Бот отвечает в Telegram, Mini App открывается по кнопке
- [ ] Тестовая (реальная, минимальная) оплата через NowPayments live проходит от начала до
      конца
- [ ] Все 6 воркеров в `docker compose ps` — `healthy`
- [ ] `NOWPAYMENTS_BASE_URL` везде `https://api.nowpayments.io`, нигде не осталось
      `api-sandbox.nowpayments.io`
- [ ] Старый `BOT_TOKEN` отозван через `/revoke` у @BotFather
