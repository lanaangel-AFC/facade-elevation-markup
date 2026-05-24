import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useParams } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Crosshair,
  ExternalLink,
  Pencil,
  Type,
  Eraser,
  Undo2,
  Trash2,
  Download,
} from "lucide-react";
import type { Project, Elevation, Marker } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  open: "#EF4444",
  in_progress: "#F59E0B",
  complete: "#22C55E",
};

const ANNOT_COLORS = [
  { name: "Red", value: "#EF4444" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#22C55E" },
  { name: "Black", value: "#1F2937" },
];

const LINE_WIDTHS = [
  { name: "Thin", value: 2 },
  { name: "Medium", value: 4 },
  { name: "Thick", value: 8 },
];

type Point = { x: number; y: number };
type Stroke = { id: string; color: string; width: number; points: Point[]; createdAt?: number };
type TextLabel = { id: string; x: number; y: number; text: string; color: string; fontSize: number; createdAt?: number };
type AnnotationData = { strokes: Stroke[]; labels: TextLabel[] };

type AnnotTool = "pen" | "text" | "eraser";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyAnnotations(): AnnotationData {
  return { strokes: [], labels: [] };
}

function parseAnnotations(s: string | null | undefined): AnnotationData {
  if (!s) return emptyAnnotations();
  try {
    const parsed = JSON.parse(s);
    return {
      strokes: Array.isArray(parsed.strokes) ? parsed.strokes : [],
      labels: Array.isArray(parsed.labels) ? parsed.labels : [],
    };
  } catch {
    return emptyAnnotations();
  }
}

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
  const [mode, setMode] = useState<"markers" | "annotate">("markers");
  const [tool, setTool] = useState<AnnotTool>("pen");
  const [color, setColor] = useState<string>(ANNOT_COLORS[0].value);
  const [lineWidth, setLineWidth] = useState<number>(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [labels, setLabels] = useState<TextLabel[]>([]);
  const [pendingLabel, setPendingLabel] = useState<{ x: number; y: number; text: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const annotationsLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

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

  // Load annotations once when elevation arrives
  useEffect(() => {
    if (!elevation || annotationsLoadedRef.current) return;
    const data = parseAnnotations(elevation.annotationData);
    setStrokes(data.strokes);
    setLabels(data.labels);
    annotationsLoadedRef.current = true;
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
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDim = Math.max(baseViewport.width, baseViewport.height);
      const renderScale = Math.min(2400 / maxDim, 3);
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

  const saveAnnotationsMut = useMutation({
    mutationFn: async (data: AnnotationData) => {
      const res = await apiRequest("PATCH", `/api/elevations/${elevationId}/annotations`, {
        annotationData: JSON.stringify(data),
      });
      return res.json();
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      queryClient.invalidateQueries({ queryKey: ["/api/elevations", elevationId] });
    },
    onError: () => setSaveStatus("idle"),
  });

  const closeDialog = () => {
    setMarkerDialog({ open: false, x: 0, y: 0 });
    setFormUid("");
    setFormStatus("open");
    setFormNote("");
    setDeepLink(null);
    setDeepLinkLoading(false);
  };

  // Deep link resolver
  const resolveDeepLink = async (defectUid: string) => {
    if (!project?.trackerUrl) return;
    setDeepLinkLoading(true);
    setDeepLink(null);
    try {
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
        setDeepLink(project.trackerUrl);
      }
    } catch {
      setDeepLink(project.trackerUrl);
    } finally {
      setDeepLinkLoading(false);
    }
  };

  // Marker click handlers (Markers mode only)
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== "markers" || !placingMode || !imageRef.current) return;
      const img = imageRef.current;
      const rect = img.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      setMarkerDialog({ open: true, x, y });
      setPlacingMode(false);
    },
    [placingMode, mode]
  );

  const handleMarkerClick = (e: React.MouseEvent, marker: Marker) => {
    e.stopPropagation();
    if (mode !== "markers") return;
    setFormUid(marker.defectUid);
    setFormStatus(marker.status);
    setFormNote(marker.note || "");
    setMarkerDialog({ open: true, x: marker.xPercent, y: marker.yPercent, editing: marker });
    resolveDeepLink(marker.defectUid);
  };

  // Zoom controls
  const zoomIn = () => setScale((s) => Math.min(s * 1.3, 5));
  const zoomOut = () => setScale((s) => Math.max(s / 1.3, 0.5));
  const resetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // Pan (only when not annotating)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (placingMode || mode === "annotate") return;
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

  const handleWheel = (e: React.WheelEvent) => {
    if (mode === "annotate") return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.5, Math.min(5, s * delta)));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (mode === "annotate") return;
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
    if (mode === "annotate") return;
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

  // ===== Annotation drawing =====

  // Resize annotation canvas to match image's rendered size
  const resizeCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    // Use natural-ish target size but cap. Use image client rect at scale 1 (i.e. base size).
    // Since the canvas is positioned absolutely with width/height 100%, we set internal pixel size based on rendered size.
    const rect = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Use unscaled size: divide by current scale so the drawing buffer is consistent regardless of zoom
    const w = Math.max(1, Math.round(rect.width / scale));
    const h = Math.max(1, Math.round(rect.height / scale));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redrawAll();
  }, [scale]);

  // Redraw all strokes + labels onto the canvas
  const redrawAll = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      if (!s.points.length) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo((s.points[0].x / 100) * w, (s.points[0].y / 100) * h);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo((s.points[i].x / 100) * w, (s.points[i].y / 100) * h);
      }
      ctx.stroke();
    }
    for (const l of labels) {
      ctx.fillStyle = l.color;
      ctx.font = `${l.fontSize}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(l.text, (l.x / 100) * w, (l.y / 100) * h);
    }
  }, [strokes, labels]);

  // Redraw whenever strokes/labels change
  useEffect(() => {
    redrawAll();
  }, [redrawAll]);

  // Set up ResizeObserver on the image
  useEffect(() => {
    const img = imageRef.current;
    if (!img || !imageLoaded) return;
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(img);
    resizeCanvas();
    return () => ro.disconnect();
  }, [imageLoaded, resizeCanvas]);

  // Resize on scale change too (because rendered bounding box changes)
  useEffect(() => {
    resizeCanvas();
  }, [scale, resizeCanvas]);

  // Debounced auto-save
  const scheduleSave = useCallback((nextStrokes: Stroke[], nextLabels: TextLabel[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveAnnotationsMut.mutate({ strokes: nextStrokes, labels: nextLabels });
    }, 1000);
  }, [saveAnnotationsMut]);

  // Helper: pointer event -> percentage of image
  const pointerToPct = (e: React.PointerEvent): Point | null => {
    const img = imageRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  // Annotation pointer handlers (attached to drawing canvas)
  const handleAnnotPointerDown = (e: React.PointerEvent) => {
    if (mode !== "annotate") return;
    e.preventDefault();
    const pt = pointerToPct(e);
    if (!pt) return;
    if (tool === "pen") {
      const s: Stroke = { id: uid(), color, width: lineWidth, points: [pt], createdAt: Date.now() };
      currentStrokeRef.current = s;
      drawingRef.current = true;
      try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
      // Begin immediate visual feedback (single dot)
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo((pt.x / 100) * w, (pt.y / 100) * h);
        ctx.lineTo((pt.x / 100) * w + 0.01, (pt.y / 100) * h + 0.01);
        ctx.stroke();
      }
    } else if (tool === "text") {
      setPendingLabel({ x: pt.x, y: pt.y, text: "" });
      setTimeout(() => labelInputRef.current?.focus(), 30);
    } else if (tool === "eraser") {
      eraseNear(pt);
    }
  };

  const handleAnnotPointerMove = (e: React.PointerEvent) => {
    if (mode !== "annotate") return;
    if (tool !== "pen" || !drawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const pt = pointerToPct(e);
    if (!pt) return;
    const s = currentStrokeRef.current;
    const prev = s.points[s.points.length - 1];
    s.points.push(pt);
    // Draw incrementally
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo((prev.x / 100) * w, (prev.y / 100) * h);
      ctx.lineTo((pt.x / 100) * w, (pt.y / 100) * h);
      ctx.stroke();
    }
  };

  const handleAnnotPointerUp = (e: React.PointerEvent) => {
    if (mode !== "annotate") return;
    if (tool !== "pen") return;
    if (!drawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const finished = currentStrokeRef.current;
    drawingRef.current = false;
    currentStrokeRef.current = null;
    if (finished.points.length === 0) return;
    const next = [...strokes, finished];
    setStrokes(next);
    scheduleSave(next, labels);
  };

  // Find nearest stroke or label within 20px of point
  const eraseNear = (pt: Point) => {
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0) return;
    // 20px threshold in image-rendered space; convert to % distance
    const thrXPct = (20 / rect.width) * 100;
    const thrYPct = (20 / rect.height) * 100;
    const thrPct = Math.max(thrXPct, thrYPct);

    let bestType: "stroke" | "label" | null = null;
    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const s of strokes) {
      for (const p of s.points) {
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestType = "stroke";
          bestId = s.id;
        }
      }
    }
    for (const l of labels) {
      const dx = l.x - pt.x;
      const dy = l.y - pt.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestType = "label";
        bestId = l.id;
      }
    }
    if (bestType && bestId && bestDist <= thrPct) {
      if (bestType === "stroke") {
        const next = strokes.filter((s) => s.id !== bestId);
        setStrokes(next);
        scheduleSave(next, labels);
      } else {
        const next = labels.filter((l) => l.id !== bestId);
        setLabels(next);
        scheduleSave(strokes, next);
      }
    }
  };

  const commitLabel = () => {
    if (!pendingLabel) return;
    const text = pendingLabel.text.trim();
    if (!text) {
      setPendingLabel(null);
      return;
    }
    const label: TextLabel = {
      id: uid(),
      x: pendingLabel.x,
      y: pendingLabel.y,
      text,
      color,
      fontSize: 14,
      createdAt: Date.now(),
    };
    const next = [...labels, label];
    setLabels(next);
    setPendingLabel(null);
    scheduleSave(strokes, next);
  };

  const cancelLabel = () => setPendingLabel(null);

  // Undo: remove whichever of (last stroke, last label) was added most recently
  const undo = () => {
    const lastStroke = strokes[strokes.length - 1];
    const lastLabel = labels[labels.length - 1];
    if (!lastStroke && !lastLabel) return;
    const strokeT = lastStroke?.createdAt ?? -Infinity;
    const labelT = lastLabel?.createdAt ?? -Infinity;
    if (lastStroke && strokeT >= labelT) {
      const next = strokes.slice(0, -1);
      setStrokes(next);
      scheduleSave(next, labels);
    } else if (lastLabel) {
      const next = labels.slice(0, -1);
      setLabels(next);
      scheduleSave(strokes, next);
    }
  };

  const clearAll = () => {
    setStrokes([]);
    setLabels([]);
    setClearConfirm(false);
    scheduleSave([], []);
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

  // ===== PDF export =====
  const exportPdf = async () => {
    if (!imageRef.current || !imageSrc) return;
    setExporting(true);
    try {
      const img = imageRef.current;
      // Use the rendered/internal natural size of the underlying image
      const naturalW = img.naturalWidth || img.clientWidth;
      const naturalH = img.naturalHeight || img.clientHeight;
      const canvas = document.createElement("canvas");
      canvas.width = naturalW;
      canvas.height = naturalH;
      const ctx = canvas.getContext("2d")!;
      // Draw image
      // Need to ensure image is loaded — use a fresh Image with the same src to be safe
      await new Promise<void>((resolve, reject) => {
        if (img.complete && img.naturalWidth > 0) return resolve();
        const onLoad = () => { img.removeEventListener("load", onLoad); resolve(); };
        const onErr = () => { img.removeEventListener("error", onErr); reject(new Error("image load failed")); };
        img.addEventListener("load", onLoad);
        img.addEventListener("error", onErr);
      });
      ctx.drawImage(img, 0, 0, naturalW, naturalH);

      // Strokes
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const widthScale = naturalW / Math.max(1, img.getBoundingClientRect().width / scale);
      for (const s of strokes) {
        if (!s.points.length) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * widthScale;
        ctx.beginPath();
        ctx.moveTo((s.points[0].x / 100) * naturalW, (s.points[0].y / 100) * naturalH);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo((s.points[i].x / 100) * naturalW, (s.points[i].y / 100) * naturalH);
        }
        ctx.stroke();
      }
      // Labels
      for (const l of labels) {
        ctx.fillStyle = l.color;
        ctx.font = `${l.fontSize * widthScale}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(l.text, (l.x / 100) * naturalW, (l.y / 100) * naturalH);
      }
      // Markers
      for (const m of markerList) {
        const cx = (m.xPercent / 100) * naturalW;
        const cy = (m.yPercent / 100) * naturalH;
        const c = STATUS_COLORS[m.status] || "#EF4444";
        const r = Math.max(6, Math.min(naturalW, naturalH) * 0.012);
        // Pin circle
        ctx.beginPath();
        ctx.fillStyle = c;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = "#ffffff";
        ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        // UID label background
        const fontSize = Math.max(10, r * 1.3);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textBaseline = "bottom";
        const text = m.defectUid;
        const metrics = ctx.measureText(text);
        const padX = fontSize * 0.3;
        const padY = fontSize * 0.15;
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = cx - boxW / 2;
        const boxY = cy - r - boxH - 2;
        ctx.fillStyle = c;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, boxX + padX, boxY + boxH - padY);
      }

      const dataUrl = canvas.toDataURL("image/png");
      const { default: jsPDF } = await import("jspdf");
      const orientation = naturalW > naturalH ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgRatio = naturalW / naturalH;
      const pageRatio = pageW / pageH;
      let drawW: number; let drawH: number; let offX = 0; let offY = 0;
      if (imgRatio > pageRatio) {
        drawW = pageW;
        drawH = pageW / imgRatio;
        offY = (pageH - drawH) / 2;
      } else {
        drawH = pageH;
        drawW = pageH * imgRatio;
        offX = (pageW - drawW) / 2;
      }
      pdf.addImage(dataUrl, "PNG", offX, offY, drawW, drawH);
      const name = (elevation?.name || "elevation").replace(/[^\w\-]+/g, "_");
      pdf.save(`${name}-annotated.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  // ===== Render =====
  const annotateMode = mode === "annotate";

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
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex h-8 text-xs gap-1"
            onClick={exportPdf}
            disabled={exporting || !imageSrc}
            data-testid="button-export-pdf"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? "Exporting..." : "Export PDF"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="sm:hidden h-8 w-8"
            onClick={exportPdf}
            disabled={exporting || !imageSrc}
            data-testid="button-export-pdf-compact"
            title="Export PDF"
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={zoomOut} data-testid="button-zoom-out">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="hidden sm:inline text-xs text-muted-foreground w-10 text-center flex-shrink-0">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={zoomIn} data-testid="button-zoom-in">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={resetZoom} data-testid="button-zoom-reset">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-muted/50 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 text-xs min-w-0 overflow-hidden">
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
            <span className="hidden sm:inline">Open:&nbsp;</span>{counts.open}
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            <span className="hidden sm:inline">In Progress:&nbsp;</span>{counts.in_progress}
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span className="hidden sm:inline">Complete:&nbsp;</span>{counts.complete}
          </span>
          {annotateMode && (
            <span className="text-muted-foreground hidden sm:inline truncate">
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Mode toggle */}
          <div className="flex rounded-md border overflow-hidden flex-shrink-0">
            <Button
              size="sm"
              variant={!annotateMode ? "default" : "ghost"}
              className="h-7 text-xs rounded-none px-2"
              onClick={() => { setMode("markers"); setPlacingMode(false); }}
              data-testid="button-mode-markers"
            >
              Markers
            </Button>
            <Button
              size="sm"
              variant={annotateMode ? "default" : "ghost"}
              className="h-7 text-xs rounded-none px-2"
              onClick={() => { setMode("annotate"); setPlacingMode(false); }}
              data-testid="button-mode-annotate"
            >
              Annotate
            </Button>
          </div>
          {!annotateMode && (
            <Button
              size="sm"
              variant={placingMode ? "default" : "outline"}
              className="h-7 text-xs gap-1 flex-shrink-0"
              onClick={() => setPlacingMode(!placingMode)}
              data-testid="button-place-marker"
            >
              <Crosshair className="w-3 h-3" />
              <span className="hidden sm:inline">{placingMode ? "Tap to place" : "Add Marker"}</span>
              <span className="sm:hidden">{placingMode ? "Tap" : "Add"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Annotation toolbar */}
      {annotateMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-background overflow-x-auto flex-shrink-0">
          {/* Tools */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              size="icon"
              variant={tool === "pen" ? "default" : "outline"}
              className="h-8 w-8"
              onClick={() => setTool("pen")}
              data-testid="button-tool-pen"
              title="Pen"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant={tool === "text" ? "default" : "outline"}
              className="h-8 w-8"
              onClick={() => setTool("text")}
              data-testid="button-tool-text"
              title="Text"
            >
              <Type className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant={tool === "eraser" ? "default" : "outline"}
              className="h-8 w-8"
              onClick={() => setTool("eraser")}
              data-testid="button-tool-eraser"
              title="Eraser"
            >
              <Eraser className="w-4 h-4" />
            </Button>
          </div>
          <div className="w-px h-6 bg-border flex-shrink-0" />
          {/* Colors */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {ANNOT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                title={c.name}
                data-testid={`color-${c.name.toLowerCase()}`}
                className={`w-7 h-7 rounded-full border-2 ${color === c.value ? "border-foreground" : "border-transparent"}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
          <div className="w-px h-6 bg-border flex-shrink-0" />
          {/* Widths */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {LINE_WIDTHS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setLineWidth(w.value)}
                title={w.name}
                data-testid={`width-${w.name.toLowerCase()}`}
                className={`h-8 w-8 rounded-md border flex items-center justify-center ${lineWidth === w.value ? "bg-accent border-foreground" : "bg-background"}`}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: `${Math.min(w.value * 2 + 2, 18)}px`,
                    height: `${Math.min(w.value * 2 + 2, 18)}px`,
                    backgroundColor: "currentColor",
                  }}
                />
              </button>
            ))}
          </div>
          <div className="w-px h-6 bg-border flex-shrink-0" />
          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={undo}
              disabled={strokes.length === 0 && labels.length === 0}
              data-testid="button-undo"
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setClearConfirm(true)}
              disabled={strokes.length === 0 && labels.length === 0}
              data-testid="button-clear-all"
              title="Clear all"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-xs text-muted-foreground ml-auto sm:hidden flex-shrink-0">
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : ""}
          </span>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative bg-muted/30"
        style={{
          cursor: placingMode ? "crosshair" : (!annotateMode && scale > 1 ? "grab" : "default"),
          touchAction: !annotateMode && scale > 1 ? "none" : (annotateMode ? "none" : "auto"),
        }}
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
              className="w-full h-auto select-none block"
              draggable={false}
              onLoad={() => setImageLoaded(true)}
              data-testid="img-elevation"
            />
            {/* Drawing canvas overlay */}
            <canvas
              ref={drawCanvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                touchAction: "none",
                cursor: annotateMode ? (tool === "pen" ? "crosshair" : tool === "text" ? "text" : "cell") : "default",
                pointerEvents: annotateMode ? "auto" : "none",
              }}
              onPointerDown={handleAnnotPointerDown}
              onPointerMove={handleAnnotPointerMove}
              onPointerUp={handleAnnotPointerUp}
              onPointerCancel={handleAnnotPointerUp}
              data-testid="canvas-annotations"
            />
            {/* Floating label input */}
            {pendingLabel && (
              <div
                style={{
                  position: "absolute",
                  left: `${pendingLabel.x}%`,
                  top: `${pendingLabel.y}%`,
                  transform: `scale(${1 / scale})`,
                  transformOrigin: "top left",
                  zIndex: 30,
                }}
              >
                <input
                  ref={labelInputRef}
                  type="text"
                  value={pendingLabel.text}
                  onChange={(e) => setPendingLabel({ ...pendingLabel, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitLabel();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelLabel();
                    }
                  }}
                  onBlur={commitLabel}
                  placeholder="Label text..."
                  className="text-sm px-1.5 py-0.5 border-2 rounded bg-white shadow"
                  style={{ borderColor: color, color: color, minWidth: "120px" }}
                  data-testid="input-label"
                />
              </div>
            )}
            {/* Markers overlay */}
            {imageLoaded &&
              markerList.map((marker) => (
                <div
                  key={marker.id}
                  className="absolute flex flex-col items-center"
                  style={{
                    left: `${marker.xPercent}%`,
                    top: `${marker.yPercent}%`,
                    transform: `translate(-50%, -100%) scale(${1 / scale})`,
                    transformOrigin: "bottom center",
                    zIndex: 10,
                    pointerEvents: annotateMode ? "none" : "auto",
                  }}
                  onClick={(e) => handleMarkerClick(e, marker)}
                  data-testid={`marker-${marker.id}`}
                >
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

      {/* Clear all confirmation */}
      <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all annotations?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all strokes and text labels from this elevation. Markers are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clearAll}>Clear all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
