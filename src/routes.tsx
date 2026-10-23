import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RoutePlannerPage } from "./features/route-planner/RoutePlannerPage";

const WorkbenchRoutes = lazy(() => import("./features/workbench/WorkbenchRoutes").then(module => ({ default: module.WorkbenchRoutes })));

/** Workbench tools are served by the same build on their own host (`workbench.collisionlab.world`, or `workbench.localhost` locally). */
export const isWorkbenchHost = (hostname = window.location.hostname) => hostname.startsWith("workbench.");

function NotFound() {
  return <main className="not-found"><h1>Page not found</h1><a href="/route">Open the route planner</a></main>;
}
export function PublicRoutes() {
  if (isWorkbenchHost()) return <Suspense fallback={null}><WorkbenchRoutes /></Suspense>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/route" replace />} />
      <Route path="/route" element={<RoutePlannerPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
