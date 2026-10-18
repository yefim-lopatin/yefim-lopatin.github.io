# Правила доставки проекта

- Все запросы на изменения Excalidraw подразумевают публикацию на сервере друга: https://excalidraw.159-69-159-241.sslip.io/.
- Доступ: `ssh elmif@159.69.159.241`; файлы сайта: `/home/elmif/excalidraw-deploy/site/`. Контейнеры: `excalidraw-site` и `excalidraw-room`.
- Excalidraw не публиковать на GitHub Pages. Остальные разделы GitHub Pages сохранять.
- После успешных проверок добавлять в staging только файлы текущей задачи, создавать содержательный commit и отправлять его в `origin/main`.
- Для сервера собирать приложение с `VITE_APP_BASE_PATH=/`, `VITE_APP_WS_SERVER_URL=https://excalidraw.159-69-159-241.sslip.io`, `VITE_APP_DISABLE_SENTRY=true`: `corepack yarn --cwd excalidraw-app build:app:docker --outDir /tmp/excalidraw-friend-release`.
- Перед загрузкой сохранять резервную копию текущего сайта в `~/excalidraw-deploy/`. В сборку добавлять `version.json` с полным номером commit. Загружать сборку в `~/excalidraw-deploy/site/` через rsync, исключая `*.map`.
- После загрузки проверять публичный `version.json`, совпадение опубликованного `index.html` со сборкой и доступность приложения. Работу считать завершённой после проверки сервера друга.
- Не запрашивать отдельное подтверждение на staging, commit, push и обычную публикацию на сервере друга.
- Не включать чужие или несвязанные изменения. При конфликте изменений, секретах, расхождении истории, неуспешных проверках или необходимости разрушительного действия остановиться и запросить решение.
