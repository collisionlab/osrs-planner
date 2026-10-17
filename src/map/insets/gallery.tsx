import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { RoutePlan } from "../../domain/contracts";
import { InsetMap } from "./InsetMap";
import reference from "./fixtures/reference.json";
import { segmentPoints } from "./composition";
const fixtures = import.meta.glob("./fixtures/routes/*.json", { eager: true, import: "default" }) as Record<string, RoutePlan>;
const referencePlan = reference as unknown as RoutePlan;
const underground = referencePlan.segments.filter(segment => segmentPoints(segment).every(point => point.y >= 10000));
fixtures["underground-only"] = { ...referencePlan, segments: underground,
  start: { ...referencePlan.start, name: "Underground start", coordinate: segmentPoints(underground[0])[0] } };
const entries = Object.entries(fixtures);
function Gallery() {
  const [key, setKey] = useState(entries[0][0]);
  const [picked, setPicked] = useState("");
  const [selected, setSelected] = useState<number>();
  const route = fixtures[key];
  return <><nav><label>Route <select value={key} onChange={e => { setKey(e.target.value); setSelected(undefined); }}>
    {entries.map(([key]) => <option key={key} value={key}>{key.split("/").pop()?.replace(".json", "")}</option>)}
  </select></label> <span>{route.start.name} → {route.destination.name}</span><output aria-label="Picked tile">{picked}</output></nav>
    <main style={{ position: "absolute", inset: "48px 0 0" }}>
      <InsetMap start={route.start} destination={route.destination} route={route} selectedSegment={selected}
        style="tactical" onSelectSegment={setSelected} onPick={point => setPicked(`${point.x}, ${point.y}, plane ${point.plane}`)} onMoveStart={point => setPicked(`Start: ${point.x}, ${point.y}, plane ${point.plane}`)} onMoveDestination={point => setPicked(`Destination: ${point.x}, ${point.y}, plane ${point.plane}`)} onFallback={() => {}} />
    </main></>;
}
const style = document.createElement("style"); style.textContent = "html,body,#root{margin:0;height:100%;background:#17202a;color:#f7f1dc;font:14px sans-serif}nav{padding:12px}.route-map{position:absolute;inset:0}.map-message{position:absolute;bottom:20px;left:20px;background:#17202a;padding:10px}"; document.head.append(style);
createRoot(document.getElementById("root")!).render(<Gallery />);
