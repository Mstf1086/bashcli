#!/usr/bin/env bash
# bashcli — tek satır kurulum (hiçbir dizini/dosyayı elle oluşturmaya gerek yok).
#
#   curl -fsSL https://raw.githubusercontent.com/Mstf1086/bashcli/main/get.sh | bash
#
# Ne yapar:
#   1) Son sürümü indirir ve ~/.local/share/bashcli altına açar (dizin otomatik oluşturulur).
#   2) install.sh'i çalıştırır: bağımlılıklar, .env, ~/.local/bin/bashcli komutu, PATH ayarı.
#
# Ek argümanlar install.sh'e geçer:
#   curl -fsSL .../get.sh | bash -s -- --no-path
#
# Ortam değişkenleri (hepsi isteğe bağlı):
#   BASHCLI_DIR      kurulum dizini (varsayılan: ~/.local/share/bashcli)
#   BASHCLI_REF      dal/etiket (varsayılan: main)
#   BASHCLI_REPO     kullanıcı/repo (varsayılan: Mstf1086/bashcli)
#   BASHCLI_TARBALL  indirme adresini tamamen değiştirir (test için)
#
# Not: tüm betik main() içinde; `curl | bash` ile çalışırken alt süreçlerin
# stdin'i okuyup betiği yarıda kesmesi engellenir.

set -euo pipefail

say()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31mHATA:\033[0m %s\n' "$*" >&2; exit 1; }

main() {
  local repo="${BASHCLI_REPO:-Mstf1086/bashcli}"
  local ref="${BASHCLI_REF:-main}"
  local dest="${BASHCLI_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/bashcli}"
  local url="${BASHCLI_TARBALL:-https://github.com/$repo/archive/refs/heads/$ref.tar.gz}"

  command -v curl >/dev/null 2>&1 || die "curl bulunamadı."
  command -v tar  >/dev/null 2>&1 || die "tar bulunamadı."
  [ -n "${HOME:-}" ] || die "HOME tanımlı değil."

  # Tehlikeli hedefleri reddet (kurulum dizini silinip yeniden yazılabilir).
  case "$dest" in
    ""|"/"|"$HOME"|"$HOME/") die "Geçersiz kurulum dizini: '$dest'" ;;
  esac

  local tmp
  tmp="$(mktemp -d)"
  # Çift tırnak: yol trap tanımlanırken genişler (main() bitince yerel değişken kalmaz).
  trap "rm -rf '$tmp'" EXIT

  say "İndiriliyor: $url"
  curl -fsSL "$url" -o "$tmp/src.tar.gz" </dev/null \
    || die "İndirme başarısız (repo/dal doğru mu, internet var mı?)."
  mkdir -p "$tmp/x"
  tar xzf "$tmp/src.tar.gz" -C "$tmp/x" --strip-components=1 </dev/null \
    || die "Arşiv açılamadı."
  [ -f "$tmp/x/install.sh" ] || die "Arşivde install.sh yok."

  # Mevcut kurulum varsa güncelle: .env ve node_modules korunur, gerisi yenilenir.
  if [ -d "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
    [ -f "$dest/bin/bashcli.mjs" ] \
      || die "$dest dolu ve bir bashcli kurulumu değil; başka bir dizin için BASHCLI_DIR verin."
    say "Mevcut kurulum güncelleniyor: $dest"
    find "$dest" -mindepth 1 -maxdepth 1 ! -name .env ! -name node_modules -exec rm -rf {} +
  else
    say "Kurulum dizini oluşturuluyor: $dest"
  fi
  mkdir -p "$dest"
  cp -a "$tmp/x/." "$dest/"

  cd "$dest"
  chmod +x install.sh
  ./install.sh "$@" </dev/null
}

main "$@"
