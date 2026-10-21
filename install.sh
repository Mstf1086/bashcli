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
#   ./install.sh --no-path       # PATH'i kabuk rc dosyasına otomatik ekleme
#
# Kullanıcı kurulumu (root gerektirmez):
#   git clone <repo> && cd <repo> && ./install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${HOME}/.local"
USE_NPM_GLOBAL=0
DO_ENV=1
DO_PATH=1
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
    --no-path)     DO_PATH=0; shift ;;
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
# Üç ilke (Termux/proot gibi yavaş ortamlar için):
#  1) Native derleme yok: --ignore-scripts. @google/adk → dockerode → ssh2 →
#     cpu-features gibi kullanılmayan native modüllerin node-gyp derlemesi
#     (Node başlıklarını ağdan indirip C++ derler) saatler sürebilir ve takılır.
#     esbuild gibi gerekli paketler scriptsiz de çalışır; bunu smoke test doğrular.
#  2) Ağ takılmasın: fetch timeout + yeniden deneme; --loglevel=http ile her
#     paket isteği görünür, "takıldı mı?" sorusu kalmaz.
#  3) Tekrarda kurma yok: lock değişmediyse atla; kurulum yalnızca smoke test
#     geçince "tamam" olarak işaretlenir (yarım kurulum bir daha atlanmaz).
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else cksum "$1" | cut -d' ' -f1,2; fi
}

# Çalışma zamanı smoke test: prod bağımlılıkları ve giriş noktası yükleniyor mu?
smoke_test() {
  ( cd "$ROOT" && node --input-type=module -e '
      await import("@google/adk");
      await import("@earendil-works/pi-tui");
      await import("zod");
      await import("dotenv");
      await import("tsx/esm/api");
    ' ) >/dev/null 2>&1 \
  && ( cd "$ROOT" && timeout_run node bin/bashcli.mjs --help ) >/dev/null 2>&1
}

timeout_run() {
  # Termux'ta `timeout` yoksa doğrudan çalıştır.
  if command -v timeout >/dev/null 2>&1; then timeout 60 "$@"; else "$@"; fi
}

npm_deps() {
  local attempt
  for attempt in 1 2 3; do
    say "npm kurulumu (deneme $attempt/3)..."
    if ( cd "$ROOT" && npm install --omit=dev --no-audit --no-fund --ignore-scripts \
          --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=2000 \
          --fetch-timeout=60000 --loglevel=http ); then
      return 0
    fi
    warn "npm başarısız (deneme $attempt). Yeniden deneniyor..."
    sleep 3
  done
  return 1
}

STAMP="$ROOT/node_modules/.bashcli-deps"
LOCK_HASH=""
[ -f "$ROOT/package-lock.json" ] && LOCK_HASH="$(hash_file "$ROOT/package-lock.json")"

if [ -n "$LOCK_HASH" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$LOCK_HASH" ] && smoke_test; then
  say "Bağımlılıklar güncel, atlanıyor."
else
  say "Bağımlılıklar kuruluyor. Yavaş cihazlarda (Termux/proot) birkaç dakika sürebilir;"
  say "satırlar aktıkça ilerliyor demektir."
  npm_deps || die "npm kurulumu 3 denemede de başarısız. İnternet bağlantısını kontrol edip aynı komutu tekrar çalıştırın (indirilenler önbellekte kalır)."

  if ! smoke_test; then
    warn "Smoke test başarısız; esbuild betik kurulumu yeniden deneniyor."
    ( cd "$ROOT" && npm rebuild esbuild ) || true
    smoke_test || die "Kurulum doğrulanamadı. Çıktıyı geliştiriciye iletin: (cd $ROOT && node bin/bashcli.mjs --help)"
  fi
  [ -n "$LOCK_HASH" ] && printf '%s\n' "$LOCK_HASH" > "$STAMP"
  say "Bağımlılıklar hazır."
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
# BIN_DIR PATH'te değilse, kullanıcının kabuk rc dosyasına (tekrar eklemeden)
# otomatik ekler. Kapatmak için: --no-path
if [ "$USE_NPM_GLOBAL" -eq 0 ]; then
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      if [ "$DO_PATH" -eq 1 ]; then
        case "$(basename "${SHELL:-}")" in
          zsh)  RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
          bash) if [ "$(uname)" = "Darwin" ] && [ ! -f "$HOME/.bashrc" ]; then RC="$HOME/.bash_profile"; else RC="$HOME/.bashrc"; fi ;;
          *)    RC="$HOME/.profile" ;;
        esac
        LINE="export PATH=\"$BIN_DIR:\$PATH\""
        if [ -f "$RC" ] && grep -qF "$BIN_DIR" "$RC" 2>/dev/null; then
          say "PATH zaten $RC içinde tanımlı."
        else
          { printf '\n# bashcli\n%s\n' "$LINE"; } >> "$RC"
          say "PATH $RC dosyasına eklendi."
        fi
        warn "Yeni bir terminal açın ya da şunu çalıştırın:  source $RC"
      else
        warn "$BIN_DIR PATH'te değil. Eklemek için:"
        echo "     export PATH=\"$BIN_DIR:\$PATH\""
      fi ;;
  esac
fi

cat <<EOF

Kurulum tamam. Şimdi:

  bashcli                 # etkileşimli TUI (workspace = bulunduğunuz dizin)
  bashcli "şunu yap"      # tek seferlik görev
  bashcli -w /başka/yol   # farklı workspace

API anahtarı gerekli: ajanı çalıştırıp /provider sihirbazını kullanın.
Sağlayıcı, model ve anahtar yalnızca ~/.bashcli/providers.json içine
kaydedilir (.env'e yazılmaz; .env yalnızca AGENT_MODE gibi ayarlar içindir).
EOF
