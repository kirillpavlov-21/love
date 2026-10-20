# Как включить ежедневные конвейеры

GitHub запускает только файлы из `.github/workflows/`. Файлы лежат здесь, потому что токен, которым ветку отправили на GitHub, не имел права менять workflow.

| Файл | Что делает | Что нужно |
|---|---|---|
| `places-update.yml` | каталог: новые и закрывшиеся места, события, подборки → PR «Каталог: обновление …» | секрет `ANTHROPIC_API_KEY`, список источников в ветке `pipeline-data` |
| `football.yml` | футбол: матчи РПЛ, Кубка России и сборной в Москве и Петербурге → `assets/sport.js` → PR «Футбол: расписание …» | ничего, кроме прав на PR |

Включить — любым способом:

1. **В браузере:** на GitHub открой репозиторий → Add file → Create new file, путь `.github/workflows/<имя файла>`, вставь содержимое файла из этой папки и закоммить в `main`.
2. **Из терминала:** выдай токену право и перенеси файлы:
   ```bash
   gh auth refresh -h github.com -s workflow
   mkdir -p .github/workflows
   git mv pipeline/github-workflow/places-update.yml .github/workflows/places-update.yml
   git mv pipeline/github-workflow/football.yml .github/workflows/football.yml
   git commit -m "Включить ежедневные конвейеры" && git push
   ```

Обоим нужна галочка «Allow GitHub Actions to create and approve pull requests» (Settings → Actions → General). Перед первым запуском каталога: секрет `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions) и список источников в ветке `pipeline-data` — подробно в `pipeline/README.md`. Футболу секреты не нужны.
