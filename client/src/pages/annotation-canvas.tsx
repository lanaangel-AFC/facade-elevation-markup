import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useParams } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Crosshair, ExternalLink } from "lucide-react";
import type { Project, Elevation, Marker } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  open: "#EF4444",
  in_progress: "#F59E0B",
  complete: "#22C55E",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  complete: "Complete",
};

export default function AnnotationCanvas() {
  const { projectId, elevationId } = useParams<{ projectId: string; elevationId: string }>();

  // State
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [placingMode, setPlacingMode] = useState(false);
  const [markerDialog, setMarkerDialog] = useState<{
    open: boolean;
    x: number;
    y: number;
    editing?: Marker;
  }>({ open: false, x: 0, y: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<Marker | null>(null);
  const [formUid, setFormUid] = useState("");
  const [formStatus, setFormStatus] = useState("open");
  const [formNote, setFormNote] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);

  // Queries
  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}`);
      return res.json();
    },
  });

  const { data: elevation } = useQuery<Elevation>({
    queryKey: ["/api/elevations", elevationId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/elevations/${elevationId}`);
      return res.json();
    },
  });

  const { data: markerList = [] } = useQuery<Marker[]>({
    queryKey: ["/api/elevations", elevationId, "markers"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/elevations/${elevationId}/markers`);
      return res.json();
    },
  });

  // Load image or PDF
  useEffect(() => {
    if (!elevation) return;
    const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
    if (elevation.fileType === "image") {
      setImageSrc(`${API_BASE}/api/uploads/${elevation.filename}`);
    } else if (elevation.fileType === "pdf") {
      loadPdf(elevation.filename);
    }
  }, [elevation]);

  const loadPdf = async (filename: string) => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const url = `${API_BASE}/api/uploads/${filename}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      // Render at a scale that produces a good resolution image
      // Target ~2400px on the longest side for crisp rendering on retina displays
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDim = Math.max(baseViewport.width, baseViewport.height);
      const renderScale = Math.min(2400 / maxDim, 3); // Cap at 3x to avoid memory issues
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setImageSrc(canvas.toDataURL("image/png"));
    } catch (err) {
      console.error("PDF load error:", err);
    }
  };

  // Mutations
  const createMarkerMut = useMutation({
    mutationFn: async (data: { defectUid: string; status: string; note: string; xPercent: number; yPercent: number }) => {
      const res = await apiRequest("POST", `/api/elevations/${elevationId}/markers`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/elevations", elevationId, "markers"] });
      closeDialog();
    },
  });

  const updateMarkerMut = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; defectUid: string; status: string; note: string }) => {
      const res = await apiRequest("PATCH", `/api/markers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/elevations", elevationId, "markers"] });
      closeDialog();
    },
  });

  const deleteMarkerMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/markers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/elevations", elevationId, "markers"] });
      setDeleteConfirm(null);
    },
  });

  const closeDialog = () => {
    setMarkerDialog({ open: false, x: 0, y: 0 });
    setFormUid("");
    setFormStatus("open");
    setFormNote("");
    setDeepLink(null);
    setDeepLinkLoading(false);
  };

  // Resolve a deep link to a specific defect in the Defect Tracker
  const resolveDeepLink = async (defectUid: string) => {
    if (!project?.trackerUrl) return;
    setDeepLinkLoading(true);
    setDeepLink(null);
    try {
      // Parse tracker URL to extract base URL and project ID
      // Formats: https://.../#/projects/2, https://.../#/projects/2/reports/3, or just https://...
      const hashIdx = project.trackerUrl.indexOf("/#/");
      const baseUrl = hashIdx >= 0 ? project.trackerUrl.substring(0, hashIdx) : project.trackerUrl.replace(/\/$/, "");
      const hashPath = hashIdx >= 0 ? project.trackerUrl.substring(hashIdx + 3) : "";
      const projectMatch = hashPath.match(/^projects\/(\d+)/);
      if (!projectMatch) {
        setDeepLink(project.trackerUrl);
        return;
      }
      const trackerProjectId = projectMatch[1];
      const res = await fetch(`${baseUrl}/api/projects/${trackerProjectId}/defects/by-uid/${encodeURIComponent(defectUid)}`);
      if (res.ok) {
        const defect = await res.json();
        setDeepLink(`${baseUrl}/#/projects/${trackerProjectId}/reports/${defect.reportId}/defects/${defect.id}`);
      } else {
        // Defect not found by UID — fall back to project page
        setDeepLink(project.trackerUrl);
      }
    } catch {
      setDeepLink(project.trackerUrl);
    } finally {
      setDeepLinkLoading(false);
    }
  };

  // Handle canvas click for placing markers
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!placingMode || !imageRef.current) return;
      const img = imageRef.current;
      const rect = img.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      setMarkerDialog({ open: true, x, y });
      setPlacingMode(false);
    },
    [placingMode]
  );

  // Handle existing marker click
  const handleMarkerClick = (e: React.MouseEvent, marker: Marker) => {
    e.stopPropagation();
    setFormUid(marker.defectUid);
    setFormStatus(marker.status);
    setFormNote(marker.note || "");
    setMarkerDialog({ open: true, x: marker.xPercent, y: marker.yPercent, editing: marker });
    // Resolve deep link to specific defect in tracker
    resolveDeepLink(marker.defectUid);
  };

  // Zoom controls
  const zoomIn = () => setScale((s) => Math.min(s * 1.3, 5));
  const zoomOut = () => setScale((s) => Math.max(s / 1.3, 0.5));
  const resetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // Mouse/touch pan
  const handlePointerDown = (e: React.PointerEvent) => {
    if (placingMode) return;
    if (scale > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - translate.x, y: e.clientY - translate.y });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setTranslate({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handlePointerUp = () => setIsPanning(false);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.5, Math.min(5, s * delta)));
  };

  // Touch pinch zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      lastTouchCenter.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scaleRatio = dist / lastTouchDist.current;
      setScale((s) => Math.max(0.5, Math.min(5, s * scaleRatio)));
      lastTouchDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    lastTouchDist.current = null;
    lastTouchCenter.current = null;
  };

  // Form submit
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUid.trim()) return;
    if (markerDialog.editing) {
      updateMarkerMut.mutate({
        id: markerDialog.editing.id,
        defectUid: formUid.trim(),
        status: formStatus,
        note: formNote.trim(),
      });
    } else {
      createMarkerMut.mutate({
        defectUid: formUid.trim(),
        status: formStatus,
        note: formNote.trim(),
        xPercent: markerDialog.x,
        yPercent: markerDialog.y,
      });
    }
  };

  // Counts
  const counts = {
    open: markerList.filter((m) => m.status === "open").length,
    in_progress: markerList.filter((m) => m.status === "in_progress").length,
    complete: markerList.filter((m) => m.status === "complete").length,
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background/95 backdrop-blur z-20 flex-shrink-0">
        <Link href={`/projects/${projectId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-elevation-name">
            {elevation?.name || "Loading..."}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} data-testid="button-zoom-out">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} data-testid="button-zoom-in">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetZoom} data-testid="button-zoom-reset">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
            Open: {counts.open}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            In Progress: {counts.in_progress}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            Complete: {counts.complete}
          </span>
        </div>
        <Button
          size="sm"
          variant={placingMode ? "default" : "outline"}
          className="h-7 text-xs gap-1"
          onClick={() => setPlacingMode(!placingMode)}
          data-testid="button-place-marker"
        >
          <Crosshair className="w-3 h-3" />
          {placingMode ? "Tap to place" : "Add Marker"}
        </Button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative bg-muted/30"
        style={{ cursor: placingMode ? "crosshair" : scale > 1 ? "grab" : "default", touchAction: scale > 1 ? "none" : "auto" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {imageSrc ? (
          <div
            className="relative inline-block origin-top-left"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transition: isPanning ? "none" : "transform 0.15s ease-out",
            }}
            onClick={handleCanvasClick}
          >
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Elevation drawing"
              className="w-full h-auto select-none"
              draggable={false}
              onLoad={() => setImageLoaded(true)}
              data-testid="img-elevation"
            />
            {/* Markers overlay */}
            {imageLoaded &&
              markerList.map((marker) => (
                <div
                  key={marker.id}
                  className="absolute flex flex-col items-center pointer-events-auto"
                  style={{
                    left: `${marker.xPercent}%`,
                    top: `${marker.yPercent}%`,
                    transform: `translate(-50%, -100%) scale(${1 / scale})`,
                    transformOrigin: "bottom center",
                    zIndex: 10,
                  }}
                  onClick={(e) => handleMarkerClick(e, marker)}
                  data-testid={`marker-${marker.id}`}
                >
                  {/* Pin */}
                  <div className="flex flex-col items-center cursor-pointer group">
                    <span
                      className="text-[10px] font-mono font-semibold px-1 rounded whitespace-nowrap mb-0.5"
                      style={{
                        backgroundColor: STATUS_COLORS[marker.status],
                        color: "#fff",
                      }}
                    >
                      {marker.defectUid}
                    </span>
                    <svg width="16" height="22" viewBox="0 0 16 22" fill="none">
                      <path
                        d="M8 0C3.6 0 0 3.6 0 8c0 5.4 7.05 13.09 7.35 13.43a.87.87 0 001.3 0C8.95 21.09 16 13.4 16 8c0-4.4-3.6-8-8-8z"
                        fill={STATUS_COLORS[marker.status]}
                      />
                      <circle cx="8" cy="8" r="3" fill="white" />
                    </svg>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">Loading drawing...</p>
          </div>
        )}
      </div>

      {/* Marker create/edit dialog */}
      <Dialog open={markerDialog.open} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{markerDialog.editing ? "Edit Marker" : "New Marker"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <Label htmlFor="defectUid">Defect UID</Label>
              <Input
                id="defectUid"
                data-testid="input-defect-uid"
                value={formUid}
                onChange={(e) => setFormUid(e.target.value)}
                placeholder="e.g. 03-04-CR-01"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                      Open
                    </span>
                  </SelectItem>
                  <SelectItem value="in_progress">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                      In Progress
                    </span>
                  </SelectItem>
                  <SelectItem value="complete">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
                      Complete
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                data-testid="input-note"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="e.g. Crack at window head"
                rows={2}
              />
            </div>
            {markerDialog.editing && project?.trackerUrl && (
              deepLinkLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-muted-foreground text-sm">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Looking up defect in tracker...
                </div>
              ) : deepLink ? (
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                  data-testid="link-view-in-tracker"
                >
                  <ExternalLink className="w-4 h-4" />
                  {deepLink === project.trackerUrl ? "Open Defect Tracker" : "View Defect in Tracker"}
                </a>
              ) : null
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                data-testid="button-save-marker"
                disabled={!formUid.trim() || createMarkerMut.isPending || updateMarkerMut.isPending}
                className="flex-1"
              >
                {createMarkerMut.isPending || updateMarkerMut.isPending ? "Saving..." : "Save"}
              </Button>
              {markerDialog.editing && (
                <Button
                  type="button"
                  variant="destructive"
                  data-testid="button-delete-marker"
                  onClick={() => setDeleteConfirm(markerDialog.editing!)}
                >
                  Delete
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(v) => !v && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Marker?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove marker "{deleteConfirm?.defectUid}" from this elevation?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirm) {
                  deleteMarkerMut.mutate(deleteConfirm.id);
                  closeDialog();
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
