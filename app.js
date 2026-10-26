/**
 * BUTIKAVTO — Калькулятор просмотров Reels & Видео
 * Движок анализа данных для Meta Business Suite, таблиц и списков
 */

// Форматирование чисел: 1234567 -> "1 234 567"
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return num.toLocaleString('ru-RU');
}

/**
 * Парсинг строки со значением просмотров (в т.ч. с "по объявлениям")
 * Пример: "32 48231 323 по объявлениям" -> total: 32482, ad: 31323
 */
function parseViewsLine(line) {
  if (!line) return null;
  const clean = line.replace(/[\u00A0\u202F\u2007\s]/g, ' ').trim();

  // 1. Склеенный формат из Meta Business Suite:
  // Например: "147 902142 924 по объявлениям" или "32 48231 323 по объявлениям"
  // (\d+)\s+(\d{3})(\d+)\s+(\d{3})\s+по\s+объявлениям
  const m1 = clean.match(/(\d+)\s+(\d{3})(\d+)\s+(\d{3})\s+по\s+объявлениям/i);
  if (m1) {
    const total = parseInt(m1[1] + m1[2], 10);
    const ad = parseInt(m1[3] + m1[4], 10);
    return { total, ad };
  }

  // 2. Если просмотры по рекламе меньше 1 000 (без пробела):
  // Например: "11 0503 125 по объявлениям" или "32 482500 по объявлениям"
  const m2 = clean.match(/(\d+)\s+(\d{3})(\d{1,3})\s+по\s+объявлениям/i);
  if (m2) {
    const total = parseInt(m2[1] + m2[2], 10);
    const ad = parseInt(m2[3], 10);
    return { total, ad };
  }

  // 3. Если между общим числом и рекламным есть пробел:
  // "32 482 31 323 по объявлениям"
  const m3 = clean.match(/^(\d[\d\s]*?)\s+(\d[\d\s]*)\s+по\s+объявлениям$/i);
  if (m3) {
    const total = parseInt(m3[1].replace(/\s+/g, ''), 10);
    const ad = parseInt(m3[2].replace(/\s+/g, ''), 10);
    return { total, ad };
  }

  // 4. Только одно число перед "по объявлениям":
  const m4 = clean.match(/^(\d[\d\s]*)\s+по\s+объявлениям$/i);
  if (m4) {
    return { total: 0, ad: parseInt(m4[1].replace(/\s+/g, ''), 10) };
  }

  // 5. Обычное число просмотров без рекламы: "118 930" или "810"
  const mPlain = clean.match(/^(\d[\d\s]*)$/);
  if (mPlain) {
    const total = parseInt(mPlain[1].replace(/\s+/g, ''), 10);
    return { total, ad: 0 };
  }

  return null;
}

/**
 * Парсинг форматированных чисел с суффиксами (тыс., млн, K, M и т.д.)
 */
function parseFormattedNumber(text) {
  if (typeof text === 'number') return Math.round(text);
  if (!text) return null;

  let str = text.toString().replace(/[\u00A0\u202F\u2007\s]/g, ' ').trim();

  let multiplier = 1;
  const lower = str.toLowerCase();

  if (/\b(?:млрд|b)\b/i.test(lower) || lower.endsWith('млрд') || lower.endsWith('b')) {
    multiplier = 1000000000;
    str = str.replace(/(?:млрд\.?|b)/gi, '').trim();
  } else if (/\b(?:млн|m)\b/i.test(lower) || lower.endsWith('млн.') || lower.endsWith('млн') || lower.endsWith('m')) {
    multiplier = 1000000;
    str = str.replace(/(?:млн\.?|m)/gi, '').trim();
  } else if (/\b(?:тыс|k)\b/i.test(lower) || lower.endsWith('тыс.') || lower.endsWith('тыс') || lower.endsWith('k')) {
    multiplier = 1000;
    str = str.replace(/(?:тыс\.?|k)/gi, '').trim();
  }

  str = str.replace(/\s+/g, '');

  if (multiplier > 1 && str.includes(',')) {
    str = str.replace(',', '.');
  } else if (str.includes(',') && !str.includes('.')) {
    if (/^\d{1,3}(,\d{3})+$/.test(str)) {
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(',', '.');
    }
  }

  const parsed = parseFloat(str);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * multiplier);
}

/**
 * Главная функция парсинга просмотров
 * @param {string} input - Входной текст или HTML
 * @param {boolean} subtractAds - Вычитать ли рекламу (считать только чистую органику)
 */
function parseViews(input, subtractAds = false) {
  if (!input || typeof input !== 'string') {
    return {
      totalViews: 0,
      maxViews: 0,
      minViews: 0,
      avgViews: 0,
      totalAdViews: 0,
      reelsCount: 0,
      topReel: null,
      items: [],
      method: 'Нет данных'
    };
  }

  const raw = input.trim();
  let items = [];
  let method = '';

  // 1. Специальный парсер скопированного контента Meta Business Suite
  if (/по\s+объявлениям/i.test(raw) || /Видео\s+Reels/i.test(raw)) {
    const mbsResult = extractFromMbsCopiedText(raw);
    if (mbsResult.items.length > 0) {
      items = mbsResult.items;
      method = 'Meta Business Suite (скопированный текст)';
    }
  }

  // 2. Поиск в JSON / скриптах Meta Business Suite (Relay Prefetched Stream, ServerJS)
  if (items.length === 0 && (raw.includes('{') || raw.includes('<script'))) {
    const jsonResult = extractFromMetaJson(raw);
    if (jsonResult.items.length > 0) {
      items = jsonResult.items;
      method = 'Meta Business Suite (JSON / Relay)';
    }
  }

  // 3. Поиск в HTML таблицах DOM (если вставлен HTML код)
  if (items.length === 0 && (raw.includes('<div') || raw.includes('<tr') || raw.includes('<table') || raw.includes('role="row"'))) {
    const domResult = extractFromHtmlDom(raw);
    if (domResult.items.length > 0) {
      items = domResult.items;
      method = 'HTML Таблица Meta';
    }
  }

  // 4. Построчный разбор / CSV / TSV
  if (items.length === 0) {
    const textResult = extractFromPlainText(raw);
    const regexResult = extractWithRegex(raw);

    if (textResult.items.length >= regexResult.items.length && textResult.items.length > 0) {
      items = textResult.items;
      method = 'Текстовый список / Таблица';
    } else if (regexResult.items.length > 0) {
      items = regexResult.items;
      method = 'Метрики просмотров';
    }
  }

  // Дедупликация
  items = deduplicateItems(items);

  // Обработка флага subtractAds (вычитание просмотров по рекламе)
  let totalAdViews = 0;
  items.forEach(it => {
    const ad = it.adViews || 0;
    totalAdViews += ad;
    if (subtractAds && ad > 0) {
      it.effectiveViews = Math.max(0, it.views - ad);
    } else {
      it.effectiveViews = it.views;
    }
  });

  const viewsList = items.map(it => it.effectiveViews).filter(v => typeof v === 'number' && !isNaN(v) && v >= 0);
  const totalViews = viewsList.reduce((acc, v) => acc + v, 0);
  const reelsCount = viewsList.length;
  const maxViews = reelsCount > 0 ? Math.max(...viewsList) : 0;
  const minViews = reelsCount > 0 ? Math.min(...viewsList) : 0;
  const avgViews = reelsCount > 0 ? Math.round(totalViews / reelsCount) : 0;
  const topReel = reelsCount > 0 ? items.find(it => it.effectiveViews === maxViews) : null;

  return {
    totalViews,
    maxViews,
    minViews,
    avgViews,
    totalAdViews,
    reelsCount,
    topReel,
    items,
    method: method || 'Формат не распознан'
  };
}

/**
 * Специализированный парсер для текста из Meta Business Suite (копирование экрана)
 */
function extractFromMbsCopiedText(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];

  const ignoredLabels = new Set([
    'заголовок', 'просмотры', 'видео reels', 'reels', 'с кросспостингом',
    'фильтр', 'очистить', 'поиск по подписи или id', 'статистика',
    'весь контент', 'публикации и истории', 'тип медиафайла'
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isAd = /по\s+объявлениям/i.test(line);
    const isNum = /^[\d\s\u00A0\u202F\u2007]+$/.test(line);

    if (isAd || isNum) {
      const parsed = parseViewsLine(line);
      if (parsed && (parsed.total > 0 || parsed.ad > 0)) {
        // Поиск заголовка перед строкой с просмотрами
        let title = '';
        for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
          const prev = lines[k];
          const prevLower = prev.toLowerCase();
          if (ignoredLabels.has(prevLower)) continue;
          if (prevLower.startsWith('butikavto.') || prevLower.includes('_permanent') || prevLower.includes('_serafimko')) continue;
          if (parseViewsLine(prev) !== null) continue;
          title = prev;
          break;
        }

        items.push({
          id: `reel_${items.length + 1}`,
          title: title || `Рилс #${items.length + 1}`,
          views: parsed.total,
          adViews: parsed.ad
        });
      }
    }
  }

  return { items };
}

/**
 * Извлечение из JSON структуры Meta Business Suite
 */
function extractFromMetaJson(text) {
  const items = [];
  const foundMap = new Map();
  const jsonBlocks = [];

  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.length > 10 && (content.startsWith('{') || content.startsWith('[') || content.includes('"require"') || content.includes('"data"'))) {
      jsonBlocks.push(content);
    }
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    jsonBlocks.push(text);
  }

  function processNode(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) processNode(item);
      return;
    }

    let views = null;
    let title = obj.name || obj.title || obj.caption || obj.message || obj.description || '';
    let id = obj.id || obj.post_id || obj.video_id || obj.instagram_media_id;

    const candidateProps = [
      'reels_plays',
      'video_play_count',
      'reels_play_count',
      'video_view_count',
      'video_views',
      'play_count',
      'fb_reels_plays',
      'ig_reels_plays',
      'plays',
      'total_plays'
    ];

    for (const prop of candidateProps) {
      if (typeof obj[prop] === 'number' && obj[prop] >= 0) {
        views = obj[prop];
        break;
      } else if (typeof obj[prop] === 'string' && /^\d+$/.test(obj[prop])) {
        views = parseInt(obj[prop], 10);
        break;
      }
    }

    if (views === null && Array.isArray(obj.metrics)) {
      for (const m of obj.metrics) {
        if (m && typeof m === 'object') {
          const mName = (m.name || m.key || '').toLowerCase();
          if (mName.includes('reels_play') || mName.includes('video_play') || mName.includes('video_view') || mName === 'plays' || mName === 'views') {
            if (typeof m.value === 'number') {
              views = m.value;
              break;
            } else if (typeof m.value === 'string') {
              views = parseFormattedNumber(m.value);
              break;
            }
          }
        }
      }
    }

    if (views === null && obj.inline_insights_node && typeof obj.inline_insights_node === 'object') {
      const metrics = obj.inline_insights_node.metrics || [];
      for (const m of metrics) {
        if (m && m.name && (m.name.includes('play') || m.name.includes('view'))) {
          views = typeof m.value === 'number' ? m.value : parseFormattedNumber(m.value);
          if (views !== null) break;
        }
      }
    }

    if (views !== null && views >= 0) {
      const key = id ? `id_${id}` : `title_${title}_views_${views}`;
      if (!foundMap.has(key)) {
        foundMap.set(key, {
          id: id || `reel_${foundMap.size + 1}`,
          title: title || `Рилс #${foundMap.size + 1}`,
          views: views,
          adViews: 0
        });
      }
    }

    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object') {
        processNode(obj[k]);
      }
    }
  }

  for (const block of jsonBlocks) {
    try {
      const data = JSON.parse(block);
      processNode(data);
    } catch {
      extractMetricsFromRawScript(block, foundMap);
    }
  }

  if (foundMap.size === 0) {
    extractMetricsFromRawScript(text, foundMap);
  }

  for (const item of foundMap.values()) {
    items.push(item);
  }

  return { items };
}

function extractMetricsFromRawScript(text, foundMap) {
  function findNearbyTitle(idx) {
    const windowText = text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 200));
    const titleMatch = windowText.match(/"(?:name|title|caption|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    if (titleMatch && titleMatch[1]) {
      try {
        return JSON.parse(`"${titleMatch[1]}"`);
      } catch {
        return titleMatch[1];
      }
    }
    return '';
  }

  const reMetric = /"name"\s*:\s*"(?:reels_plays|video_play_count|video_views|plays)"\s*,\s*"value"\s*:\s*(\d+)/gi;
  let m;
  while ((m = reMetric.exec(text)) !== null) {
    const val = parseInt(m[1], 10);
    const key = `metric_${m.index}_${val}`;
    if (!foundMap.has(key)) {
      const title = findNearbyTitle(m.index);
      foundMap.set(key, {
        id: `reel_${foundMap.size + 1}`,
        title: title || `Рилс #${foundMap.size + 1}`,
        views: val,
        adViews: 0
      });
    }
  }

  const reDirect = /"(?:video_play_count|reels_plays|reels_play_count|play_count)"\s*:\s*(\d+)/gi;
  while ((m = reDirect.exec(text)) !== null) {
    const val = parseInt(m[1], 10);
    const key = `direct_${m.index}_${val}`;
    if (!foundMap.has(key)) {
      const title = findNearbyTitle(m.index);
      foundMap.set(key, {
        id: `reel_${foundMap.size + 1}`,
        title: title || `Рилс #${foundMap.size + 1}`,
        views: val,
        adViews: 0
      });
    }
  }
}

/**
 * HTML DOM парсер таблицы
 */
function extractFromHtmlDom(htmlText) {
  const items = [];
  if (typeof DOMParser === 'undefined') return { items };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const rows = Array.from(doc.querySelectorAll('[role="row"], tr'));
    let viewsColumnIndex = -1;
    let headerRow = null;

    for (const r of rows) {
      const headerCells = Array.from(r.querySelectorAll('[role="columnheader"], th'));
      if (headerCells.length > 0) {
        headerCells.forEach((th, idx) => {
          const txt = th.textContent.trim().toLowerCase();
          if (txt.includes('воспроизведен') || txt.includes('просмотр') || txt.includes('play') || txt.includes('view')) {
            viewsColumnIndex = idx;
            headerRow = r;
          }
        });
        if (viewsColumnIndex !== -1) break;
      }
    }

    const dataRows = rows.filter(r => r !== headerRow && !r.querySelector('th') && r.getAttribute('role') !== 'columnheader');

    if (dataRows.length > 0 && viewsColumnIndex !== -1) {
      dataRows.forEach((row, i) => {
        const cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"], td'));
        if (cells[viewsColumnIndex]) {
          const rawText = cells[viewsColumnIndex].textContent.trim();
          const parsed = parseViewsLine(rawText) || { total: parseFormattedNumber(rawText), ad: 0 };
          if (parsed && parsed.total >= 0) {
            const titleCell = cells[0] || row;
            const title = titleCell.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
            items.push({
              id: `row_${i + 1}`,
              title: title || `Рилс #${i + 1}`,
              views: parsed.total,
              adViews: parsed.ad
            });
          }
        }
      });
    }

    if (items.length === 0 && dataRows.length > 0) {
      dataRows.forEach((row, i) => {
        const cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"], td'));
        for (const cell of cells) {
          const text = cell.textContent.trim();
          const parsed = parseViewsLine(text);
          if (parsed && parsed.total > 0) {
            const title = cells[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) || `Рилс #${i + 1}`;
            items.push({
              id: `row_${i + 1}`,
              title: title,
              views: parsed.total,
              adViews: parsed.ad
            });
            break;
          }
        }
      });
    }

    return { items };
  } catch {
    return { items };
  }
}

/**
 * Regex-паттерны в произвольном тексте
 */
function extractWithRegex(text) {
  const items = [];
  const foundSet = new Set();

  const patterns = [
    {
      regex: /"name"\s*:\s*"(?:reels_plays|video_play_count|video_views|plays)"\s*,\s*"value"\s*:\s*(\d+)/gi,
      extract: m => parseInt(m[1], 10)
    },
    {
      regex: /"(?:video_play_count|reels_plays|reels_play_count|play_count)"\s*:\s*(\d+)/gi,
      extract: m => parseInt(m[1], 10)
    },
    {
      regex: /(?:Воспроизведения|Просмотры|Plays|Views)\s*[:•\n\t]+\s*(\d[\d\s.,]*(?:тыс\.?|млн\.?|[KkMm])?)/gi,
      extract: m => parseFormattedNumber(m[1])
    },
    {
      regex: /(\d[\d\s.,]*(?:тыс\.?|млн\.?|[KkMm])?)\s+(?:воспроизведен[а-я]+|просмотр[а-я]*|plays?|views?)/gi,
      extract: m => parseFormattedNumber(m[1])
    }
  ];

  for (const { regex, extract } of patterns) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      const val = extract(m);
      if (val !== null && val >= 0) {
        const key = `${m.index}_${val}`;
        if (!foundSet.has(key)) {
          foundSet.add(key);
          items.push({
            id: `pattern_${items.length + 1}`,
            title: `Рилс #${items.length + 1}`,
            views: val,
            adViews: 0
          });
        }
      }
    }
    if (items.length > 0) break;
  }

  return { items };
}

/**
 * Разбор CSV / TSV / списков
 */
function extractFromPlainText(text) {
  const items = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { items };

  const firstLine = lines[0];
  let delimiter = null;
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';') && lines.filter(l => l.includes(';')).length > lines.length * 0.5) delimiter = ';';
  else if (firstLine.includes(',') && lines.filter(l => l.includes(',')).length > lines.length * 0.5) delimiter = ',';

  if (delimiter) {
    const parseCsvLine = (line, delim) => {
      const res = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === delim && !inQuotes) {
          res.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      res.push(cur.trim());
      return res;
    };

    const headerParts = parseCsvLine(lines[0], delimiter);
    let viewsColIdx = -1;
    let titleColIdx = 0;

    headerParts.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (lower.includes('воспроизведен') || lower.includes('просмотр') || lower.includes('play') || lower.includes('view')) {
        viewsColIdx = idx;
      }
      if (lower.includes('заголовок') || lower.includes('название') || lower.includes('title')) {
        titleColIdx = idx;
      }
    });

    const startIdx = viewsColIdx !== -1 ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i], delimiter);
      if (parts.length < 2) continue;

      if (viewsColIdx !== -1 && parts[viewsColIdx]) {
        const num = parseFormattedNumber(parts[viewsColIdx]);
        if (num !== null && num >= 0) {
          items.push({
            id: `csv_${i + 1}`,
            title: parts[titleColIdx] || parts[0] || `Рилс #${items.length + 1}`,
            views: num,
            adViews: 0
          });
        }
      } else {
        for (let c = 1; c < parts.length; c++) {
          const num = parseFormattedNumber(parts[c]);
          if (num !== null && num > 0) {
            items.push({
              id: `csv_${i + 1}`,
              title: parts[titleColIdx] || parts[0] || `Рилс #${items.length + 1}`,
              views: num,
              adViews: 0
            });
            break;
          }
        }
      }
    }

    if (items.length > 0) return { items };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const singleNumberMatch = line.match(/^(\d[\d\s.,]*(?:тыс\.?|млн\.?|[KkMm])?)\s*(?:воспроизведен[а-я]+|просмотр[а-я]*|plays?|views?)?$/i);
    if (singleNumberMatch) {
      const val = parseFormattedNumber(singleNumberMatch[1]);
      if (val !== null && val >= 0) {
        let title = `Рилс #${items.length + 1}`;
        if (i > 0 && isNaN(parseFormattedNumber(lines[i - 1]))) {
          title = lines[i - 1];
        }
        items.push({
          id: `line_${items.length + 1}`,
          title,
          views: val,
          adViews: 0
        });
        continue;
      }
    }

    const sepMatch = line.match(/^(.+?)(?:\s*[:|–—]\s*|\s+-\s+|\t+|\s{2,})(\d[\d\s.,]*(?:тыс\.?|млн\.?|[KkMm])?)\s*(?:воспроизведен[а-я]+|просмотр[а-я]*|plays?|views?)?$/i);
    if (sepMatch) {
      const val = parseFormattedNumber(sepMatch[2]);
      if (val !== null && val >= 0) {
        items.push({
          id: `line_${items.length + 1}`,
          title: sepMatch[1].trim() || `Рилс #${items.length + 1}`,
          views: val,
          adViews: 0
        });
        continue;
      }
    }
  }

  return { items };
}

function deduplicateItems(items) {
  if (!items || items.length === 0) return [];
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = item.id && !item.id.startsWith('pattern_') && !item.id.startsWith('direct_') && !item.id.startsWith('metric_')
      ? item.id
      : `${item.title}_${item.views}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

// ==========================================
// Инициализация интерфейса в браузере
// ==========================================
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

function initApp() {
  const contentInput = document.getElementById('contentInput');
  const calculateBtn = document.getElementById('calculateBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const clearBtn = document.getElementById('clearBtn');
  const subtractAdsToggle = document.getElementById('subtractAdsToggle');

  const totalViewsEl = document.getElementById('totalViews');
  const maxViewsEl = document.getElementById('maxViews');
  const maxViewsSubtext = document.getElementById('maxViewsSubtext');
  const totalViewsSubtext = document.getElementById('totalViewsSubtext');

  const detailsCard = document.getElementById('detailsCard');
  const reelsTableBody = document.getElementById('reelsTableBody');
  const toast = document.getElementById('toast');

  let currentResult = null;

  function showToast(message, icon = '✓') {
    if (!toast) return;
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    if (toastIcon) toastIcon.textContent = icon;
    if (toastMessage) toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function handleCalculate() {
    const text = contentInput.value;
    if (!text || !text.trim()) {
      showToast('Вставьте скопированный текст со страницы', '⚠️');
      contentInput.focus();
      return;
    }

    calculateBtn.disabled = true;
    calculateBtn.innerHTML = '<span>Считаем...</span>';

    setTimeout(() => {
      try {
        const subtractAds = subtractAdsToggle ? subtractAdsToggle.checked : false;
        const result = parseViews(text, subtractAds);
        currentResult = result;

        totalViewsEl.textContent = formatNumber(result.totalViews);
        maxViewsEl.textContent = formatNumber(result.maxViews);

        if (result.reelsCount > 0) {
          const adsText = result.totalAdViews > 0 
            ? (subtractAds ? ` (реклама ${formatNumber(result.totalAdViews)} вычтена)` : ` (просмотры по рекламе не дублируются)`)
            : '';
          totalViewsSubtext.textContent = `Сумма по всем ${result.reelsCount} рилсам${adsText}`;

          if (result.topReel) {
            maxViewsSubtext.innerHTML = `<strong>Лидер:</strong> ${escapeHtml(result.topReel.title)}`;
          } else {
            maxViewsSubtext.textContent = 'Наибольшее число просмотров';
          }

          renderTable(result.items, result.maxViews);
          if (detailsCard) detailsCard.style.display = 'block';
          showToast(`Успешно! Найдено ${result.reelsCount} рилсов`);
        } else {
          totalViewsSubtext.textContent = 'Рилсы не обнаружены';
          maxViewsSubtext.textContent = 'Проверьте формат содержимого';
          if (detailsCard) detailsCard.style.display = 'none';
          showToast('Не удалось распознать просмотры в тексте', '⚠️');
        }
      } catch (err) {
        console.error('Calculate error:', err);
        showToast('Ошибка при обработке: ' + err.message, '❌');
      } finally {
        calculateBtn.disabled = false;
        calculateBtn.innerHTML = '<span>⚡ Посчитать</span>';
      }
    }, 30);
  }

  function renderTable(items, maxViews) {
    if (!reelsTableBody) return;
    reelsTableBody.innerHTML = '';

    const sorted = [...items].sort((a, b) => (b.effectiveViews || b.views) - (a.effectiveViews || a.views));

    sorted.forEach((it, idx) => {
      const tr = document.createElement('tr');
      const val = it.effectiveViews !== undefined ? it.effectiveViews : it.views;
      const isTop = val === maxViews && maxViews > 0;
      if (isTop) tr.classList.add('top-row');

      const percentage = maxViews > 0 ? Math.round((val / maxViews) * 100) : 0;
      const adBadge = it.adViews > 0 ? `<span class="ad-badge">реклама: ${formatNumber(it.adViews)}</span>` : '';

      tr.innerHTML = `
        <td style="width: 50px;">
          <span class="rank-badge ${idx === 0 ? 'top-1' : ''}">${idx + 1}</span>
        </td>
        <td>
          <div class="reel-title">${escapeHtml(it.title)}</div>
        </td>
        <td style="width: 220px;">
          <div class="views-cell">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span class="views-number">${formatNumber(val)}</span>
              ${adBadge}
            </div>
            <div class="views-bar-container">
              <div class="views-bar" style="width: ${percentage}%;"></div>
            </div>
          </div>
        </td>
      `;
      reelsTableBody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  if (subtractAdsToggle) {
    subtractAdsToggle.addEventListener('change', () => {
      if (contentInput.value.trim()) {
        handleCalculate();
      }
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          contentInput.value = text;
          showToast('Вставлено из буфера');
          handleCalculate();
        } else {
          showToast('Буфер обмена пуст', '⚠️');
          contentInput.focus();
        }
      } catch {
        contentInput.focus();
        showToast('Нажмите Ctrl+V / Cmd+V для вставки', 'ℹ️');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      contentInput.value = '';
      totalViewsEl.textContent = '0';
      maxViewsEl.textContent = '0';
      totalViewsSubtext.textContent = 'Суммарно по всем рилсам';
      maxViewsSubtext.textContent = 'Самый популярный ролик';
      if (detailsCard) detailsCard.style.display = 'none';
      showToast('Поле очищено');
      contentInput.focus();
    });
  }

  if (calculateBtn) {
    calculateBtn.addEventListener('click', handleCalculate);
  }

  if (contentInput) {
    contentInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCalculate();
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatNumber,
    parseFormattedNumber,
    parseViewsLine,
    parseViews
  };
}
