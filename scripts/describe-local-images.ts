import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { imageCaptionSchema, type CollectedImage } from '../src/image-metadata.js';

// This tool only renders inspection sheets and validates captions authored in-chat.
// It never calls an inference API. Compact observations expand into the existing schema.
const root = path.resolve('data/local/dribbble');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'images.json'), 'utf8'));
const queueFile = path.join(root, 'direct-analysis-queue.json');
let queue: CollectedImage[];
try { queue = JSON.parse(await fs.readFile(queueFile, 'utf8')); }
catch {
  queue = [];
  for (const item of manifest.images) {
    try { const m = JSON.parse(await fs.readFile(path.join(root, 'metadata', item.sha256 + '.json'), 'utf8'));
      if (m.promptVersion === 2 && imageCaptionSchema.safeParse(m.caption).success) continue;
    } catch {}
    queue.push(item);
  }
  await fs.writeFile(queueFile, JSON.stringify(queue));
}
const [mode, arg] = process.argv.slice(2);
if (mode === 'sheet') {
  const start = Number(arg || 0), count = 24, cols = 4, w = 640, h = 508;
  const items = queue.slice(start, start + count);
  const layers: OverlayOptions[] = [];
  for (let i = 0; i < items.length; i++) {
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    const bytes = await sharp(items[i].localPath).resize(w, 480, {fit: 'contain', background: '#e5e5e5'}).png().toBuffer();
    layers.push({input: bytes, left: x, top: y + 28});
    layers.push({input: Buffer.from(`<svg width="640" height="28"><rect width="640" height="28" fill="#fff"/><text x="10" y="21" font-size="20" font-family="sans-serif" fill="#000">${start+i+1} · ${items[i].sha256.slice(0, 8)}</text></svg>`),left:x,top:y});
  }
  const out = path.join(root, `inspection-${start}.png`);
  await sharp({create:{width:cols*w,height:Math.ceil(items.length/cols)*h,channels:3,background:'#fff'}}).composite(layers).png().toFile(out);
  console.log(out);
} else if (mode === 'save') {
  const rows = JSON.parse(await fs.readFile(arg, 'utf8'));
  for (const input of rows) {
    const row = Array.isArray(input) ? Object.fromEntries(['n','title','d','l','colors','parts','task','principle','type','img','ui'].map((key,i)=>[key,input[i]])) : input;
    const image = queue[row.n - 1];
    if (!image || !row.d || !row.l || !row.task || !row.principle) throw new Error('Incomplete inspected observation');
    const presentationType = row.type ?? 'single-screen';
    const caption = imageCaptionSchema.parse({
      isInterface: row.ui !== false, title: row.title, presentationType,
      visibleDescription: row.d + (presentationType !== 'single-screen' ? ' The surrounding montage or mockup is presentation, not verified page structure.' : ' This describes the visible screen, not verified behavior.'),
      layout: row.l, palette: row.colors.split(',').map((s:string)=>s.trim()),
      typography: row.typo ?? (row.ui === false ? 'Interface typography is not established by this artwork.' : 'Text hierarchy is described only at preview scale; exact typeface and small text are not identifiable.'),
      imagery: row.img ?? 'No dominant photographic subject is distinguishable at this preview resolution.',
      components: row.parts.split(',').map((s:string)=>s.trim()), pageTypes:[row.page ?? row.task], industries: row.industry ? [row.industry] : [],
      moods: row.mood ? [row.mood] : [], useWhen:[row.task], avoidWhen:[row.avoid ?? `Tasks unrelated to ${row.task}; inspect a more relevant reference instead.`],
      queryAliases:[row.title, `${row.task}: ${row.l.slice(0,110)}`, `${row.task}: ${row.img ?? row.principle}`],
      transferablePrinciples:[row.principle],
      implementationApproach:`Unverified adaptation proposal: ${row.impl ?? row.principle} Use original content and existing project components.`,
      implementationSteps:[`Map the user's ${row.task} content into the observed hierarchy.`, row.impl ?? row.principle, 'Build and test behavior independently; the screenshot is not source code.'],
      adaptation:[row.adapt ?? `Replace the ${row.task} subject matter, branding and assets; retain only the useful content relationship.`],
      limitations:['Preview only; small text and exact measurements are uncertain.','Interactions, responsiveness and accessibility are not verified.'],
      confidence:row.confidence ?? (presentationType === 'unclear' ? 'low' : 'medium')
    });
    let prior;
    try { prior = JSON.parse(await fs.readFile(path.join(root,'metadata',image.sha256+'.json'),'utf8')); } catch {}
    const unchanged = prior?.model === 'codex-direct-visual-analysis' && JSON.stringify(prior.caption) === JSON.stringify(caption);
    const metadata = {version:1,promptVersion:2,imageSha256:image.sha256,sourceImageUrl:image.sourceImageUrl,
      model:'codex-direct-visual-analysis',captionedAt:unchanged ? prior.captionedAt : new Date().toISOString(),reviewStatus:'machine-captioned',
      analysisMethod:'Direct inspection by the chat assistant; no Cloudflare AI inference.',inspectionSheet:`inspection-${Math.floor((row.n-1)/24)*24}.png`,caption};
    await fs.writeFile(path.join(root,'metadata',image.sha256+'.json'),JSON.stringify(metadata,null,2));
  }
  console.log(`Validated and saved ${rows.length} directly inspected captions.`);
} else throw new Error('Use sheet <offset> or save <observations.json>');
