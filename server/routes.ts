import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, dataDir } from "./storage";
import { insertProjectSchema, insertMarkerSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files (jpg, png) are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Serve uploaded files
  app.use("/api/uploads", (req, res) => {
    const filePath = path.resolve(uploadDir, path.basename(req.path));
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "File not found" });
    }
  });

  // === PROJECTS ===
  app.get("/api/projects", (_req, res) => {
    const allProjects = storage.getProjects();
    const withCounts = allProjects.map(p => ({
      ...p,
      elevationCount: storage.getElevationCount(p.id),
    }));
    res.json(withCounts);
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = storage.getProject(Number(req.params.id));
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.post("/api/projects", (req, res) => {
    const parsed = insertProjectSchema.safeParse({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const project = storage.createProject(parsed.data);
    res.status(201).json(project);
  });

  app.delete("/api/projects/:id", (req, res) => {
    // Delete uploaded files for all elevations in project
    const elev = storage.getElevationsByProject(Number(req.params.id));
    for (const e of elev) {
      const filePath = path.join(uploadDir, e.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    storage.deleteProject(Number(req.params.id));
    res.status(204).end();
  });

  // === ELEVATIONS ===
  app.get("/api/projects/:projectId/elevations", (req, res) => {
    const elev = storage.getElevationsByProject(Number(req.params.projectId));
    res.json(elev);
  });

  app.get("/api/elevations/:id", (req, res) => {
    const elev = storage.getElevation(Number(req.params.id));
    if (!elev) return res.status(404).json({ message: "Elevation not found" });
    res.json(elev);
  });

  app.post("/api/projects/:projectId/elevations", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const projectId = Number(req.params.projectId);
    const project = storage.getProject(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const isPdf = req.file.mimetype === "application/pdf";
    const elevation = storage.createElevation({
      projectId,
      name: req.body.name || req.file.originalname,
      filename: req.file.filename,
      fileType: isPdf ? "pdf" : "image",
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(elevation);
  });

  app.delete("/api/elevations/:id", (req, res) => {
    const elev = storage.getElevation(Number(req.params.id));
    if (elev) {
      const filePath = path.join(uploadDir, elev.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    storage.deleteElevation(Number(req.params.id));
    res.status(204).end();
  });

  // === MARKERS ===
  app.get("/api/elevations/:elevationId/markers", (req, res) => {
    const m = storage.getMarkersByElevation(Number(req.params.elevationId));
    res.json(m);
  });

  app.get("/api/elevations/:elevationId/marker-counts", (req, res) => {
    const counts = storage.getMarkerCounts(Number(req.params.elevationId));
    res.json(counts);
  });

  app.post("/api/elevations/:elevationId/markers", (req, res) => {
    const elevationId = Number(req.params.elevationId);
    const elev = storage.getElevation(elevationId);
    if (!elev) return res.status(404).json({ message: "Elevation not found" });

    const parsed = insertMarkerSchema.safeParse({
      ...req.body,
      elevationId,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const marker = storage.createMarker(parsed.data);
    res.status(201).json(marker);
  });

  app.patch("/api/markers/:id", (req, res) => {
    const marker = storage.updateMarker(Number(req.params.id), req.body);
    if (!marker) return res.status(404).json({ message: "Marker not found" });
    res.json(marker);
  });

  app.delete("/api/markers/:id", (req, res) => {
    storage.deleteMarker(Number(req.params.id));
    res.status(204).end();
  });

  return httpServer;
}
