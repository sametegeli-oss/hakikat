# Hakikat Dergisi Okuyucu

GitHub Pages için statik okuyucu.

- `index.html`: okuyucu ekranı
- `data/index.json`: sayı listesi ve kapak URL'leri
- `scripts/build-hakikat-data.mjs`: Hakikat sitesinden kapak ve sayı verisini çeken Node script
- `.github/workflows/update-hakikat.yml`: GitHub Action ile veriyi otomatik günceller

## Kullanım

1. Bu klasördeki her şeyi repoya yükle.
2. GitHub > Settings > Pages bölümünde `main / root` seç.
3. Actions sekmesine gir, `Hakikat verisini güncelle` workflow'unu elle çalıştır.
4. Site: `https://sametegeli-oss.github.io/hakikat/`
