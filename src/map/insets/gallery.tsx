import { createRoot } from "react-dom/client";
import { Gallery } from "./RouteGallery";
import "./gallery.css";
const root = createRoot(document.getElementById("root")!);
root.render(<Gallery />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
