import fs from 'node:fs/promises';

const BASE = 'https://www.hakikat.com';
const LIST_URL = `${BASE}/hakikat-dergisi`;
const OUT = 'data/index.json';

function clean(s='') {
  return String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
}
function abs(u='') {
  u = u.replace(/&amp;/g,'&').trim();
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  if (u.startsWith('http://')) return u.replace('http://','https://');
  return u;
}
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 HakikatReaderCrawler/1.0' }});
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return await r.text();
}
function findCoverInHtml(html, no) {
  const n = String(no);
  const candidates = [];
  const urlRe = /(?:src|href|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = urlRe.exec(html))) {
    const u = abs(m[1]);
    const low = u.toLowerCase();
    if ((low.includes('hakikat-dergisi') || low.includes('kapak')) && u.includes(n)) candidates.push(u);
  }
  const directRe = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi;
  while ((m = directRe.exec(html))) {
    const u = abs(m[0]);
    const low = u.toLowerCase();
    if ((low.includes('hakikat-dergisi') || low.includes('kapak')) && u.includes(n)) candidates.push(u);
  }
  const uniq = [...new Set(candidates)];
  return uniq.find(x => x.toLowerCase().includes('kapak') && x.includes(n)) || uniq[0] || '';
}
function coverMapFromList(html) {
  const map = new Map();
  const re = /https?:\/\/[^\s"'<>]+hakikat-dergisi-(\d{1,3})-kapak[^\s"'<>]*?\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi;
  let m;
  while ((m = re.exec(html))) map.set(Number(m[1]), abs(m[0]));
  return map;
}
function parseIssues(html) {
  const map = coverMapFromList(html);
  const issues = [];
  const seen = new Set();
  const text = clean(html);
  const re = /(\d{1,3})\.SAYI,\s*([A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4})/g;
  let m;
  while ((m = re.exec(text))) {
    const no = Number(m[1]);
    if (!no || seen.has(no)) continue;
    seen.add(no);
    issues.push({
      no,
      date: m[2],
      title: `${no}.SAYI, ${m[2]}`,
      url: `${BASE}/hakikat-dergisi/${no}-sayi`,
      cover: map.get(no) || '',
      topics: []
    });
  }
  return issues.sort((a,b) => b.no - a.no);
}

const listHtml = await fetchText(LIST_URL);
const issues = parseIssues(listHtml);

for (const issue of issues) {
  if (!issue.cover) {
    try {
      const page = await fetchText(issue.url);
      issue.cover = findCoverInHtml(page, issue.no);
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.warn('Kapak alınamadı:', issue.no, e.message);
    }
  }
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: LIST_URL, issues }, null, 2), 'utf8');
console.log(`${OUT} yazıldı. Sayı: ${issues.length}, kapaklı: ${issues.filter(x => x.cover).length}`);
