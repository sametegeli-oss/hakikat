# DilAvatar ortak kullanım

Bu pakette `avatar.js` ortak kütüphanedir.

GitHub Pages klasör yapısı:

/dilharita/avatar.js
/dilharita/avatar_ayar.html
/dilharita/avatar_demo.html
/dilharita/index.html
/dilharita/practice.html
/dilharita/videopractice.html

Bütün HTML sayfalarında avatarı şöyle çağır:

<script src="/dilharita/avatar.js"></script>

Alt klasördeki sayfalarda `./avatar.js` kullanma.
Çünkü alt klasörde olursa tarayıcı dosyayı o alt klasörde arar ve 404 verir.

Örnek:

<div id="avatarHost"></div>
<script src="/dilharita/avatar.js"></script>
<script>
  window.addEventListener("DOMContentLoaded", function(){
    DilAvatar.mount("avatarHost");
    DilAvatar.speakText("merhaba bugün ingilizce çalışıyoruz", 3200);
  });
</script>
