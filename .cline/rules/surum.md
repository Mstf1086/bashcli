---
description: Sürüm kuralları — package.json sürümünün ne zaman artırılacağı
globs: ["**/*"]
alwaysApply: true
---

# Sürüm Kuralları

Sürüm, `package.json` içindeki `version` alanıdır. `src/version.ts` buradan
okur; TUI başlığında `bashcli v<version>` olarak, düz REPL'de banner'da
görünür.

## 1. Sürüm asla kendiliğinden artmaz

- Değişiklik, hata düzeltme, özellik ekleme veya refactor **sürümü otomatik
  olarak yükseltmez**.
- Sürümü yalnızca kullanıcı açıkça istediğinde değiştir.

## 2. "Version arttır" → minor artış

Kullanıcı **"version arttır"** (veya eşdeğeri: "sürümü arttır") dediğinde:

- **Minor** sürüm bir artırılır: `0.0.1` → `0.1.0`.
- Patch (`0.0.2`) veya major (`1.0.0`) artışı **kendiliğinden yapılmaz**;
  bunun için ayrıca açık istek gerekir.
- Değişiklik yalnızca `package.json` içindeki `version` alanındadır.

## 3. Sürümü gösteren yerler eşitlenir

- `package.json` → `version` alanı güncellenir.
- README'deki "Sürüm: **x.y.z**" satırı elle eşitlenir.
- TUI başlığı ve REPL banner'ı sürümü `package.json`'dan okuduğu için
  otomatik güncellenir; elle düzenleme gerekmez.
