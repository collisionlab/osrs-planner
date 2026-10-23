import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };

test.use({ baseURL: "http://workbench.localhost:5179" });
const root = path.resolve(import.meta.dirname,"fixtures/routing");
const fixture = JSON.parse(readFileSync(path.join(root,"dungeon.json"),"utf8"));
type Point = { x: number; y: number; plane: number };
const point = (p: number[]): Point => ({ x:p[0],y:p[1],plane:p[2] });
async function setup(page: Page) {
  // Exercise the optional Blueprint selector even while the published terrain pin has two styles.
  await page.route(url => url.pathname === "/tiles.json", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"tactical"', '"tactical", "blueprint"');
    await route.fulfill({ response, body });
  });
  await page.route(`${tiles.base}/routing-layers/${tiles.routingLayers.version}/**`, route => {
    const relative = new URL(route.request().url()).pathname.split(`/${tiles.routingLayers.version}/`)[1];
    const file = path.join(root,relative);
    return existsSync(file) ? route.fulfill({ body:readFileSync(file),contentType:relative.endsWith(".json") ? "application/json" : "application/octet-stream" }) : route.fulfill({status:404});
  });
  await page.route(url => url.pathname.startsWith("/api/"), route => route.fulfill({ status:404,json:{error:"No service fixture"} }));
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style","tactical"));
}
async function at(page: Page,p: Point) {
  await page.evaluate(p => (window as unknown as {insetMap:{showTile(p:Point):void}}).insetMap.showTile(p),p);
  await page.waitForTimeout(350);
}
async function pixel(page: Page,p: Point) {
  return page.evaluate(p => (window as unknown as {insetMap:{pixel(p:Point):number[]}}).insetMap.pixel(p),p);
}
async function click(page: Page,p: Point) {
  await at(page,p); const [x,y]=await pixel(page,p),box=(await page.locator(".inset-map").boundingBox())!;
  await page.mouse.click(box.x+x,box.y+y);
}
async function colour(page: Page,p: Point) {
  return page.evaluate(p => {
    const [x,y]=(window as unknown as {insetMap:{pixel(p:Point):number[]}}).insetMap.pixel(p);
    const canvas=document.querySelector<HTMLCanvasElement>("canvas[data-routing-layer]")!;
    const ratio=canvas.width/parseFloat(canvas.style.width);
    return [...canvas.getContext("2d")!.getImageData(Math.floor(x*ratio),Math.floor(y*ratio),1,1).data];
  },p);
}
async function openDungeon(page: Page) {
  await setup(page);
  await page.goto(`/insets?area=area:taverley-dungeon&region=${fixture.region.id}&at=2893,9792,0&z=10`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as {insetMap?:unknown}).insetMap);
}

test("real dungeon partitions and negative terrain survive styles, inset dragging, clipping and floor changes",async({page}) => {
  await openDungeon(page);
  const requests: string[]=[];page.on("request",request=>{if(request.url().endsWith(".bin")&&request.url().includes("routing-layers"))requests.push(request.url());});
  await page.getByLabel("Routing components",{exact:true}).check();
  const retained=point(fixture.samples.component761),negative=point(fixture.samples.unreachable);
  await click(page,retained);
  await expect(page.getByLabel("Production routing component",{exact:true})).toContainText("761");
  const originalHandle=await page.evaluate(() => { (window as unknown as {routingHandle:unknown;insetMap:unknown}).routingHandle=(window as unknown as {insetMap:unknown}).insetMap;return true; });
  expect(originalHandle).toBe(true);
  await page.getByLabel("Structurally unreachable",{exact:true}).check();
  expect(await page.evaluate(() => (window as unknown as {routingHandle:unknown;insetMap:unknown}).routingHandle===(window as unknown as {insetMap:unknown}).insetMap)).toBe(true);
  await click(page,negative);
  await expect(page.getByLabel("Routing tile status")).toContainText("Structurally unreachable walking terrain");
  await expect(page.getByLabel("Routing tile status")).toContainText("outside the retained production search graph");
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await page.getByLabel("Minimum unreachable fragment tiles").fill("100000000");
  await expect.poll(async()=> (await colour(page,negative))[3]).toBe(0);
  await page.getByLabel("Minimum unreachable fragment tiles").fill("0");
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await at(page,point(fixture.clipped));
  await expect.poll(async()=> (await colour(page,point(fixture.clipped)))[3]).toBe(0);
  await at(page,negative);
  await page.getByRole("button",{name:"Standard",exact:true}).click();
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Blueprint",exact:true}).click();
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Tactical",exact:true}).click();
  await page.getByRole("button",{name:"Beside entrance",exact:true}).click();
  await at(page,negative);
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await page.evaluate(id => (window as unknown as {insetMap:{fitRegions(ids:string[]):void}}).insetMap.fitRegions([id]),fixture.region.id);
  await page.waitForTimeout(350);
  const header=page.locator(".inset-label").filter({hasText:"Taverley"}).first();
  const before=await pixel(page,negative),bounds=(await header.boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+70,bounds.y+bounds.height/2+45,{steps:5});await page.mouse.up();
  const after=await pixel(page,negative);expect(after[0]-before[0]).toBeCloseTo(70,0);expect(after[1]-before[1]).toBeCloseTo(45,0);
  await expect.poll(async()=> (await colour(page,negative))[3]).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Plane 1",exact:true}).click();
  await expect(page.locator(".inset-label").filter({hasText:"Plane 1"}).first()).toBeVisible();
  const upper=point(fixture.upper.point);
  await click(page,upper);
  await expect(page.getByLabel("Routing tile status")).toContainText(`production routing component ${fixture.upper.component}`);
  await at(page,upper); // Selecting the new floor removes the old inspected floor from the layout.
  await expect.poll(async()=> (await colour(page,upper))[3]).toBeGreaterThan(0);
  expect(new Set(requests).size).toBe(requests.length);
});

test("selects the exact production diagonal crossing as an internal edge",async({page})=>{
  await setup(page); const crossing=fixture.surfaceCrossing,from=point(crossing.from),to=point(crossing.to);
  await page.goto(`/insets?at=${from.x},${from.y},0&z=11`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.getByLabel("Synthetic separators",{exact:true}).check();
  await expect(page.locator("canvas[data-routing-layer]")).toBeVisible();
  await expect.poll(async()=> (await colour(page,from))[3]).toBeGreaterThan(0);
  const a=await pixel(page,from),b=await pixel(page,to),box=(await page.locator(".inset-map").boundingBox())!;
  await page.mouse.click(box.x+(a[0]+b[0])/2,box.y+(a[1]+b[1])/2);
  await expect(page.getByLabel("Synthetic crossing details")).toContainText("Internal routing crossing 1");
  await expect(page.getByLabel("Synthetic crossing details")).toContainText("3282 2904 0 → 3283 2905 0");
  await expect(page.getByLabel("Synthetic crossing details")).toContainText("Cost: 1");
});

for (const field of ["collisionContentSha256","transportSha256","separatorSha256"]) {
  test(`rejects mismatched ${field} before requesting spatial data`,async({page})=>{
    await setup(page);
    const manifest=JSON.parse(readFileSync(path.join(root,"manifest.json"),"utf8"));manifest[field]="0".repeat(64);
    await page.route(`${tiles.base}/routing-layers/${tiles.routingLayers.version}/manifest.json`,route=>route.fulfill({json:manifest}));
    const squares:string[]=[];page.on("request",request=>{if(request.url().includes("routing-layers")&&request.url().endsWith(".bin"))squares.push(request.url());});
    await page.goto("/insets");
    await page.getByLabel("Routing components",{exact:true}).check();
    await expect(page.getByRole("alert")).toContainText("Routing layers do not match");
    expect(squares).toEqual([]);
  });
}
