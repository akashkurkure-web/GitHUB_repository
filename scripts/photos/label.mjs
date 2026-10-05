// Rasterise an HTML label to PNG: node label.mjs out.png width height '<html>'
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [out, w, h, html] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.setContent(`<style>*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden}</style>` + html);
await p.waitForTimeout(150); await p.screenshot({ path: out, omitBackground: true }); await b.close();
