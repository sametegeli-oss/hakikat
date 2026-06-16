@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Hakikat Dergisi Yerel Guncelleme
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi.
  echo Lutfen once Node.js LTS kurun: https://nodejs.org
  echo Sonra bu dosyayi tekrar calistirin.
  pause
  exit /b 1
)

echo Bu islem eksik olan sayilari, kapaklari ve metinleri indirir.
echo Ilk calistirmada uzun surebilir. Sonraki calistirmalarda sadece yeni/eksik sayilar iner.
echo.
set /p SECIM="Tam arsiv icin T, sadece son 12 sayi icin S, varsayilan akilli guncelleme icin Enter: "

if /I "%SECIM%"=="T" (
  node guncelle.js --all
) else if /I "%SECIM%"=="S" (
  node guncelle.js --limit=12 --refresh=12
) else (
  node guncelle.js
)

if errorlevel 1 (
  echo.
  echo Guncelleme hata verdi.
  pause
  exit /b 1
)

echo.
echo Guncelleme tamamlandi.
echo Olusan klasorler:
echo   data\
echo   kapaklar\
echo.
set /p GIT="Bu klasordeki degisiklikleri GitHub'a git push ile yukleyeyim mi? (E/H): "
if /I "%GIT%"=="E" (
  git add index.html data kapaklar guncelle.js guncelle.bat README.md
  git commit -m "Hakikat verisi guncellendi"
  git push
)

echo.
echo Git kullanmiyorsan data ve kapaklar klasorlerini GitHub web arayuzunden yukle.
pause
