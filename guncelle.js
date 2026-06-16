#!/usr/bin/env node
/*
  Hakikat Dergisi yerel veri güncelleyici
  - Ek hizmet kullanmaz.
  - Hakikat sitesini senin bilgisayarından okur.
  - data/*.json ve kapaklar/*.jpg üretir.
  - Node.js 18+ gerekir.
*/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const child_process = require('child_process');

const BASE = 'https://www.hakikat.com';
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const COVER_DIR = path.join(ROOT, 'kapaklar');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const args = parseArgs(process.argv.slice(2));
const FULL = !!args.all || !!args.tum || !!args.full;
const LIMIT = Number(args.limit || args.son || 0);
const FROM = args.from ? Number(args.from) : null;
const TO = args.to ? Number(args.to) : null;
const PUSH = !!args.push;
const REFRESH_LATEST = Number(args.refreshLatest || args.refresh || 2);
const SLEEP_MS = Number(args.sleep || 350);

main().catch(err => {
  console.error('\nHATA:', err && err.stack ? err.stack : err);
  process.exit(1);
});

async function main() {
  banner();
  await ensureDirs();

  console.log('Ana dergi listesi okunuyor...');
  const mainHtml = await fetchText(`${BASE}/hakikat-dergisi`);
  const parsedIssues = parseIssuesFromHtml(mainHtml);
  if (!parsedIssues.length) throw new Error('Dergi listesi bulunamadı. Site yapısı değişmiş olabilir.');

  const oldIndex = await readJson(INDEX_FILE, { issues: [] });
  const oldMap = new Map((oldIndex.issues || []).map(x => [Number(x.no), x]));

  let issues = parsedIssues.map(x => {
    const old = oldMap.get(Number(x.no)) || {};
    return {
      ...old,
      ...x,
      no: Number(x.no),
      url: x.url || old.url || `${BASE}/hakikat-dergisi/${x.no}-sayi`,
      sourceCover: x.sourceCover || old.sourceCover || '',
      cover: old.cover || '',
      localCover: old.localCover || '',
      contentFile: `data/${x.no}.json`,
      updatedAt: old.updatedAt || null,
      sentenceCount: old.sentenceCount || 0,
      articleCount: old.articleCount || 1
    };
  }).sort((a, b) => b.no - a.no);

  const selected = selectIssuesToUpdate(issues);
  console.log(`Toplam sayı: ${issues.length}`);
  console.log(`Bu çalıştırmada güncellenecek: ${selected.length}`);
  if (!selected.length) {
    await writeIndex(issues);
    console.log('Yeni/missing içerik yok. index.json yine de güncellendi.');
    return;
  }

  for (let i = 0; i < selected.length; i++) {
    const issue = selected[i];
    console.log(`\n[${i + 1}/${selected.length}] ${issue.no}. sayı (${issue.date})`);
    try {
      await updateIssue(issue, i < REFRESH_LATEST);
    } catch (err) {
      issue.error = String(err.message || err);
      console.error(`  ! Bu sayı güncellenemedi: ${issue.error}`);
    }
    await sleep(SLEEP_MS);
  }

  await writeIndex(issues);
  console.log('\nBitti. Oluşturulan ana dosya: data/index.json');
  console.log('Kapak klasörü: kapaklar/');

  if (PUSH) await gitPush();
  console.log('\nGitHub Pages kullanıyorsan: index.html, data/ ve kapaklar/ dosyalarını GitHub’a yükle veya git push yap.');
}

function banner() {
  console.log('========================================');
  console.log(' Hakikat Dergisi Yerel Güncelleyici');
  console.log('========================================');
}

function parseArgs(parts) {
  const out = {};
  for (const p of parts) {
    if (p.startsWith('--')) {
      const [k, v] = p.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    }
  }
  return out;
}

function selectIssuesToUpdate(issues) {
  let arr = issues.slice();
  if (FROM !== null) arr = arr.filter(x => x.no >= FROM);
  if (TO !== null) arr = arr.filter(x => x.no <= TO);
  if (LIMIT > 0) arr = arr.slice(0, LIMIT);

  if (FULL) return arr;

  // Varsayılan: yeni/missing dosyaları indir, ayrıca en yeni birkaç sayıyı tazele.
  const latestNos = new Set(issues.slice(0, REFRESH_LATEST).map(x => x.no));
  return arr.filter(x => {
    const jsonPath = path.join(ROOT, `data/${x.no}.json`);
    const hasJson = fs.existsSync(jsonPath);
    const hasCover = x.localCover && fs.existsSync(path.join(ROOT, x.localCover));
    return latestNos.has(x.no) || !hasJson || !hasCover;
  });
}

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(COVER_DIR, { recursive: true });
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HakikatLocalUpdater/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7'
    }
  });
  if (!r.ok) throw new Error(`${url} okunamadı: HTTP ${r.status}`);
  return await r.text();
}

async function fetchBuffer(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HakikatLocalUpdater/1.0',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': `${BASE}/hakikat-dergisi`
    }
  });
  if (!r.ok) throw new Error(`${url} indirilemedi: HTTP ${r.status}`);
  const type = (r.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, type };
}

function parseIssuesFromHtml(html) {
  const anchors = extractAnchors(html);
  const issues = [];
  const seen = new Set();

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const text = normalizeSpace(a.text);
    const m = text.match(/(\d{1,3})\s*\.\s*SAYI\s*,\s*([A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû]+\s+\d{4})/i);
    if (!m) continue;
    const no = Number(m[1]);
    if (seen.has(no)) continue;
    seen.add(no);

    let sourceCover = '';
    for (let j = i + 1; j < Math.min(anchors.length, i + 8); j++) {
      const b = anchors[j];
      const ht = (b.href || '').toLowerCase();
      const bt = normalizeSpace(b.text).toLowerCase();
      if (bt.includes('büyüt') || /\.(jpg|jpeg|png|webp)(\?|$)/i.test(ht)) {
        if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(ht)) {
          sourceCover = absUrl(b.href);
          break;
        }
      }
      if (normalizeSpace(b.text).match(/\d{1,3}\s*\.\s*SAYI/i)) break;
    }

    issues.push({
      no,
      date: m[2],
      title: `${no}.SAYI, ${m[2]}`,
      url: absUrl(a.href) || `${BASE}/hakikat-dergisi/${no}-sayi`,
      sourceCover,
      cover: '',
      localCover: '',
      topics: []
    });
  }
  return issues.sort((a, b) => b.no - a.no);
}

function extractAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const href = getAttr(attrs, 'href');
    const text = htmlToText(m[2] || '');
    out.push({ href, text, index: m.index });
  }
  return out;
}

function extractImages(html) {
  const out = [];
  const re = /<img\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    out.push({
      src: absUrl(getAttr(attrs, 'src')),
      alt: decodeEntities(getAttr(attrs, 'alt') || ''),
      title: decodeEntities(getAttr(attrs, 'title') || '')
    });
  }
  return out;
}

function getAttr(attrs, name) {
  const re = new RegExp(name + "\\s*=\\s*(['\"])(.*?)\\1", 'i');
  const m = attrs.match(re);
  return m ? m[2].replace(/&amp;/g, '&') : '';
}

async function updateIssue(issue, forceRefresh) {
  const jsonPath = path.join(DATA_DIR, `${issue.no}.json`);
  let issueHtml = '';
  const needsJson = forceRefresh || !fs.existsSync(jsonPath);

  if (needsJson || !issue.sourceCover) {
    console.log('  Sayfa okunuyor:', issue.url);
    issueHtml = await fetchText(issue.url);
  }

  if (!issue.sourceCover && issueHtml) {
    issue.sourceCover = findCoverInIssueHtml(issueHtml, issue.no);
  }

  await ensureCover(issue, issueHtml);

  if (needsJson) {
    if (!issueHtml) issueHtml = await fetchText(issue.url);
    const parsed = parseIssuePage(issueHtml, issue);
    const content = {
      no: issue.no,
      date: issue.date,
      title: issue.title,
      url: issue.url,
      sourceCover: issue.sourceCover || '',
      cover: issue.localCover || '',
      localCover: issue.localCover || '',
      topics: parsed.topics,
      articles: parsed.articles,
      rawTextLength: parsed.rawTextLength,
      sentenceCount: parsed.sentenceCount,
      updatedAt: new Date().toISOString()
    };
    await writeJson(jsonPath, content);
    issue.topics = parsed.topics;
    issue.articleCount = parsed.articles.length;
    issue.sentenceCount = parsed.sentenceCount;
    issue.updatedAt = content.updatedAt;
    console.log(`  İçerik yazıldı: data/${issue.no}.json (${issue.sentenceCount} cümle)`);
  } else {
    const old = await readJson(jsonPath, null);
    if (old) {
      issue.topics = old.topics || issue.topics || [];
      issue.articleCount = old.articles ? old.articles.length : issue.articleCount;
      issue.sentenceCount = old.sentenceCount || issue.sentenceCount || 0;
      issue.updatedAt = old.updatedAt || issue.updatedAt || null;
    }
    console.log('  İçerik zaten var, atlandı.');
  }
}

async function ensureCover(issue, issueHtml) {
  if (issue.localCover && fs.existsSync(path.join(ROOT, issue.localCover))) {
    issue.cover = issue.localCover;
    console.log('  Kapak zaten var:', issue.localCover);
    return;
  }
  let url = issue.sourceCover;
  if (!url && issueHtml) url = findCoverInIssueHtml(issueHtml, issue.no);
  if (!url) {
    console.log('  Kapak linki bulunamadı.');
    return;
  }
  try {
    const { buf, type } = await fetchBuffer(url);
    const ext = imageExt(url, type);
    const rel = `kapaklar/${issue.no}${ext}`;
    await fsp.writeFile(path.join(ROOT, rel), buf);
    issue.sourceCover = url;
    issue.cover = rel;
    issue.localCover = rel;
    console.log('  Kapak indirildi:', rel);
  } catch (err) {
    console.log('  Kapak indirilemedi:', err.message);
  }
}

function findCoverInIssueHtml(html, no) {
  const imgs = extractImages(html).filter(x => x.src && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(x.src));
  const n = String(no);
  const scored = imgs.map(img => {
    const all = `${img.src} ${img.alt} ${img.title}`.toLowerCase();
    let score = 0;
    if (all.includes(n)) score += 20;
    if (all.includes('kapak')) score += 15;
    if (all.includes('hakikat-dergisi')) score += 10;
    if (all.includes('hakikat dergisi')) score += 10;
    if (all.includes('sayi') || all.includes('sayı')) score += 5;
    return { ...img, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored[0] ? scored[0].src : '';
}

function parseIssuePage(html, issue) {
  const headings = extractHeadings(html).map(cleanText).filter(Boolean);
  const text = htmlToText(html);
  const lines = text.split(/\n+/).map(cleanText).filter(Boolean);
  const cleanLines = stripNoise(lines, issue.no);
  const start = findContentStart(cleanLines, issue.no);
  let body = cleanLines.slice(start).filter(l => !isListNavigation(l));

  // Çok kısa / menü ağırlıklı kalırsa tüm temiz satırı kullan.
  if (body.join(' ').length < 1000) body = cleanLines.filter(l => !isListNavigation(l));

  const fullText = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const topics = makeTopics(headings, issue).slice(0, 12);
  const title = topics[0] || issue.title;
  const sentenceCount = splitSentences(fullText).length;

  return {
    topics: topics.length ? topics : [issue.title],
    articles: [{ title: issue.title, text: fullText, kind: 'full', sentenceCount }],
    rawTextLength: fullText.length,
    sentenceCount
  };
}

function extractHeadings(html) {
  const out = [];
  const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let m;
  while ((m = re.exec(html))) out.push(htmlToText(m[1]));
  return out;
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s) {
  const map = {
    '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>',
    '&ccedil;': 'ç', '&Ccedil;': 'Ç', '&ouml;': 'ö', '&Ouml;': 'Ö', '&uuml;': 'ü', '&Uuml;': 'Ü',
    '&acirc;': 'â', '&Acirc;': 'Â', '&icirc;': 'î', '&Icirc;': 'Î', '&ucirc;': 'û', '&Ucirc;': 'Û'
  };
  return String(s || '').replace(/&[a-zA-Z#0-9]+;/g, ent => {
    if (map[ent]) return map[ent];
    const dec = ent.match(/^&#(\d+);$/);
    if (dec) return String.fromCharCode(Number(dec[1]));
    const hex = ent.match(/^&#x([0-9a-fA-F]+);$/);
    if (hex) return String.fromCharCode(parseInt(hex[1], 16));
    return ent;
  });
}

function cleanText(s) {
  return normalizeSpace(String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+([,.!?:;])/g, '$1'));
}

function normalizeSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function stripNoise(lines, no) {
  const bad = /^(Ana Sayfa|Hakikat Dergisi|Tüm Sayılar|Sayı Seçiniz|Yazar Seçiniz|Arama Yap|HAKKIMIZDA|DUYURULAR|YABANCI DİLDEKİ|KÜNYE|TEMSİLCİLİKLERİMİZ|KIRTASİYE BAYİLERİMİZ|İLETİŞİM|HAKİKAT YAYINCILIK|HAKİKAT MEDYA|HAKİKAT KIRTASİYE|HAKİKAT TAKVİMLERİ|Büyüt|SAYFAYA DEVAM ET|Önceki \d+\.SAYI|Sonraki \d+\.SAYI)$/i;
  return lines.filter(l => {
    if (!l) return false;
    if (bad.test(l)) return false;
    if (/^\d{4}$/.test(l)) return false;
    if (/^https?:\/\//i.test(l)) return false;
    if (/^\d{1,3}\.SAYI,\s*[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}$/.test(l) && !l.startsWith(String(no))) return false;
    return true;
  });
}

function findContentStart(lines, no) {
  const idxBes = lines.findIndex(l => /Bismillahirrahmanirrahim/i.test(l));
  if (idxBes >= 0) return idxBes;
  const idxNo = lines.findIndex(l => new RegExp('^' + no + '\\s*\\.\\s*SAYI', 'i').test(l));
  if (idxNo >= 0) return idxNo;
  const idxHak = lines.findIndex(l => new RegExp('Hakikat\\s+' + no + '\\.?\\s*Sayı', 'i').test(l));
  if (idxHak >= 0) return idxHak;
  return 0;
}

function isListNavigation(l) {
  if (/^\d{1,3}\.SAYI,\s*[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}$/.test(l)) return true;
  if (/^\d{4} yılını yükle$/i.test(l)) return true;
  return false;
}

function makeTopics(headings, issue) {
  const out = [];
  for (const h of headings) {
    const t = cleanText(h).replace(/^#+\s*/, '');
    if (!t || t.length < 4) continue;
    if (/^(Başyazı ve Makaleler|Hakikat Dergisi|Ana Sayfa)$/i.test(t)) continue;
    if (/^\(?[A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû'’\-\s]+:\s*\d+[\-–]?\d*\)?$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  if (!out.includes(issue.title)) out.unshift(issue.title);
  return out;
}

function splitSentences(txt) {
  return cleanText(txt)
    .replace(/([.!?…])\s+(?=[A-ZÇĞİÖŞÜÂÎÛ0-9“\"])/g, '$1|')
    .split('|')
    .map(x => x.trim())
    .filter(x => x.length > 12);
}

function absUrl(u) {
  if (!u) return '';
  u = u.replace(/&amp;/g, '&').trim();
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  if (u.startsWith('http://')) return u.replace('http://', 'https://');
  if (u.startsWith('https://')) return u;
  return BASE + '/' + u.replace(/^\/+/, '');
}

function imageExt(url, type) {
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const m = String(url).toLowerCase().match(/\.(jpg|jpeg|png|webp)(\?|$)/);
  if (m) return m[1] === 'jpeg' ? '.jpg' : '.' + m[1];
  return '.jpg';
}

async function writeIndex(issues) {
  const index = {
    version: 'local-1.0',
    source: BASE + '/hakikat-dergisi',
    generatedAt: new Date().toISOString(),
    issueCount: issues.length,
    issues: issues.map(x => ({
      no: Number(x.no),
      date: x.date,
      title: x.title,
      url: x.url,
      sourceCover: x.sourceCover || '',
      cover: x.localCover || x.cover || '',
      localCover: x.localCover || x.cover || '',
      contentFile: `data/${x.no}.json`,
      topics: x.topics || [],
      sentenceCount: x.sentenceCount || 0,
      articleCount: x.articleCount || 1,
      updatedAt: x.updatedAt || null,
      error: x.error || null
    }))
  };
  await writeJson(INDEX_FILE, index);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function gitPush() {
  console.log('\nGitHub’a yükleme deneniyor...');
  run('git add index.html data kapaklar guncelle.js guncelle.bat README.md');
  const msg = `Hakikat verisi güncellendi ${new Date().toISOString().slice(0, 10)}`;
  try { run(`git commit -m "${msg}"`); } catch (e) { console.log('Commit oluşturulmadı; değişiklik olmayabilir.'); }
  run('git push');
}

function run(cmd) {
  console.log('>', cmd);
  child_process.execSync(cmd, { stdio: 'inherit', shell: true });
}
