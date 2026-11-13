import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseColor } from '../src/core/color.js';

const output = path.resolve('artifacts/webstore-images');
const extension = path.resolve('dist/extension');
const extensionId = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map((digit) => {
  return String.fromCharCode(97 + parseInt(digit, 16));
}).join('');
const copy = {
  en: {
    imageTitle: 'Every pixel.<br>Every color.',
    imageDescription: 'Upload a picture. Inspect any pixel. Browse or export every color.',
    imageFeatures: ['Upload, drag & drop, or paste', 'Pixel magnifier & coordinates', 'Every unique color with pixel counts', 'Export every color as CSV'],
    languagesTitle: 'Your colors. Your language.',
    languagesFooter: 'English by default · Tiếng Việt · 简体中文',
    eyebrow: 'COLOR, WITH POSSIBILITIES',
    title: 'Find your<br>next color.',
    description: 'Pick a screen pixel. Fine-tune the shade. Make it yours.',
    features: ['Screen eyedropper', 'Hue & opacity controls', 'A separate picker window'],
    secondEyebrow: 'FROM INSPIRATION TO YOUR NEXT PROJECT',
    secondTitle: 'One color.<br>Every format.',
    secondDescription: 'Copy the value you need. Keep the colors you love.',
    secondFeatures: ['HEX · HEX8 · RGB · RGBA', 'HSL · HSLA · HSV', 'Saved palettes & recent colors'],
  },
  vi: {
    imageTitle: 'Từng pixel.<br>Từng sắc màu.',
    imageDescription: 'Tải ảnh lên. Chọn màu tại từng điểm. Xem hoặc xuất toàn bộ mã màu.',
    imageFeatures: ['Tải, kéo thả hoặc dán ảnh', 'Phóng to pixel và xem tọa độ', 'Toàn bộ màu cùng số pixel', 'Xuất đầy đủ danh sách CSV'],
    languagesTitle: 'Sắc màu của bạn. Ngôn ngữ của bạn.',
    languagesFooter: 'Tiếng Anh mặc định · Tiếng Việt · 简体中文',
    eyebrow: 'THÊM SẮC MÀU CHO Ý TƯỞNG',
    title: 'Tìm sắc màu<br>của riêng bạn.',
    description: 'Chọn màu trên màn hình. Tinh chỉnh sắc độ theo ý bạn.',
    features: ['Chọn màu trên màn hình', 'Chỉnh sắc độ và độ trong suốt', 'Mở cửa sổ chọn màu riêng'],
    secondEyebrow: 'TỪ CẢM HỨNG ĐẾN SẢN PHẨM',
    secondTitle: 'Một màu sắc.<br>Nhiều định dạng.',
    secondDescription: 'Sao chép mã màu cần dùng. Lưu những màu bạn yêu thích.',
    secondFeatures: ['HEX · HEX8 · RGB · RGBA', 'HSL · HSLA · HSV', 'Bảng màu đã lưu và màu gần đây'],
  },
  'zh-CN': {
    imageTitle: '每个像素。<br>每种色彩。',
    imageDescription: '上传图片，查看任意像素，浏览或导出全部颜色。',
    imageFeatures: ['上传、拖放或粘贴图片', '像素放大镜与坐标', '全部不同颜色与像素数量', '完整 CSV 导出'],
    languagesTitle: '你的色彩，你的语言。',
    languagesFooter: '默认英语 · Tiếng Việt · 简体中文',
    eyebrow: '让灵感，拥有色彩',
    title: '发现你的<br>下一种色彩。',
    description: '拾取屏幕颜色，微调色调，创造你的专属色彩。',
    features: ['屏幕取色', '色相与不透明度调节', '独立取色窗口'],
    secondEyebrow: '从灵感到下一个作品',
    secondTitle: '一种色彩。<br>多种格式。',
    secondDescription: '复制所需的颜色值，收藏喜爱的颜色。',
    secondFeatures: ['HEX · HEX8 · RGB · RGBA', 'HSL · HSLA · HSV', '已保存的调色板与最近使用的颜色'],
  },
};
const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #22213e; }
  .slide { width: 1280px; height: 800px; position: relative; background: #f5f3fc; overflow: hidden; }
  .slide::before { content: ""; position: absolute; width: 850px; height: 850px; border-radius: 50%; background: radial-gradient(circle, #d4c6ff 0%, #e4ddff88 48%, #f5f3fc00 70%); top: -90px; right: -280px; }
  .slide::after { content: ""; position: absolute; width: 480px; height: 480px; border-radius: 50%; background: radial-gradient(circle, #e0f8f6 0%, #f5f3fc00 70%); bottom: -300px; left: -180px; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 750; letter-spacing: -.7px; }
  .brand img { width: 42px; height: 42px; }
  .slide > .brand { position: absolute; left: 64px; top: 44px; }
  .copy { position: absolute; left: 72px; top: 188px; width: 505px; z-index: 1; }
  .eyebrow { color: #7b59c4; font-weight: 700; font-size: 11px; letter-spacing: 2px; margin-bottom: 23px; }
  h1 { font-size: 66px; line-height: 1.08; letter-spacing: -3px; margin: 0 0 25px; font-weight: 750; }
  .description { font-size: 20px; line-height: 1.6; color: #78718d; max-width: 390px; margin: 0 0 30px; }
  .features { display: flex; flex-direction: column; gap: 16px; font-size: 15px; color: #514762; }
  .feature { display: flex; align-items: center; gap: 12px; }
  .feature::before { content: "✓"; border-radius: 50%; background: #e7defa; color: #8257db; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
  .panel { position: absolute; width: 416px; right: 100px; top: 108px; border-radius: 20px; background: #f7f7fb; border: 1px solid #ffffff; box-shadow: 0 28px 70px #45268120, 0 0 0 1px #45268109; overflow: hidden; }
  .panel img { display: block; width: 100%; }
  .panel.second { top: 76px; }
  .footer { position: absolute; bottom: 34px; left: 72px; font-size: 12px; color: #91879f; letter-spacing: .2px; }
  .index { position: absolute; right: 55px; bottom: 33px; color: #a79cb9; font-size: 12px; }
  .chips { display: flex; gap: 10px; align-items: center; }
  .chips span { padding: 9px 13px; border-radius: 9px; border: 1px solid #ded5f3; font-family: ui-monospace, monospace; font-size: 12px; color: #73569e; background: #ffffff80; }
  .languages h1 { position: absolute; left: 72px; top: 127px; font-size: 50px; letter-spacing: -2px; }
  .language-panels { position: absolute; left: 78px; right: 78px; top: 249px; display: flex; gap: 35px; }
  .language-card { flex: 1; min-width: 0; }
  .language-card label { display: block; font-size: 15px; font-weight: 650; margin: 0 0 14px 10px; color: #685181; }
  .language-card img { display: block; width: 100%; border-radius: 14px; border: 1px solid #fff; box-shadow: 0 12px 40px #46217c19; }
  .small { background: #211b39; width: 440px; height: 280px; overflow: hidden; position: relative; color: #fff; }
  .small::before, .marquee::before { content: ""; position: absolute; border-radius: 50%; width: 500px; height: 500px; right: -230px; top: -240px; background: radial-gradient(circle, #9b57dc80, transparent 70%); }
  .small h1 { position: absolute; top: 39px; left: 30px; margin: 0; font-size: 44px; letter-spacing: -2px; line-height: 1.08; }
  .small img { position: absolute; width: 210px; height: 210px; right: -2px; top: 13px; transform: rotate(8deg); }
  .small .chips { position: absolute; left: 31px; bottom: 33px; gap: 8px; }
  .small .chips span, .marquee .chips span { color: #e4d7ff; background: #ffffff08; border-color: #ffffff25; }
  .marquee { width: 1400px; height: 560px; background: #211b39; color: white; position: relative; overflow: hidden; }
  .marquee::before { width: 900px; height: 900px; right: -260px; top: -430px; }
  .marquee h1 { position: absolute; left: 88px; top: 125px; font-size: 94px; letter-spacing: -5px; line-height: 1.1; }
  .marquee .chips { position: absolute; left: 94px; top: 310px; gap: 14px; }
  .marquee .chips span { font-size: 19px; padding: 13px 21px; }
  .marquee img { width: 500px; height: 500px; position: absolute; right: 33px; top: 23px; transform: rotate(7deg); }
  .spectrum { position: absolute; left: 94px; bottom: 100px; width: 410px; height: 8px; border-radius: 9px; background: linear-gradient(90deg,#fa8aaa,#ce7bf8,#8063f5,#5fa6f9,#40d8c3,#f4cf7e); }
`;
let context;
let profile;

async function dataUrl(filename) {
  try {
    return `data:image/png;base64,${(await readFile(filename)).toString('base64')}`;
  } catch (error) {
    throw new Error(`Could not read image ${filename}: ${error.message}`);
  }
}

async function render(width, height, content, filename) {
  let page;

  try {
    page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${content}</body></html>`);
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async (image) => {
          try { await image.decode(); } catch (error) { throw error; }
        }));
      } catch (error) {
        throw new Error(`Could not load artwork: ${error.message}`);
      }
    });
    await page.screenshot({ path: filename, animations: 'disabled' });
  } finally {
    await page?.close();
  }
}

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await mkdir('artifacts/webstore-captures', { recursive: true });
  profile = await mkdtemp(path.join(os.tmpdir(), 'color-picker-store-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 520, height: 1200 }, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(`chrome-extension://${extensionId}/ui/popup.html`);
  await page.locator('#pick:not(:disabled)').waitFor();
  const palette = ['#7C5CFC', '#F48FB1', '#53C9B4', '#F4C570', '#6698EF', '#29233F'].map((value) => { return parseColor(value); });
  await page.evaluate(async (palette) => {
    try {
      await chrome.storage.local.set({ palette, recent: [...palette].reverse(), color: { r: 124, g: 92, b: 252, a: 0.8 } });
    } catch (error) { throw new Error(`Could not prepare screenshot colors: ${error.message}`); }
  }, palette);
  const captures = {};

  for (const language of Object.keys(copy)) {
    await mkdir(`${output}/${language}`, { recursive: true });
    await page.locator('#language').selectOption(language);
    await page.waitForFunction((language) => { return document.documentElement.lang === language; }, language);
    const editor = await page.locator('.editor').boundingBox();
    const formats = await page.locator('.formats-section').boundingBox();
    const footer = await page.locator('footer').boundingBox();
    const first = `artifacts/webstore-captures/${language}-editor.png`;
    const second = `artifacts/webstore-captures/${language}-formats.png`;
    await page.screenshot({ path: first, clip: { x: 0, y: 0, width: 520, height: Math.ceil(editor.y + editor.height + 20) } });
    await page.screenshot({ path: second, clip: { x: 0, y: Math.floor(formats.y - 16), width: 520, height: Math.ceil(footer.y + footer.height + 20 - Math.floor(formats.y - 16)) } });
    captures[language] = { first: await dataUrl(first), second: await dataUrl(second) };
  }

  const icon = await dataUrl('design/icon-preview-512.png');
  const brand = `<div class="brand"><img src="${icon}" alt=""><span>Color Picker.</span></div>`;

  for (const [language, text] of Object.entries(copy)) {
    for (const second of [false, true]) {
      const title = second ? text.secondTitle : text.title;
      const eyebrow = second ? text.secondEyebrow : text.eyebrow;
      const description = second ? text.secondDescription : text.description;
      const features = second ? text.secondFeatures : text.features;
      const image = second ? captures[language].second : captures[language].first;
      const filename = second ? 'screenshot-02-formats-palette-1280x800.png' : 'screenshot-01-picker-1280x800.png';
      await render(1280, 800, `<main class="slide">${brand}<div class="copy"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="description">${description}</p><div class="features">${features.map((feature) => { return `<div class="feature">${feature}</div>`; }).join('')}</div></div><div class="panel ${second ? 'second' : ''}"><img src="${image}" alt=""></div><div class="footer">Color Picker · HEX / RGBA / HSL / HSV</div><div class="index">0${second ? 2 : 1} / 05</div></main>`, `${output}/${language}/${filename}`);
    }
  }

  const languageCards = [['en', 'English'], ['vi', 'Tiếng Việt'], ['zh-CN', '简体中文']].map(([language, label]) => {
    return `<div class="language-card"><label>${label}</label><img src="${captures[language].first}" alt=""></div>`;
  }).join('');
  for (const [language, text] of Object.entries(copy)) {
    await render(1280, 800, `<main class="slide languages">${brand}<h1>${text.languagesTitle}</h1><div class="language-panels">${languageCards}</div><div class="footer">${text.languagesFooter}</div><div class="index">03 / 05</div></main>`, `${output}/${language}/screenshot-03-languages-1280x800.png`);
  }
  await page.locator('#imageSource').click();
  const sample = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    const colors = ['#7C5CFC', '#B99FFA', '#F48FB1', '#F4C570', '#53C9B4', '#6698EF', '#29233F', '#F5F3FC'];

    for (let index = 0; index < colors.length; index++) {
      context.fillStyle = colors[index];
      context.fillRect((index % 4) * 120, Math.floor(index / 4) * 120, 120, 120);
    }

    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await writeFile('artifacts/reviewer-sample.png', sample);
  await page.locator('#imageFile').setInputFiles({ name: 'palette-study.png', mimeType: 'image/png', buffer: sample });
  await page.waitForFunction(() => { return document.querySelectorAll('#imageColors button').length === 8; });

  for (const [language, text] of Object.entries(copy)) {
    await page.locator('#language').selectOption(language);
    const content = await page.locator('#imageContent').boundingBox();
    const inventory = await page.locator('#imageInventory').boundingBox();
    const bounds = await page.locator('#imageCanvas').boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.25);
    const capture = `artifacts/webstore-captures/${language}-image.png`;
    await page.screenshot({ path: capture, clip: { x: 0, y: Math.floor(content.y - 6), width: 520, height: Math.ceil(inventory.y + inventory.height + 6 - Math.floor(content.y - 6)) } });
    await render(1280, 800, `<main class="slide">${brand}<div class="copy"><div class="eyebrow">COLOR PICKER · IMAGE</div><h1>${text.imageTitle}</h1><p class="description">${text.imageDescription}</p><div class="features">${text.imageFeatures.map((feature) => { return `<div class="feature">${feature}</div>`; }).join('')}</div></div><div class="panel" style="top:55px"><img src="${await dataUrl(capture)}" alt=""></div><div class="footer">Color Picker</div><div class="index">04 / 05</div></main>`, `${output}/${language}/screenshot-04-image-colors-1280x800.png`);
  }

  const drawingText = {
    en: ['A little room for ideas.', 'Sample webpage · draw, write, erase and save in 3 ways', 'Write your next idea here', 'Live desktop drawing needs the separate macOS / Windows companion.'],
    vi: ['Không gian cho ý tưởng.', 'Trang mẫu · vẽ, viết, tẩy và lưu theo 3 kiểu', 'Viết ý tưởng của bạn ở đây', 'Vẽ trực tiếp ngoài trình duyệt cần app đi kèm cho macOS / Windows.'],
    'zh-CN': ['为灵感留一点空间。', '示例网页 · 绘图、文字、擦除与三种保存方式', '在这里写下你的想法', '浏览器外实时绘图需要单独安装 macOS / Windows 配套应用。'],
  };

  for (const [language, [title, caption, annotation, companionNote]] of Object.entries(drawingText)) {
    const demo = await context.newPage();
    await demo.setViewportSize({ width: 1280, height: 800 });
    await demo.route('https://color-picker-drawing.invalid/', async (route) => {
      try {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f3fc;color:#29233f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><main style="padding:210px 80px 40px"><div style="font-size:13px;color:#8d79a7">COLOR PICKER DRAW · 05 / 05</div><h1 style="font-size:48px;letter-spacing:-2px;margin:22px 0">${title}</h1><p style="font-size:16px;color:#887b99">${caption}</p><div style="position:absolute;right:90px;top:260px;width:360px;height:280px;background:white;border:1px solid #e6def0;border-radius:24px;padding:30px;box-sizing:border-box"><div style="display:flex;gap:10px"><span style="width:65px;height:65px;border-radius:16px;background:#7c5cfc"></span><span style="width:65px;height:65px;border-radius:16px;background:#f48fb1"></span><span style="width:65px;height:65px;border-radius:16px;background:#53c9b4"></span></div><p style="font-size:24px;font-weight:650;margin-top:35px">Color. Draw. Create.</p><p style="color:#a397b1">HEX · RGBA · HSL · HSV</p></div></main><p style="position:absolute;left:80px;bottom:25px;font-size:12px;color:#887b99">${companionNote}</p></body></html>` });
      } catch (error) { throw error; }
    });
    await demo.goto('https://color-picker-drawing.invalid/');
    await demo.evaluate(async ({ url, language }) => {
      try {
        const { mountWebDrawing } = await import(url);
        mountWebDrawing({ language, color: '#7C5CFC' });
      } catch (error) { throw error; }
    }, { url: `chrome-extension://${extensionId}/drawing/webOverlay.js`, language });
    const host = demo.locator('#color-picker-drawing-overlay');
    await host.locator('.drawing-toolbar').waitFor();
    await host.locator('[data-tool="text"]').click();
    await demo.mouse.click(90, 485);
    await host.locator('textarea').fill(annotation);
    await host.locator('textarea').press('ControlOrMeta+Enter');
    await host.locator('[data-tool="highlighter"]').click();
    await demo.mouse.move(85, 535);
    await demo.mouse.down();
    await demo.mouse.move(505, 535, { steps: 12 });
    await demo.mouse.up();
    await host.locator('[data-tool="arrow"]').click();
    await demo.mouse.move(495, 455);
    await demo.mouse.down();
    await demo.mouse.move(775, 365, { steps: 12 });
    await demo.mouse.up();
    await host.locator('[data-tool="pointer"]').click();
    await host.locator('[data-action="export"]').click();
    await host.locator('[data-export-mode="screen"]').waitFor();
    await demo.screenshot({ path: `${output}/${language}/screenshot-05-drawing-1280x800.png` });
    await demo.close();
  }

  const chips = '<div class="chips"><span>HEX</span><span>RGBA</span><span>HSL</span><span>HSV</span></div>';
  await render(440, 280, `<main class="small"><h1>Color<br>Picker.</h1><img src="${icon}" alt="">${chips}</main>`, `${output}/promo-small-440x280.png`);
  await render(1400, 560, `<main class="marquee"><h1>Color Picker.</h1>${chips}<div class="spectrum"></div><img src="${icon}" alt=""></main>`, `${output}/promo-marquee-1400x560.png`);
  await cp('src/icons/128.png', `${output}/store-icon-128.png`);
  await cp('design/icon-preview-512.png', `${output}/icon-preview-512.png`);
  await writeFile(`${output}/UPLOAD-GUIDE.md`, `# Chrome Web Store artwork — Color Picker 0.0.1\n\n- Store icon: store-icon-128.png (transparent PNG; artwork 96×96 inside 128×128).\n- Default English screenshots: en/ (upload in numeric order).\n- Vietnamese screenshots: vi/ (localized listing).\n- Simplified Chinese screenshots: zh-CN/ (localized listing).\n- Small promo: promo-small-440x280.png.\n- Marquee promo: promo-marquee-1400x560.png.\n- icon-preview-512.png is for preview only, not the store icon slot.\n- Upload 5 screenshots for each locale; never upload all 15 into one locale.\n- Screenshot 05 shows the current 3-mode Save menu and the companion-app requirement for live desktop drawing.\n\nScreenshots and promotional tiles are exported as opaque 24-bit RGB PNG. Screenshots use real extension UI with sample colors in an isolated browser profile; no mock interface is shipped. Promo tiles are global and use the product name and format labels.\n\nOfficial requirements: https://developer.chrome.com/docs/webstore/cws-dashboard-listing and https://developer.chrome.com/docs/webstore/images\n`);

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  const assets = [];
  const filenames = ['store-icon-128.png', 'icon-preview-512.png', 'promo-small-440x280.png', 'promo-marquee-1400x560.png'];

  for (const language of Object.keys(copy)) {
    for (const filename of await readdir(`${output}/${language}`)) {
      if (filename.endsWith('.png')) {
        filenames.push(`${language}/${filename}`);
      }
    }
  }

  for (const filename of filenames) {
    const bytes = await readFile(`${output}/${filename}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    let expected = [1280, 800, 2];

    if (filename.startsWith('store-icon')) {
      expected = [128, 128, 6];
    } else if (filename.startsWith('icon-preview')) {
      expected = [512, 512, 6];
    } else if (filename.startsWith('promo-small')) {
      expected = [440, 280, 2];
    } else if (filename.startsWith('promo-marquee')) {
      expected = [1400, 560, 2];
    }

    if (width !== expected[0] || height !== expected[1] || colorType !== expected[2] || bitDepth !== 8) {
      throw new Error(`Invalid PNG dimensions or color format: ${filename}`);
    }

    assets.push({ filename, width, height, bitDepth, colorType, sha256: createHash('sha256').update(bytes).digest('hex') });
  }

  await writeFile(`${output}/ASSET-MANIFEST.json`, `${JSON.stringify({ version: '0.0.1', assets }, null, 2)}\n`);
  await writeFile(`${output}/SHA256SUMS`, assets.map((asset) => { return `${asset.sha256}  ${asset.filename}`; }).join('\n') + '\n');
  const archive = path.resolve('artifacts/webstore-images.zip');
  await rm(archive, { force: true });
  execFileSync('zip', ['-qr', archive, '.'], { cwd: output });
  const archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile('artifacts/webstore-images-SHA256SUMS', `${archiveHash}  webstore-images.zip\n`);
  console.info(`Verified ${assets.length} PNG assets and packaged artifacts/webstore-images.zip`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await context?.close();
  if (profile) {
    await rm(profile, { recursive: true, force: true });
  }
}
