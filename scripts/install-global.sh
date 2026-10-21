#!/bin/sh
# bashcli'yi global olarak kurar (shim yazar).
#
# Bu betik, kökteki install.sh'in ince bir sarmalayıcısıdır: asıl kurulum
# mantığı install.sh içindedir. Eski yol (yalnızca shim yaz, bağımlılık
# kurma) korunur: --shim-only argümanıyla yalnızca shim oluşturulur.
#
# Kullanım:
#   ./scripts/install-global.sh                 # tam kurulum (bağımlılıklar + shim + .env)
#   ./scripts/install-global.sh --shim-only     # yalnızca shim
#   ./scripts/install-global.sh --uninstall     # shim'i kaldır
#
# Yeni kurulumlar için: ./install.sh

set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/install.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "Hata: $SCRIPT bulunamadı." >&2
  exit 1
fi

# --shim-only: bağımlılık kurulumu ve .env hazırlığı atlanır.
if [ "$1" = "--shim-only" ]; then
  shift
  exec "$SCRIPT" --no-env "$@"
fi

exec "$SCRIPT" "$@"

