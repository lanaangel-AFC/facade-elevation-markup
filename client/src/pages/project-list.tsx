import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Building2, MapPin, Layers } from "lucide-react";
import type { Project } from "@shared/schema";

type ProjectWithCount = Project & { elevationCount: number };

export default function ProjectList() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [trackerUrl, setTrackerUrl] = useState("");

  const { data: projects, isLoading } = useQuery<ProjectWithCount[]>({
    queryKey: ["/api/projects"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; address: string; trackerUrl?: string }) => {
      const res = await apiRequest("POST", "/api/projects", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setOpen(false);
      setName("");
      setAddress("");
      setTrackerUrl("");
    },
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
            Elevation Markup
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tag defects on elevation drawings
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-project" size="sm">
              <Plus className="w-4 h-4 mr-1" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && address.trim()) {
                  createMutation.mutate({ name: name.trim(), address: address.trim(), trackerUrl: trackerUrl.trim() || undefined });
                }
              }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  data-testid="input-project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 123 George Street"
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  data-testid="input-project-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 123 George Street, Sydney NSW 2000"
                />
              </div>
              <div>
                <Label htmlFor="trackerUrl">Defect Tracker Link (optional)</Label>
                <Input
                  id="trackerUrl"
                  data-testid="input-tracker-url"
                  value={trackerUrl}
                  onChange={(e) => setTrackerUrl(e.target.value)}
                  placeholder="Paste your Defect Tracker report URL"
                  className="text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Links defect markers to the Defect Tracker report
                </p>
              </div>
              <Button
                type="submit"
                data-testid="button-create-project"
                disabled={createMutation.isPending}
                className="w-full"
              >
                {createMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="space-y-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              data-testid={`link-project-${project.id}`}
            >
              <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">{project.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span className="text-xs">{project.address}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Layers className="w-3.5 h-3.5" />
                      <span className="text-xs">{project.elevationCount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">No projects yet</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            Create a project to get started
          </p>
        </div>
      )}
    </div>
  );
}
