import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import ProjectList from "./pages/project-list";
import ProjectDetail from "./pages/project-detail";
import AnnotationCanvas from "./pages/annotation-canvas";
import NotFound from "./pages/not-found";
import { PerplexityAttribution } from "./components/PerplexityAttribution";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/" component={ProjectList} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/projects/:projectId/elevations/:elevationId" component={AnnotationCanvas} />
            <Route component={NotFound} />
          </Switch>
        </Router>
        <PerplexityAttribution />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
