#!/usr/bin/env bash
# bashcli — Linux kurulum betiği.
#
# Ne yapar:
#   1) Gerekli araçları kontrol eder (node >= 20.11, npm).
#   2) Bağımlılıkları kurar (npm ci / npm install).
#   3) Örnek .env dosyasını hazırlar (.env yoksa .env.example'dan kopyalar).
#   4) `bashcli` komutunu PATH'te erişilebilir hâle getirir:
#      varsayılan ~/.local/bin/bashcli shim'i; istenirse npm global kurulumu.
#
# Kullanım:
#   ./install.sh                 # önerilen: ~/.local/bin shim
#   ./install.sh --prefix DIR    # shim'i DIR/bin altına koy
#   ./install.sh --npm-global    # `npm install -g .` ile kur
#   ./install.sh --uninstall     # shim'i kaldır
#   ./install.sh --no-env        # .env hazırlama (kendi .env'ini yazacaksan)
#
# Kullanıcı kurulumu (root gerektirmez):
#   git clone <repo> && cd <repo> && ./install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${HOME}/.local"
USE_NPM_GLOBAL=0
DO_ENV=1
UNINSTALL=0

say()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mUYARI:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31mHATA:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --prefix)
      [ $# -ge 2 ] || die "--prefix için dizin gerekli"
      PREFIX="$2"; shift 2 ;;
    --prefix=*)    PREFIX="${arg#*=}"; shift ;;
    --npm-global)  USE_NPM_GLOBAL=1; shift ;;
    --no-env)      DO_ENV=0; shift ;;
    --uninstall)   UNINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Bilinmeyen argüman: $arg (--help için)" >&2
      exit 1 ;;
  esac
done

BIN_DIR="$PREFIX/bin"
SHIM="$BIN_DIR/bashcli"
TARGET="$ROOT/bin/bashcli.mjs"

# ---------------------------------------------------------------- kaldırma --
if [ "$UNINSTALL" -eq 1 ]; then
  if [ -e "$SHIM" ] || [ -L "$SHIM" ]; then
    rm -f "$SHIM"
    say "Kaldırıldı: $SHIM"
  else
    say "Kurulmuş shim bulunamadı: $SHIM"
  fi
  if command -v npm >/dev/null 2>&1; then
    npm uninstall -g bashcli >/dev/null 2>&1 || true
  fi
  say "Not: ~/.bashcli/providers.json (API anahtarları) silinmedi."
  exit 0
fi

# ---------------------------------------------------------- ön koşullar --
command -v node >/dev/null 2>&1 || die "node bulunamadı. Node.js 20.11+ kurun: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm bulunamadı. Node.js ile birlikte gelir."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 11 ]; }; then
  die "Node.js $NODE_MAJOR.$NODE_MINOR bulundu, en az 20.11 gerekli."
fi
say "Node.js $(node -v) · npm $(npm -v)"

[ -f "$TARGET" ] || die "Giriş noktası bulunamadı: $TARGET"

# ----------------------------------------------------------- bağımlılıklar --
say "Bağımlılıklar kuruluyor (npm ci)..."
if [ -f "$ROOT/package-lock.json" ] && [ -d "$ROOT/node_modules" ]; then
  npm ci --omit=dev --no-audit --no-fund 2>/dev/null \
    || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

# ------------------------------------------------------------------- .env --
if [ "$DO_ENV" -eq 1 ]; then
  if [ -f "$ROOT/.env" ]; then
    say ".env zaten var, atlanıyor."
  elif [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    chmod 600 "$ROOT/.env"
    say ".env oluşturuldu (.env.example'dan; yalnızca sağlayıcı dışı ayarlar)."
  else
    warn ".env.example bulunamadı; .env atlandı."
  fi
fi

# ------------------------------------------------------------------ kurulum --
if [ "$USE_NPM_GLOBAL" -eq 1 ]; then
  say "npm global kurulumu yapılıyor (npm install -g .)..."
  npm install -g . --no-audit --no-fund
  say "Kuruldu: $(command -v bashcli || echo 'bashcli')"
else
  mkdir -p "$BIN_DIR"
  cat > "$SHIM" <<EOF
#!/usr/bin/env bash
# bashcli — kodlama ajanı (Node.js + TypeScript + Google ADK).
# Bu shim, ajanın gerçek giriş noktasına (bin/bashcli.mjs) yönlendirir.
# Ajan kaynak kodu güncellendiğinde burada bir şey yapmaya gerek yoktur.
exec node "$TARGET" "\$@"
EOF
  chmod +x "$SHIM"
  say "Kuruldu: $SHIM"
  say "  → $TARGET"
fi

# ------------------------------------------------------------------- PATH --
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR PATH'te değil. Eklemek için:"
     echo "     export PATH=\"$BIN_DIR:\$PATH\""
     echo "   Kalıcı olsun istiyorsanız (~/.bashrc):"
     echo "     echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc" ;;
esac

cat <<EOF

Kurulum tamam. Şimdi:

  bashcli                 # etkileşimli TUI (workspace = bulunduğunuz dizin)
  bashcli "şunu yap"      # tek seferlik görev
  bashcli -w /başka/yol   # farklı workspace

API anahtarı gerekli: ajanı çalıştırıp /provider sihirbazını kullanın.
Sağlayıcı, model ve anahtar yalnızca ~/.bashcli/providers.json içine
kaydedilir (.env'e yazılmaz; .env yalnızca AGENT_MODE gibi ayarlar içindir).
EOF
