import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import {
  projects, elevations, markers,
  type Project, type InsertProject,
  type Elevation, type InsertElevation,
  type Marker, type InsertMarker,
} from "@shared/schema";
import path from "path";

export const dataDir = process.env.DATA_DIR || ".";
const dbPath = path.join(dataDir, "database.sqlite");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS elevations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    elevation_id INTEGER NOT NULL,
    defect_uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT,
    x_percent REAL NOT NULL,
    y_percent REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (elevation_id) REFERENCES elevations(id) ON DELETE CASCADE
  );
`);

export interface IStorage {
  // Projects
  getProjects(): Project[];
  getProject(id: number): Project | undefined;
  createProject(data: InsertProject): Project;
  deleteProject(id: number): void;

  // Elevations
  getElevationsByProject(projectId: number): Elevation[];
  getElevation(id: number): Elevation | undefined;
  createElevation(data: InsertElevation): Elevation;
  deleteElevation(id: number): void;

  // Markers
  getMarkersByElevation(elevationId: number): Marker[];
  getMarker(id: number): Marker | undefined;
  createMarker(data: InsertMarker): Marker;
  updateMarker(id: number, data: Partial<InsertMarker>): Marker | undefined;
  deleteMarker(id: number): void;

  // Counts
  getElevationCount(projectId: number): number;
  getMarkerCounts(elevationId: number): { open: number; in_progress: number; complete: number };
}

export const storage: IStorage = {
  // Projects
  getProjects() {
    return db.select().from(projects).all();
  },
  getProject(id: number) {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  },
  createProject(data: InsertProject) {
    return db.insert(projects).values(data).returning().get();
  },
  deleteProject(id: number) {
    // Cascading delete handled by foreign keys
    db.delete(projects).where(eq(projects.id, id)).run();
  },

  // Elevations
  getElevationsByProject(projectId: number) {
    return db.select().from(elevations).where(eq(elevations.projectId, projectId)).all();
  },
  getElevation(id: number) {
    return db.select().from(elevations).where(eq(elevations.id, id)).get();
  },
  createElevation(data: InsertElevation) {
    return db.insert(elevations).values(data).returning().get();
  },
  deleteElevation(id: number) {
    db.delete(elevations).where(eq(elevations.id, id)).run();
  },

  // Markers
  getMarkersByElevation(elevationId: number) {
    return db.select().from(markers).where(eq(markers.elevationId, elevationId)).all();
  },
  getMarker(id: number) {
    return db.select().from(markers).where(eq(markers.id, id)).get();
  },
  createMarker(data: InsertMarker) {
    return db.insert(markers).values(data).returning().get();
  },
  updateMarker(id: number, data: Partial<InsertMarker>) {
    const existing = db.select().from(markers).where(eq(markers.id, id)).get();
    if (!existing) return undefined;
    return db.update(markers).set(data).where(eq(markers.id, id)).returning().get();
  },
  deleteMarker(id: number) {
    db.delete(markers).where(eq(markers.id, id)).run();
  },

  // Counts
  getElevationCount(projectId: number) {
    const result = db.select({ count: sql<number>`count(*)` }).from(elevations).where(eq(elevations.projectId, projectId)).get();
    return result?.count ?? 0;
  },
  getMarkerCounts(elevationId: number) {
    const all = db.select().from(markers).where(eq(markers.elevationId, elevationId)).all();
    return {
      open: all.filter(m => m.status === "open").length,
      in_progress: all.filter(m => m.status === "in_progress").length,
      complete: all.filter(m => m.status === "complete").length,
    };
  },
};
