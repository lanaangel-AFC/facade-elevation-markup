import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull(),
  trackerUrl: text("tracker_url"), // URL to Defect Tracker report page, e.g. https://facade-tracker-production.up.railway.app/#/projects/1/reports/1
  createdAt: text("created_at").notNull(),
});

export const elevations = sqliteTable("elevations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(), // "pdf" or "image"
  createdAt: text("created_at").notNull(),
});

export const markers = sqliteTable("markers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  elevationId: integer("elevation_id").notNull(),
  defectUid: text("defect_uid").notNull(),
  status: text("status").notNull().default("open"), // open, in_progress, complete
  note: text("note"),
  xPercent: real("x_percent").notNull(),
  yPercent: real("y_percent").notNull(),
  createdAt: text("created_at").notNull(),
});

// Insert schemas
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export const insertElevationSchema = createInsertSchema(elevations).omit({ id: true });
export const insertMarkerSchema = createInsertSchema(markers).omit({ id: true });

// Types
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertElevation = z.infer<typeof insertElevationSchema>;
export type Elevation = typeof elevations.$inferSelect;
export type InsertMarker = z.infer<typeof insertMarkerSchema>;
export type Marker = typeof markers.$inferSelect;
