# Как включить ежедневный конвейер

GitHub запускает только файлы из `.github/workflows/`. Этот файл лежит здесь, потому что токен, которым ветку отправили на GitHub, не имел права менять workflow.

Включить — любым способом:

1. **В браузере:** на GitHub открой репозиторий → Add file → Create new file, путь `.github/workflows/places-update.yml`, вставь содержимое `places-update.yml` из этой папки и закоммить в `main`.
2. **Из терминала:** выдай токену право и перенеси файл:
   ```bash
   gh auth refresh -h github.com -s workflow
   git mv pipeline/github-workflow/places-update.yml .github/workflows/places-update.yml
   git commit -m "Включить ежедневный конвейер каталога" && git push
   ```

Перед первым запуском: секрет `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions), галочка «Allow GitHub Actions to create and approve pull requests» (Settings → Actions → General) и список источников в ветке `pipeline-data` — подробно в `pipeline/README.md`.
