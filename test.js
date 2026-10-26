const { parseViews, parseFormattedNumber, formatNumber } = require('./app.js');

console.log('--- 1. Testing Number Formatting & Parsing ---');
console.assert(parseFormattedNumber('1 450') === 1450, '1 450 should be 1450');
console.assert(parseFormattedNumber('12,5 тыс.') === 12500, '12,5 тыс. should be 12500');
console.assert(parseFormattedNumber('1.2M') === 1200000, '1.2M should be 1200000');
console.log('✓ Number parsing tests passed');

console.log('\n--- 2. Testing Meta Business Suite JSON ---');
const sampleMetaHtml = `
<!DOCTYPE html><html><head>
<script id="__eqmc" type="application/json">{"s":"XBizWebCometBizSuiteInsightsController"}</script>
<script type="application/json" data-sjs>
{
  "require": [
    ["RelayPrefetchedStreamCache", "next", [], [
      "query_1",
      {
        "data": {
          "items": [
            { "id": "reel_1", "name": "Travel in Mountains", "video_play_count": 45000 },
            { "id": "reel_2", "name": "Cooking Masterclass", "reels_plays": 120000 },
            { "id": "reel_3", "name": "Workout Routine", "metrics": [{"name": "reels_plays", "value": 310000}] }
          ]
        }
      }
    ]]
  ]
}
</script>
</head><body></body></html>
`;
const resJson = parseViews(sampleMetaHtml);
console.assert(resJson.totalViews === 475000, `Expected total 475000, got ${resJson.totalViews}`);
console.assert(resJson.maxViews === 310000, `Expected max 310000, got ${resJson.maxViews}`);
console.assert(resJson.reelsCount === 3, `Expected count 3, got ${resJson.reelsCount}`);
console.log('✓ Meta Business Suite JSON tests passed');

console.log('\n--- 3. Testing Tabular Text / TSV ---');
const sampleTsv = `Название публикации\tДата\tВоспроизведения Reels\tОхват
Рилс 1: Тренды 2024\t24 окт.\t50 000\t42 000
Рилс 2: Секреты съемки\t22 окт.\t150 000\t130 000
Рилс 3: За кадром\t20 окт.\t25 000\t21 000`;
const resTsv = parseViews(sampleTsv);
console.assert(resTsv.totalViews === 225000, `Expected 225000, got ${resTsv.totalViews}`);
console.assert(resTsv.maxViews === 150000, `Expected 150000, got ${resTsv.maxViews}`);
console.assert(resTsv.reelsCount === 3, `Expected 3, got ${resTsv.reelsCount}`);
console.log('✓ Tabular text tests passed');

console.log('\n--- 4. Testing Line-by-line Text ---');
const sampleLines = `
Рилс 1: 15 000
Рилс 2: 95 000 просмотров
Рилс 3: 4 200
`;
const resLines = parseViews(sampleLines);
console.assert(resLines.totalViews === 114200, `Expected 114200, got ${resLines.totalViews}`);
console.assert(resLines.maxViews === 95000, `Expected 95000, got ${resLines.maxViews}`);
console.assert(resLines.reelsCount === 3, `Expected 3, got ${resLines.reelsCount}`);
console.log('✓ Line-by-line tests passed');

console.log('\n=============================');
console.log('🎉 ALL TEST SUITES PASSED! 🎉');
console.log('=============================');
