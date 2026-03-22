import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useParams, useLocation } from "wouter";
import { useState, useRef } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Upload, FileImage, FileText, Trash2, Image } from "lucide-react";
import type { Project, Elevation } from "@shared/schema";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [elevName, setElevName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${id}`);
      return res.json();
    },
  });

  const { data: elevationList, isLoading } = useQuery<Elevation[]>({
    queryKey: ["/api/projects", id, "elevations"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${id}/elevations`);
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name);
      const res = await fetch(`/api/projects/${id}/elevations`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "elevations"] });
      setUploadOpen(false);
      setElevName("");
      setSelectedFile(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (elevId: number) => {
      await apiRequest("DELETE", `/api/elevations/${elevId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "elevations"] });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      navigate("/");
    },
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate" data-testid="text-project-name">
            {project?.name || "Loading..."}
          </h1>
          <p className="text-xs text-muted-foreground truncate">{project?.address}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-destructive" data-testid="button-delete-project">
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Project?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this project and all its elevation drawings and markers.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteProjectMutation.mutate()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground">Elevations</h2>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-upload-elevation">
              <Upload className="w-4 h-4 mr-1" />
              Upload
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Elevation</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (selectedFile && elevName.trim()) {
                  uploadMutation.mutate({ file: selectedFile, name: elevName.trim() });
                }
              }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="elevName">Elevation Name</Label>
                <Input
                  id="elevName"
                  data-testid="input-elevation-name"
                  value={elevName}
                  onChange={(e) => setElevName(e.target.value)}
                  placeholder="e.g. North Elevation, Drop 1 - East Face"
                />
              </div>
              <div>
                <Label>File (PDF or Image)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  data-testid="input-elevation-file"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-1"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-choose-file"
                >
                  {selectedFile ? selectedFile.name : "Choose file..."}
                </Button>
              </div>
              <Button
                type="submit"
                data-testid="button-upload-submit"
                disabled={uploadMutation.isPending || !selectedFile || !elevName.trim()}
                className="w-full"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : elevationList && elevationList.length > 0 ? (
        <div className="space-y-3">
          {elevationList.map((elev) => (
            <div key={elev.id} className="flex items-center gap-2">
              <Link
                href={`/projects/${id}/elevations/${elev.id}`}
                className="flex-1"
                data-testid={`link-elevation-${elev.id}`}
              >
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                      {elev.fileType === "pdf" ? (
                        <FileText className="w-5 h-5 text-primary" />
                      ) : (
                        <FileImage className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{elev.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {elev.fileType === "pdf" ? "PDF Drawing" : "Photo"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                    data-testid={`button-delete-elevation-${elev.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Elevation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete "{elev.name}" and all its markers.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate(elev.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Image className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">No elevations yet</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            Upload a PDF drawing or photo to start marking up defects
          </p>
        </div>
      )}
    </div>
  );
}
