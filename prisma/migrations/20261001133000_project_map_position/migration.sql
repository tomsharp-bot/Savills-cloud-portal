-- Pin position on the Projects Progress UK outline.
-- Percent of the map (0–100). Null until an admin drops the project.
ALTER TABLE "Project" ADD COLUMN "mapX" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN "mapY" DOUBLE PRECISION;
