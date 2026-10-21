# bashcli

Cline / Claude Code tarzı, TypeScript + Node.js + [Google ADK](https://github.com/google/adk-js)
üzerine kurulu etkileşimli kodlama ajanı TUI'si. OpenAI-uyumlu API'lerle
(ZenMux, OpenAI, OpenRouter, Groq, Ollama, özel endpoint) konuşur; dosya okuma,
yazma, düzenleme, arama ve kabuk komutu çalıştırma araçları sunar.

Sürüm: **0.0.1** — TUI başlığında `bashcli v0.0.1` olarak, düz REPL'de
banner'da görünür. Sürüm `package.json` içindeki `version` alanından okunur.

> **Sürüm politikası:** Sürüm **kullanıcı istemeden artırılmaz**. "version
> arttır" dendiğinde yalnızca **minor** sürüm bir artar (`0.0.1` → `0.1.0`).
> Ayrıntı için [`.cline/rules/surum.md`](.cline/rules/surum.md).

## Kurulum (Linux)

Gereksinimler: **Node.js 20.11+** ve **npm**. Root gerekmez.

```bash
git clone <repo> bashcli && cd bashcli
./install.sh
```

**Tek satır kurulum (önerilen):** dizinleri/dosyaları elle oluşturmanıza gerek yok.

```bash
curl -fsSL https://raw.githubusercontent.com/Mstf1086/bashcli/main/get.sh | bash
```

`get.sh` son sürümü `~/.local/share/bashcli` altına indirir (dizin otomatik
oluşturulur), `install.sh`'i çalıştırır ve `bashcli` komutunu PATH'e ekler.
Aynı komutu tekrar çalıştırmak güncelleme yapar (`.env` ve `node_modules`
korunur). Ek argümanlar `install.sh`'e geçer: `... | bash -s -- --no-path`.
Kurulum dizini için `BASHCLI_DIR`, dal/etiket için `BASHCLI_REF` kullanılabilir.

Gereken tek şey: Node.js 20.11+ ve `curl`.

**Elle kurulum** (repo klonlanmışsa):

`install.sh` şunları yapar:

1. Node sürümünü ve `npm` varlığını doğrular
2. Bağımlılıkları kurar (`npm ci` / `npm install`)
3. `.env` yoksa `.env.example`'dan kopyalar (izinler `0600`)
4. `~/.local/bin/bashcli` shim'ini yazar — ajanın gerçek giriş noktasına
   (`bin/bashcli.mjs`) yönlendirir, böylece ajan güncellendiğinde shim'e
   dokunmaya gerek kalmaz
5. `~/.local/bin` PATH'te değilse kabuk rc dosyasına (`~/.bashrc`, `~/.zshrc`
   veya `~/.profile`) otomatik ekler (`--no-path` ile kapatılır)

Seçenekler:

```bash
./install.sh                 # önerilen: ~/.local/bin shim
./install.sh --prefix DIR    # shim'i DIR/bin altına koy
./install.sh --npm-global    # `npm install -g .` (root gerekebilir)
./install.sh --no-env        # .env hazırlama
./install.sh --uninstall     # shim'i kaldır
```

> `~/.local/bin` PATH'te değilse ekleyin:
> `export PATH="$HOME/.local/bin:$PATH"`
> (kalıcı olsun istiyorsanız: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc`)

Kurulumdan sonra **herhangi bir dizinde** çalışabilirsiniz:

```bash
cd ~/herhangi/bir/proje
bashcli                 # workspace = bulunduğunuz dizin
bashcli "şunu yap"      # tek seferlik görev
bashcli -w /başka/yol   # farklı workspace
```

### Elle kurulum (betiği kullanmadan)

```bash
npm install
cp .env.example .env   # isteğe bağlı: yalnızca AGENT_MODE gibi ayarlar
npm run cli            # yalnızca bu dizinde çalıştırmak için
# ilk çalıştırmada /provider ile sağlayıcı + API anahtarı seçin
```

`.env` yalnızca **sağlayıcı dışı** ayarlar içindir:

```dotenv
AGENT_MODE=build
AGENT_MAX_TOKENS=4096
AGENT_NUM_RETRIES=5
```

> Sağlayıcı, model ve API anahtarı `.env`'e **yazılmaz**; yalnızca
> `~/.bashcli/providers.json` dosyasında saklanır (aşağıya bakın).

## Global kurulum (`bashcli` komutu)

`install.sh` zaten `~/.local/bin/bashcli` shim'ini yazar. Yalnızca shim'i
yeniden yazmak isterseniz (bağımlılık kurmadan):

```bash
./scripts/install-global.sh --shim-only
```

### Ortam değişkenleri nasıl yüklenir?

İki `.env` sırayla yüklenir (**önce tanımlı olan değer kazanır**):

1. **Ajanın kendi `.env`'i** → `AGENT_MODE`, `AGENT_MAX_TOKENS`, ...
2. **Çalışılan projenin `.env`'i** → proje-özeli ek ayarlar

**Sağlayıcı değişkenleri (`PROVIDER`, `AGENT_MODEL`, `*_API_KEY`, `*_API_BASE`,
`OPENAI_BASE_URL`, ...) `.env` dosyalarından yüklenmez**; `.env` içinde olsalar
bile yok sayılır. Sağlayıcı bilgisi yalnızca `~/.bashcli/providers.json`'dan
(`/provider` sihirbazı) gelir. Shell'de `export` edilmiş değişkenler ise
yedek olarak okunmaya devam eder. Bu, güvenilmeyen bir projenin `.env`'inin
base URL'i değiştirip anahtarı başka bir sunucuya yönlendirmesini de önler.

### Sağlayıcı doğrulaması

`/provider` sihirbazı, kaydetmeden önce API anahtarını **gerçek bir istekle**
doğrular. Anahtarın biçimi başka bir sağlayıcıya aitse (ör. `sk-or-v1-…`
OpenRouter, `sk-ai-v1-…` ZenMux) **uyarı** verilir ve doğru sağlayıcı önerilir;
kayıt engellenmez, kullanıcı seçtiği sağlayıcıda kalmaya devam edebilir. Yanlış
sağlayıcıya ait anahtar kaydedilirse tüm istekler reddedileceği için uyarıyı
dikkate alın. Aktif sağlayıcı, seçim listesinde `(aktif)` etiketiyle işaretlenir.

Ayarlar:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `AGENT_MAX_TOKENS` | `4096` | İstek başına azami üretim token'ı. Düşük bakiyeli hesaplarda sağlayıcının azami değerini istememek için gereklidir. |
| `AGENT_NUM_RETRIES` | `5` | Geçici hatalarda (429/5xx) yeniden deneme sayısı. |
| `AGENT_DEBUG` | — | `1` ise LLM hatalarını stderr'e yazar. |
| `BASHCLI_HOME` | ev dizini | Kullanıcı ayarlarının (API anahtarı) tutulduğu kök dizin. Testler bunu geçici bir dizine yönlendirir. |
| `BASHCLI_ENV` | ajan kökündeki `.env` | Ajanın kendi `.env` dosyasının yolu (yalnızca sağlayıcı dışı ayarlar). Testler bunu geçici bir dosyaya yönlendirir. |

### Sağlayıcı taban URL'leri

Her sağlayıcının kendi ucu `src/providers.ts` içinde `defaultBase` ile tanımlıdır.
Bu değer **boş bırakılmaz**: boş bir sağlayıcı, isteği varsayılan adrese
(ZenMux) düşürür ve o sağlayıcının anahtarını yanlış yere gönderir — kullanıcı
anlamsız bir "HTTP 403" görür. Base URL'si olmayan tek sağlayıcı `custom`
dur (URL kullanıcıdan alınır).

| Sağlayıcı | Taban URL |
|---|---|
| ZenMux | `https://zenmux.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Ollama | `http://localhost:11434/v1` |

### Google Gemini uyumluluğu

Gemini 3.x, araç çağrısından sonraki istekte `thought_signature`'ın geri
gönderilmesini **zorunlu** tutar; imza yoksa API `HTTP 400` döner
("Function call is missing a thought_signature in functionCall parts").
bashcli imzayı yanıttan alıp bir sonraki istekte `extra_content` altında
gönderir, böylece araç kullanan akışlar sorunsuz çalışır.

Ayrıca Gemini'da 2.5 serisi yeni kullanıcılara kapalıdır ("no longer available
to new users"); varsayılan model 3.x serisidir. Model listesi yalnızca sohbet
için uygun modelleri gösterir (görsel/TTS/transcribe/embedding/video elenir).

## Kullanım

```bash
npx tsx src/cli.ts                        # interaktif REPL
npx tsx src/cli.ts "görevi yap"           # tek seferlik görev
npx tsx src/cli.ts -w /yol -m plan        # hedef dizin + mod
```

### Klavye

| Tuş | İşlev |
|---|---|
| `TAB` | mod döngüsü (plan → build → auto) |
| `CTRL+TAB` | otomatik onayı aç/kapa (kapalıyken araçlar onay ister) |
| `CTRL+T` | aynı işlev (Termux ve benzeri terminallerde alias) |
| `/` + `Enter` | komut penceresi (ok tuşlarıyla gez, `Enter` seç) |
| `/` + `↑`/`↓` + `Enter` | seçili komutu doğrudan çalıştırır (penceresi açılır) |
| `↑` / `↓` | komut geçmişi (girdi satırında) / menüde gezinme |
| `Ctrl-A` / `Ctrl-E` | satır başı / satır sonu |
| `Ctrl-U` | satırı temizle |
| `Ctrl-C` | iptal |
| `Esc` | çalışan isteği iptal et / menüyü kapat |

> **Not (Termux):** Termux Kitty keyboard protocolünü desteklemez ve
> `CTRL+TAB` tuşunu düz `TAB` olarak gönderir; bu yüzden orada onay
> değiştirmek için **`CTRL+T`** (veya **`/approve`** komutu) kullanılır.
> Durum satırı hangi tuşun geçerli olduğunu gösterir.

> **Not:** Ok tuşları hem klasik (`ESC [ A/B`) hem Kitty keyboard protocol
> biçiminde çalışır; Kitty etkinleştirilemeyen terminallerde menülerde
> seçim değiştirilebilir olur. Menüler ekranın altında, durum satırının
> (TAB ipuçları) hemen üstünde açılır ve arka planları ekranın **tam
> genişliğini** kaplar.

### Komut geçmişi (↑ / ↓)

Girdi satırında `↑` ve `↓` tuşlarıyla daha önce gönderdiğiniz komutlar
arasında gezinilir:

- `↑` → bir önceki (daha eski) komut
- `↓` → bir sonraki (daha yeni) komut
- En eski kayıtta `↑` durur; en yeni kayıtta `↓` yazdığınız metne döner
  (yazdığınız metin kaybolmaz)

Geçmiş, otomatik tamamlama listesi açıkken veya girdi birden fazla satıra
sarmalanmışken devre dışıdır — o durumda ok tuşları listenin/imlecin
hareketi içindir. Aynı geçmiş düz REPL ile TUI arasında paylaşılır.

### Menülerde arama

Sağlayıcı, model, komut paleti, ayarlar ve oturum geçmişi menülerinin
hepsinde üstte bir **arama kutusu** bulunur. Yazdığınız metne göre sonuçlar
fuzzy eşleşmeyle süzülür (en iyi eşleşme üstte) — arama etiket, açıklama
ve değer üzerinde yapılır:

| Tuş | İşlev |
|---|---|
| yazdırılabilir karakterler | arama metnini yaz |
| `Backspace` | son karakteri sil |
| `Ctrl-U` | arama metnini temizle |
| `↑` / `↓` | sonuçlar arasında gezinme |
| `Enter` | seçili sonucu onayla |
| `Esc` | menüyü kapat |

### Komutlar

`/provider` (sağlayıcı + model sihirbazı) · `/model` · `/settings` · `/history` ·
`/compact` · `/clear` · `/tools` · `/mode plan|build|auto` · `/approve on|off` ·
`/rules` · `/keys` · `/tokens` · `/help` · `/quit`

| Komut | İş |
|---|---|
| `/provider` | Sağlayıcı seç → API anahtarı (gizli) → model listesi. Anahtar kaydetmeden önce doğrulanır. |
| `/model` | Aktif sağlayıcının model listesini getirir ve seçim yapar. |
| `/approve` | Otomatik onayı aç/kapa (`on`/`off`). Kapalıyken `write_file`, `edit_file` ve `run_command` onay ister. |
| `/settings` | Modu değiştir, model/alan bilgilerini göster. |
| `/rules` | Aktif proje kurallarını ve ignore listesini gösterir. |
| `/keys` | Sağlayıcı API anahtarlarını, base URL'lerini ve modellerini gösterir. |
| `/tokens` | Birikmiş token tüketimini gösterir (giriş / çıkış / toplam). |
| `/history` | Kaydedilmiş önceki oturumları listeler; seçilen oturum **yeniden yüklenir** ve ajan o bağlamı görür. |
| `/compact` | Geçmişi modele özetlettirir; bağlam sıkıştırılır. |
| `/clear` | Ekranı temizler, mevcut oturumu diske kaydeder ve **yeni bir bağlam** (yeni oturum) oluşturur. |
| `/tools` | Ajan araçlarını **Araçlar penceresinde** listeler. |
| `/mode` | `plan` / `build` / `auto` modunu değiştirir. |
| `/help` | Tüm komutları gösteren komut penceresini açar. |
| `/quit` | Ajanı kapatır. |

Oturum geçmişi `<ajan kökü>/.bashcli/sessions/` altında saklanır; her tur
sonunda otomatik kaydedilir. Böylece `/clear` sonrasında bile önceki
konuşmalar `/history` ile geri yüklenebilir.

#### Komut kısaltmaları

Komut adının **baş harflerini yazarak** da çağırabilirsiniz. Enter'a bastığınızda
ilgili menü doğrudan açılır:

| Yazdığınız | Açılan |
|---|---|
| `/prov` | Sağlayıcı menüsü |
| `/sett` | Ayarlar menüsü |
| `/tok` | Token tüketimi |
| `/hist` | Oturum geçmişi |
| `/mod` | Mod değiştirme |
| `/ru` | Proje kuralları |
| `/ke` | API anahtarları |

Büyük/küçük harf duyarsızdır (`/PROV` de çalışır). Birden fazla komut aynı
önekle başlıyorsa (`/m` → `/model` **ve** `/mode`) eşleşenler seçim menüsünde
listelenir; hangisini çalıştıracağınıza siz karar verirsiniz. Kısaltmalar hem
TUI'da hem düz REPL'de çalışır.

### Sağlayıcı ayarları nerede saklanır?

`/provider` ile eklenen sağlayıcı bilgisi (API anahtarı dâhil) **kullanıcının
cihazında** `~/.bashcli/providers.json` dosyasına yazılır (izinler `0600`,
yalnızca sahibi okuyabilir). Ajanın kendi `.env` dosyasına dokunulmaz; bu
sayede anahtar ajan güncellendiğinde ya da başka bir dizine taşındığında
korunur.

```bash
# Kayıtlı sağlayıcıyı görmek
cat ~/.bashcli/providers.json
```

## Modlar

- **plan** — salt okunur; dosya yazmaz, komut çalıştırmaz, uygulama planı üretir.
- **build** — değişiklikleri yapar, `run_command` ile doğrular, özetler.
- **auto** — kesintisiz çalışır, yalnızca gerçekten engellenirse sorar.

## Araçlar

| Araç | Açıklama |
|---|---|
| `list_files` | dizin listeleme (opsiyonel özyineleme) |
| `read_file` | satır numaralı dosya okuma (offset/limit) |
| `write_file` | dosya oluşturma / tamamen yeniden yazma |
| `edit_file` | dosyada birebir metin değişimi (benzersiz blok) |
| `search_files` | regex arama (grep benzeri) |
| `run_command` | çalışma alanında kabuk komutu |
| `get_api_key` | sağlayıcı API anahtarlarını okur (salt okunur) |

Tüm araçlar `CODING_WORKSPACE` kökü dışına erişimi reddeder.

### Onay kapısı (ADK `beforeToolCallback`)

`write_file`, `edit_file` ve `run_command` çalıştırılmadan önce onay ister
(`/approve off` veya TUI'de `CTRL+TAB` ile kapatılır). Bu kural **tek yerde**
durur (`APPROVAL_REQUIRED_TOOLS`): ADK'nın `beforeToolCallback` mekanizması
üzerinden kurulur, araç gövdelerine onay kodu gömülmez. Onaylanmayan araç
**hiç çalıştırılmaz**; modele "Kullanıcı onaylamadı" mesajı gider.

### Token tüketimi

Model çağrılarının gerçek token tüketimi ADK'nın `usageMetadata` alanından
alınır ve biriktirilir. Durum satırında kısa biçimde (`1.3k`), `/tokens`
komutuyla ayrıntılı (giriş / çıkış / toplam) görülür. Bakiye takibi için
kullanışlıdır.

### İptal (ESC)

`ESC` yalnızca ekranı temizlemez: ADK'nın `abortSignal`'ı hem açık HTTP
isteğini düşürür hem de çalışan `run_command` alt sürecini sonlandırır.

### `get_api_key` — ajan sağlayıcı anahtarlarını görebilir

Anahtarlar iki yerde durur ve ikisi de ajanın dosya araçlarına kapalıdır:
`~/.bashcli/providers.json` (workspace dışı) ve `.env` (ignore listesinde).
Bu yüzden ajan anahtarı **ayrı bir araçla** okur:

- `provider` verilmezse → anahtarı olan tüm sağlayıcılar listelenir
- `provider` verilirse → o sağlayıcının anahtarı, base URL'i ve modeli
- Anahtarlar **maskelenmeden** döner; amaç zaten ajanın kullanabilmesidir
- Araç **salt okunurdur**; `plan` modunda da kullanılabilir, onay istemez
- Her turda sistem talimatına gömülmez; yalnızca model çağırdığında bağlama girer

```bash
# Ajanın görebildiği anahtarları siz de görün
/keys
```

> **Güvenlik notu:** `get_api_key` yanıtı konuşma bağlamına girdiği için anahtar,
> kullandığınız LLM sağlayıcısına istek gövdesinde taşınır. Oturum dosyalarına
> (`<ajan kökü>/.bashcli/sessions/`) yazılırken bilinen anahtar değerleri
> `[api-anahtari-gizlendi]` ile maskelenir (`src/secrets.ts`).

## Proje kuralları (`.bashcli/rules`)

Çalışan projenin kökünde `.bashcli/rules` altına **Markdown** kural dosyaları
koyabilirsiniz. İçerikleri ajanın sistem talimatına eklenir; model bunlara
uymak zorundadır.

İki biçim desteklenir:

```
proje/
└── .bashcli/
    ├── rules/          # ya da tek dosya: rules.md
    │   ├── stil.md
    │   └── test.md
    └── ignore
```

- `.bashcli/rules/*.md` — dizindeki tüm `.md` dosyaları **alfabetik sırayla**
  yüklenir.
- `.bashcli/rules.md` — tek dosya biçimi.
- İkisi birden varsa ikisi de yüklenir (önce dizin, sonra tek dosya).

### Cline uyumlu kurallar (`.cline/rules`)

`.cline/rules/*.md` dizini de taranır — böylece aynı kural dosyası hem
Cline'da hem bu ajanda geçerli olur. Cline'in YAML frontmatter'ı
desteklenir; frontmatter modele **gönderilmez** (metadata, içerik değil),
yalnızca `description` kural başlığına eklenir:

```md
---
description: Token tasarrufu kuralları
globs: ["**/*"]
alwaysApply: true
---

# Token Tasarrufu

- Önce ara, sonra oku.
```

> `.cline` dizini her zaman gizlidir: `list_files`/`read_file` ile içeriği
> okunamaz (kurallar zaten sistem talimatıyla modele gider).

Kural dosyası örneği (`stil.md`):

```md
# Proje kuralları

- Yanıtlar Türkçe olmalı.
- Değişiklikten sonra `npm test` çalıştırılmalı.
- Yeni dosyalarda TypeScript strict mod kullanılmalı.
```

Kurallar **her istekte yeniden okunur**: oturum ortasında kural dosyasını
düzenleyip bir sonraki mesajda yeni kuralın geçerli olması yeterlidir,
yeniden başlatma gerekmez.

Aktif kuralları görmek için `/rules` komutunu kullanın.

## Ignore listesi (`.bashcli/ignore` ve `.clineignore`)

Ignore dosyaları, **modele gönderilmeyecek** yolları tanımlar.
Bu yollar `list_files`, `search_files` ve `read_file` araçlarında görünmez;
içerikleri modele hiç ulaşmaz.

```bash
# proje/.bashcli/ignore
node_modules
.venv
build/
*.log
src/generated
!src/generated/keep.txt
```

| Desen | Anlamı |
|---|---|
| `#` ile başlayan satır | yorum |
| `node_modules` | her derinlikte aynı adlı dosya/dizin |
| `build/` | yalnızca dizinler |
| `src/generated` | köke göreli yol (altındaki tüm dosyalar dâhil) |
| `*.log` | glob (`*` tek segment, `**` çok segment) |
| `!pattern` | istisna — son eşleşen desen kazanır |

- Bu dosya **yoksa** gömülü varsayılanlar kullanılır: `.git`, `.venv`,
  `venv`, `node_modules`, `__pycache__`, `.mypy_cache`, `.pytest_cache`,
  `.ruff_cache`, `.cache`, `dist`, `build`.
- Dosya **varsa** o listenin yerini alır (varsayılanlar eklenmez).
- `.git` ve `.bashcli` **her zaman** gizlidir; `!` deseniyle bile açılamaz.
- Yazma (`write_file`/`edit_file`) engellenmez; ignore yalnızca modele
  gönderilen içeriği etkiler.

### `.clineignore` (Cline ile paylaşılan)

Proje kökündeki `.clineignore` dosyası da uygulanır — Cline ile aynı liste
paylaşılır. Gitignore sözdizimini kullanır.

**Öncelik sırası:**

| Durum | Uygulanan liste |
|---|---|
| `.bashcli/ignore` **yok**, `.clineignore` yok | gömülü varsayılanlar |
| `.bashcli/ignore` **yok**, `.clineignore` var | varsayılanlar + `.clineignore` |
| `.bashcli/ignore` var, `.clineignore` yok | `.bashcli/ignore` (varsayılanların yerine) |
| ikisi de var | `.clineignore` + `.bashcli/ignore` |

Sıra önemlidir: `!` istisnalarında **son eşleşen** kazanır. `.clineignore`
önce, `.bashcli/ignore` sonra gelir — böylece proje özel istisna genel
istisnayı geçersiz kılar.

> **Güvenlik:** `.env` (API anahtarları) `.clineignore` ile gizlenmelidir;
> `.env.example` ise `!.env.example` istisnasıyla görünür kalır.
> `.clineignore` ve `.gitignore` dosyalarının kendisi de her zaman gizlidir.

## Testler

```bash
npm run typecheck       # tsc --noEmit
npm test                # araç testleri + sahte API ile uçtan uca test
npm run test:tools      # sadece araç testleri
npm run test:mock       # sadece sahte API testi
npm run test:project    # .bashcli/rules + .bashcli/ignore testleri
npm run test:adk        # onay kapısı + iptal (abort) testleri
```

Tüm testler sahte (mock) API'ye bağlanır; gerçek anahtar harcanmaz ve
`~/.bashcli` altındaki ayarlarınıza dokunmaz.

`AGENT_DEBUG=1` ile LLM hataları ayrıntılı loglanır.
