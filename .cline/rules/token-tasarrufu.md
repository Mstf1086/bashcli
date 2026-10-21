---
description: Token tasarrufu kuralları — okuma, arama ve düzenleme stratejileri
globs: ["**/*"]
alwaysApply: true
---

# Token Tasarrufu Kuralları

Ajan her turda modele gönderilen bağlamı (system prompt, geçmiş, dosya içerikleri)
kontrol edemez; **ne okuduğunu ve ne gönderdiğini sen belirliyorsun.** Aşağıdaki
kurallar bu yüzden bağlam penceresini korumak içindir.

## 1. Önce ara, sonra oku

- **Bir dosyanın tamamını okumadan önce hedefli taramasını yap.** `search_files`
  ile ilgili satırları bul, sonra o satırların çevresini oku.
- Bir dosyanın tamamını ancak **gerçekten değiştireceksen** oku. Okuyup
  dokunmayacaksan hiç okuma.
- Arama sonuçları zaten bağlam sağlar; aynı dosyayı ikinci kez tam okuma.

## 2. Okuma disiplini

- `read_file` çağrısında gereksinenden fazlasını alma. Üç satırlık bir
  fonksiyon için 300 satırlık dosyayı gönderme.
- Bir dosyanın **yapısını** öğrenmek için `list_files` + kısa bir `read_file`
  (ilk ~60 satır) yeterlidir.
- Aynı dosyayı ikinci kez okumadan önce: ilk okumadan ne eksikti? Sadece
  eksik kısmı oku.

## 3. Yazma disiplini

- Dosya düzenlerken **yalnızca değişen satırları** hedefle. `edit_file`
  kullan; dosyayı baştan yazma.
- Yeni dosya oluştururken gereksiz bölüm (docstring, yorum, test) ekleme.
  İstendiği kadar yaz.
- Kod üretirken tekrar eden bloklardan kaçın; kısa ve okunur kod tercih et.

## 4. Konuşma disiplini

- **Tek seferde tek iş iste.** "Şunu yap ve bir de şunu" cümlelerinde iki ayrı
  konuşma turu daha verimlidir.
- Dosya yolu, fonksiyon adı, satır numarası gibi referansları kısa ver;
  gereksiz tekrardan kaçın.
- Aynı dosyayı/hatayı defalarca açıklama — bir kez açıkla, sonra sonuca odaklan.
- Yanıtlar Türkçe ve **kısa** olmalı. Kod zaten ayrıntıyı taşır; açıklama
  onu tekrarlamamalı.

## 5. Araç kullanımı

- Birden fazla bağımsız arama/işlemi **tek seferde paralel** çalıştır.
- `list_files` çıktısı büyükse sonuçları süz; tüm ağacı modele gönderme.
- Test/log çıktısını özetle; ham yüzlerce satırı modele aktarma. Hata
  mesajının ilgili satırları yeterlidir.

## 6. Bağlamı temiz tut

- Uzun bir işin ortasında gereksiz dosyaları yeniden okuma.
- Tamamlanan adımların detaylarını özetle, ham çıktıyı taşıma.
- Kullanıcı yeni bir konuya geçtiyse önceki bağlamı gereksizce uzatma.

## Özet kontrol listesi

Göndermeden önce sor:
1. Bu içeriğin **tamamı** gerekli mi, yoksa bir kısmı yeterli mi?
2. Bu bilgiyi **zaten** biliyor muyum?
3. Daha kısa bir yol var mı (arama > tam okuma, edit > yeniden yaz)?
